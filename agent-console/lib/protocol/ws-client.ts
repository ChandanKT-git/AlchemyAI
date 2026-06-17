// ─────────────────────────────────────────────────────────────
// WebSocket Client — Connection Layer (Layer 1)
//
// This class owns the WebSocket LIFECYCLE only:
//  • Connect / disconnect
//  • PING → PONG heartbeat (reply within 3s)
//  • Exponential backoff on disconnect (500ms → 1s → 2s → 4s → cap 10s)
//  • RESUME on reconnect (sends last_seq from reorder buffer)
//  • Route validated messages to an onMessage callback
//
// It does NOT know about tokens, tool calls, or streams.
// That separation is deliberate — a connection drop should NOT
// reset stream state (the tool card stays visible, text stays).
//
// STATE MACHINE:
//   IDLE → CONNECTING → CONNECTED
//                            ↓ (onclose/onerror)
//                       DISCONNECTED → WAIT_RETRY → CONNECTING (loop)
//
// On reconnect, we immediately send RESUME { last_seq } so the
// server replays events we missed. The reorder buffer handles
// deduplication of replayed events.
// ─────────────────────────────────────────────────────────────

import type { ServerMessage, ClientMessage } from "./types";
import { parseRawMessage } from "./parse";
import { ReorderBuffer } from "./reorder-buffer";

// ── Connection States ────────────────────────────────────────

export type ConnectionState =
  | "IDLE" // Never connected
  | "CONNECTING" // WebSocket opening
  | "CONNECTED" // WebSocket open, heartbeat active
  | "DISCONNECTED" // WebSocket closed, will retry
  | "RECONNECTING"; // WebSocket opening (has previous history)

// ── Reconnect Info ───────────────────────────────────────────

/**
 * Emitted by WSClient when a reconnect is scheduled.
 * The UI uses this to show a countdown and attempt number.
 */
export interface ReconnectInfo {
  /** How long until the next connection attempt (milliseconds) */
  delayMs: number;
  /** 1-based reconnection attempt number (resets when connected) */
  attempt: number;
}

// ── Configuration ────────────────────────────────────────────

export interface WSClientOptions {
  /** WebSocket server URL, e.g. "ws://localhost:4747/ws" */
  url: string;

  /**
   * Called for each validated, reordered, deduplicated message.
   * This is where the reducer (Layer 2) receives messages.
   */
  onMessage: (msg: ServerMessage) => void;

  /**
   * Called whenever the connection state changes.
   * Used by UI to show/hide reconnection indicator.
   */
  onStateChange: (state: ConnectionState) => void;

  /**
   * Called when a PING is received (for timeline logging).
   * The PONG reply is handled automatically — this is just for display.
   */
  onPing?: (challenge: string) => void;

  /**
   * Called when a PONG is sent (for timeline logging).
   */
  onPongSent?: (echo: string) => void;

  /**
   * Called when a reconnect is scheduled (state = DISCONNECTED).
   * Fired ONCE per retry cycle, before the timer starts.
   * The UI uses `delayMs` to show a countdown.
   * Cleared (set to null implicitly) when state leaves DISCONNECTED.
   */
  onRetryScheduled?: (info: ReconnectInfo) => void;

  /**
   * Called after a successful RECONNECTION (not the first connection).
   * Fired after RESUME is sent and state is CONNECTED.
   * Use this to re-queue any side effects that may have been lost
   * during the outage (e.g. TOOL_ACKs that never reached the server).
   */
  onReconnected?: () => void;

  /**
   * Called after every message insertion into the reorder buffer.
   * Delivers the current number of messages waiting for gap fill.
   * Use this to display buffer depth during chaos recording.
   */
  onBufferChange?: (bufferedCount: number) => void;
}

// ── Backoff Constants ────────────────────────────────────────

const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 10_000;
const BACKOFF_MULTIPLIER = 2;

// ── WebSocket Client ─────────────────────────────────────────

