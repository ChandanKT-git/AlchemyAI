// ─────────────────────────────────────────────────────────────
// Agent State Types — Stream/Tool Layer (Layer 2)
//
// These types describe the STREAM state, not the connection state.
// Connection state (IDLE, CONNECTED, etc.) lives in ws-client.ts.
//
// KEY DESIGN: A stream response is an ordered array of "blocks":
//
//   [TextBlock, ToolCallBlock, TextBlock, ToolCallBlock, TextBlock]
//
// Each block represents a contiguous section of the response:
// - TextBlock: accumulated token text (grows as tokens arrive)
// - ToolCallBlock: a tool call card (pending → complete when result arrives)
//
// WHY BLOCKS?
// If tool calls were just inline strings, inserting a tool card
// would require splitting text, tracking insertion points, and
// dealing with layout shift. With blocks, a TOOL_CALL simply:
// 1. Freezes the current TextBlock (no more appends)
// 2. Pushes a new ToolCallBlock
// 3. Pushes a new empty TextBlock for post-tool tokens
// ─────────────────────────────────────────────────────────────

// ── Block Types ──────────────────────────────────────────────

export interface TextBlock {
  kind: "text";
  text: string;       // grows as TOKEN messages arrive
  tokenCount: number; // how many TOKEN messages contributed
}

export interface ToolCallBlock {
  kind: "tool_call";
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown> | null; // null until TOOL_RESULT
  status: "pending" | "complete";
}

export type Block = TextBlock | ToolCallBlock;

// ── Stream State ─────────────────────────────────────────────

export type StreamStatus = "idle" | "streaming" | "tool_pending" | "complete";

export interface StreamState {
  /** Unique ID for this stream (from the server) */
  streamId: string | null;

  /** Current status of the stream */
  status: StreamStatus;

  /** Ordered array of content blocks */
  blocks: Block[];
}

// ── Context State ────────────────────────────────────────────

export interface ContextSnapshot {
  /** The raw context data */
  data: Record<string, unknown>;

  /** When this snapshot was received (seq number) */
  seq: number;
}

export interface ContextState {
  /**
   * Map of context_id → array of snapshots (history).
   * Each new CONTEXT_SNAPSHOT for the same context_id
   * is appended to the array (for the history scrubber).
   */
  contexts: Record<string, ContextSnapshot[]>;
}

// ── Timeline Entry ───────────────────────────────────────────

export interface TimelineEntry {
  /** The seq number of this event */
  seq: number;

  /** The event type */
  type: string;

  /** When this event was processed (client timestamp) */
  timestamp: number;

  /** Brief summary for display */
  summary: string;

  /** Optional: linked call_id for TOOL_CALL/TOOL_RESULT correlation */
  callId?: string;
}

// ── Top-level Agent State ────────────────────────────────────

export interface AgentState {
  /** The current stream (one active stream at a time) */
  stream: StreamState;

  /** Context snapshots organized by context_id */
  context: ContextState;

  /** All timeline entries for the trace panel */
  timeline: TimelineEntry[];

  /** The last error received, if any */
  lastError: { code: string; message: string } | null;

  /**
   * call_ids that need a TOOL_ACK sent to the server.
   *
   * WHY HERE?
   * The reducer is a PURE function — it can't do side effects
   * like WebSocket sends. Instead, it queues call_ids here.
   * The context provider watches this array and sends TOOL_ACK
   * for each entry, then clears it.
   *
   * This is the "command pattern" — the reducer produces commands,
   * the provider executes them.
   */
  pendingAcks: string[];
}
