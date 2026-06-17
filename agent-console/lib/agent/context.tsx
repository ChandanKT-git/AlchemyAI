"use client";

// ─────────────────────────────────────────────────────────────
// Agent Context — React Context Provider for Layer 1 + Layer 2
//
// This wires the WSClient (connection layer) to the agentReducer
// (stream/tool layer) and exposes the resulting state to the
// entire component tree via React Context.
//
// WHY A CONTEXT PROVIDER?
// Without it, AppShell would need to pass state as props through
// every level of the tree (prop drilling). With context, any
// component can access agent state directly:
//
//   const { state, sendMessage } = useAgent();
//
// WHAT IT OWNS:
// - Creates and manages the WSClient instance
// - Feeds parsed messages through agentReducer
// - Exposes: agentState, connectionState, sendMessage, sendToolAck
// ─────────────────────────────────────────────────────────────

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  WSClient,
  type ConnectionState,
  type ReconnectInfo,
} from "@/lib/protocol/ws-client";
import type { AgentState } from "@/lib/agent/types";
import {
  agentReducer,
  createInitialState,
  resetForNewTurn,
  clearPendingAcks,
  requeuePendingAcks,
} from "@/lib/agent/reducer";
import type { ServerMessage } from "@/lib/protocol/types";

// ── Context Shape ────────────────────────────────────────────

interface AgentContextValue {
  /** The current agent state (stream, context, timeline) */
  state: AgentState;

  /** The current WebSocket connection state */
  connectionState: ConnectionState;

  /**
   * Set when in DISCONNECTED state, null otherwise.
   * Carries the backoff delay and attempt number for the UI countdown.
   */
  reconnectInfo: ReconnectInfo | null;

  /**
   * Live stats from the connection layer for the chaos debug overlay.
   * lastSeq  — last fully processed message sequence number
   * bufferedCount — messages sitting in the reorder buffer (gap fill)
   */
  debugInfo: { lastSeq: number; bufferedCount: number };

  /** Send a user message (resets stream for new turn) */
  sendMessage: (content: string) => void;

  /** Send a TOOL_ACK for a tool call */
  sendToolAck: (callId: string) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────

interface AgentProviderProps {
  url: string;
  children: ReactNode;
}

export function AgentProvider({ url, children }: AgentProviderProps) {
  // We use useState for both agentState and connectionState so
  // React re-renders when they change.
  const [agentState, setAgentState] = useState<AgentState>(createInitialState);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("IDLE");
  const [reconnectInfo, setReconnectInfo] = useState<ReconnectInfo | null>(
    null,
  );
  const [bufferedCount, setBufferedCount] = useState(0);

  // Stable ref so sendMessage guard never needs to be recreated
  const connectionStateRef = useRef<ConnectionState>("IDLE");
  connectionStateRef.current = connectionState;

  // Use a ref for the WSClient so it persists across renders
  const clientRef = useRef<WSClient | null>(null);

  // We use a ref for the state so the handleMessage callback
  // always has the latest state without needing to be recreated.
  const stateRef = useRef<AgentState>(agentState);
  stateRef.current = agentState;

  // ── Message handler ─────────────────────────────────
  const handleMessage = useCallback((msg: ServerMessage) => {
    setAgentState((prev) => agentReducer(prev, msg));
  }, []);

  // ── Clear reconnectInfo when state leaves DISCONNECTED ─
  // Once the retry timer fires and we enter RECONNECTING (or we
  // connect successfully), the countdown is no longer meaningful.
  useEffect(() => {
    if (connectionState !== "DISCONNECTED") {
      setReconnectInfo(null);
    }
  }, [connectionState]);

  // ── Initialize WSClient on mount ────────────────────
  useEffect(() => {
    const client = new WSClient({
      url,
      onMessage: handleMessage,
      onStateChange: setConnectionState,
      onRetryScheduled: setReconnectInfo,
      onBufferChange: setBufferedCount,
      onReconnected: () => {
        // Re-queue ACKs for any pending tool calls whose TOOL_ACK may
        // have been lost in transit when the connection dropped.
        setAgentState((prev) => requeuePendingAcks(prev));
      },
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [url, handleMessage]);

  // ── Send TOOL_ACKs when the reducer queues them ──────
  // This useEffect fires after the reducer adds call_ids
  // to pendingAcks. We send TOOL_ACK for each, then clear.
  //
  // WHY useEffect and not in handleMessage?
  // The reducer is pure — it can't do side effects.
  // useEffect runs AFTER React commits the state update,
  // which means the tool card is already in the DOM when
  // we send ACK. This matches the protocol requirement:
  // "ACK means I've processed and rendered this tool call."
  useEffect(() => {
    if (agentState.pendingAcks.length === 0) return;
    if (!clientRef.current) return;

    for (const callId of agentState.pendingAcks) {
      console.log(`[AgentProvider] Sending TOOL_ACK for ${callId}`);
      clientRef.current.send({ type: "TOOL_ACK", call_id: callId });
    }

    // Clear the queue so we don't send again
    setAgentState((prev) => clearPendingAcks(prev));
  }, [agentState.pendingAcks]);

  // ── Actions ─────────────────────────────────────────

  const sendMessage = useCallback((content: string) => {
    if (!clientRef.current) return;

    // Guard: don't wipe stream state if we're not actually connected.
    // MessageInput already blocks this in the UI, but a defensive check
    // prevents state loss if called programmatically while reconnecting.
    if (connectionStateRef.current !== "CONNECTED") {
      console.warn("[AgentProvider] Ignoring sendMessage — not connected");
      return;
    }

    // Reset agent state for new turn (preserves context)
    setAgentState((prev) => resetForNewTurn(prev));

    // Send via WebSocket (also resets reorder buffer)
    clientRef.current.sendUserMessage(content);
  }, []); // stable — reads connectionState via ref

  const sendToolAck = useCallback((callId: string) => {
    if (!clientRef.current) return;
    clientRef.current.send({ type: "TOOL_ACK", call_id: callId });
  }, []);

  // ── Context value (stable reference) ────────────────

  // Derive lastSeq from the timeline (last processed message's seq).
  // This updates on every reducer dispatch, giving a live seq counter.
  const lastSeq =
    agentState.timeline.length > 0
      ? agentState.timeline[agentState.timeline.length - 1].seq
      : 0;

  const value: AgentContextValue = {
    state: agentState,
    connectionState,
    reconnectInfo,
    debugInfo: { lastSeq, bufferedCount },
    sendMessage,
    sendToolAck,
  };

  return (
    <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────

/**
 * Access the agent state and actions from any component.
 * Must be used inside an <AgentProvider>.
 */
export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error("useAgent must be used within an <AgentProvider>");
  }
  return ctx;
}