export class WSClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "IDLE";
  private readonly reorderBuffer = new ReorderBuffer();
  private readonly options: WSClientOptions;

  // Reconnection state
  private hasConnectedBefore = false;
  private backoffMs = BACKOFF_INITIAL_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  // Track if we've been explicitly disconnected by user
  private intentionalDisconnect = false;

  constructor(options: WSClientOptions) {
    this.options = options;
  }

  // ── Public API ───────────────────────────────────────────

  /** Start the WebSocket connection. */
  connect(): void {
    if (this.state === "CONNECTED" || this.state === "CONNECTING") {
      return; // Already connected or connecting
    }

    this.intentionalDisconnect = false;
    this.setState(this.hasConnectedBefore ? "RECONNECTING" : "CONNECTING");
    this.createWebSocket();
  }

  /** Cleanly close the connection. Won't auto-reconnect. */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearRetryTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState("IDLE");
  }

  /**
   * Send a client message to the server.
   * Silently drops if not connected.
   */
  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[WSClient] Cannot send — not connected:", msg.type);
      return;
    }

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send a USER_MESSAGE and reset the reorder buffer.
   * The server resets its seq counter on each USER_MESSAGE,
   * so we must reset ours too.
   */
  sendUserMessage(content: string): void {
    this.reorderBuffer.reset();
    this.send({ type: "USER_MESSAGE", content });
  }

  /** Get the current connection state. */
  getState(): ConnectionState {
    return this.state;
  }

  /** Get the highest fully processed seq (for RESUME). */
  getLastProcessedSeq(): number {
    return this.reorderBuffer.getLastProcessedSeq();
  }

  /** Get the reorder buffer (useful for debugging/display). */
  getBufferedCount(): number {
    return this.reorderBuffer.bufferedCount;
  }

  // ── Private: WebSocket lifecycle ─────────────────────────

  private createWebSocket(): void {
    try {
      this.ws = new WebSocket(this.options.url);
    } catch (err) {
      console.error("[WSClient] Failed to create WebSocket:", err);
      this.handleDisconnect();
      return;
    }

    this.ws.onopen = () => this.handleOpen();
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onclose = () => this.handleDisconnect();
    this.ws.onerror = (err) => {
      console.error("[WSClient] WebSocket error:", err);
      // onclose will fire after onerror — handleDisconnect runs there
    };
  }

  private handleOpen(): void {
    this.backoffMs = BACKOFF_INITIAL_MS; // Reset backoff on success
    this.reconnectAttempt = 0; // Reset attempt counter on success

    const isReconnect = this.hasConnectedBefore;

    if (isReconnect) {
      // ── Reconnection: send RESUME first ──────────
      // The server replays all events with seq > last_seq.
      // The reorder buffer handles deduplication of any replayed events.
      const lastSeq = this.reorderBuffer.getLastProcessedSeq();
      console.log(
        `[WSClient] Reconnected — sending RESUME { last_seq: ${lastSeq} }`,
      );
      this.send({ type: "RESUME", last_seq: lastSeq });
    }

    this.hasConnectedBefore = true;
    this.setState("CONNECTED");

    if (isReconnect) {
      // Notify the app so it can re-queue any lost side-effects
      // (e.g. TOOL_ACKs that may not have reached the server before disconnect)
      this.options.onReconnected?.();
    }
  }

  private handleMessage(event: MessageEvent): void {
    // ── Step 1: Parse and validate ─────────────────────
    const raw =
      typeof event.data === "string" ? event.data : String(event.data);
    const msg = parseRawMessage(raw);

    if (!msg) {
      console.warn(
        "[WSClient] Malformed message, skipping:",
        raw.slice(0, 100),
      );
      return;
    }

    // ── Step 2: Handle PING immediately (bypass buffer) ──
    // PINGs must be replied to within 3 seconds.
    // They go through the reorder buffer for timeline tracking,
    // but the PONG reply is sent IMMEDIATELY — don't wait for ordering.
    if (msg.type === "PING") {
      // Send PONG with the challenge (even if empty — chaos mode)
      this.send({ type: "PONG", echo: msg.challenge });
      this.options.onPing?.(msg.challenge);
      this.options.onPongSent?.(msg.challenge);
    }

    // ── Step 3: Reorder + deduplicate ──────────────────
    const ready = this.reorderBuffer.insert(msg);

    // ── Step 4: Route ordered messages to callback ─────
    for (const orderedMsg of ready) {
      this.options.onMessage(orderedMsg);
    }

    // ── Step 5: Notify buffer depth change ───────────
    // Called after every insert so the UI can show real-time
    // buffer depth during chaos recording.
    this.options.onBufferChange?.(this.reorderBuffer.bufferedCount);
  }

  private handleDisconnect(): void {
    this.ws = null;

    if (this.intentionalDisconnect) {
      return; // User explicitly disconnected — don't retry
    }

    this.setState("DISCONNECTED");
    this.scheduleRetry();
  }

  // ── Private: Reconnection with backoff ───────────────────

  private scheduleRetry(): void {
    this.clearRetryTimer();

    this.reconnectAttempt++;
    const delayMs = this.backoffMs;

    console.log(
      `[WSClient] Reconnecting in ${delayMs}ms... (attempt ${this.reconnectAttempt})`,
    );

    // Notify the UI so it can show a countdown
    this.options.onRetryScheduled?.({
      delayMs,
      attempt: this.reconnectAttempt,
    });

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delayMs);

    // Exponential backoff: 500 → 1000 → 2000 → 4000 → 8000 → 10000 (cap)
    this.backoffMs = Math.min(delayMs * BACKOFF_MULTIPLIER, BACKOFF_MAX_MS);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // ── Private: State management ────────────────────────────

  private setState(newState: ConnectionState): void {
    if (this.state === newState) return;

    const prev = this.state;
    this.state = newState;
    console.log(`[WSClient] ${prev} → ${newState}`);
    this.options.onStateChange(newState);
  }
}
