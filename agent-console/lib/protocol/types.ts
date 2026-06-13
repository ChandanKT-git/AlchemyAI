// ─────────────────────────────────────────────────────────────
// Protocol Types — Client-side mirror of the agent-server types
//
// These MUST match agent-server/src/types.ts exactly.
// The server is the source of truth — we don't modify it.
//
// Key pattern: Discriminated Union on the `type` field.
// This lets TypeScript narrow the type in a switch statement:
//
//   switch (msg.type) {
//     case "TOKEN":  msg.text;       // TS knows this exists
//     case "PING":   msg.challenge;  // TS knows this exists
//   }
// ─────────────────────────────────────────────────────────────

// ── Server → Client Messages ──────────────────────────────────

export interface TokenMessage {
  type: "TOKEN";
  seq: number;
  text: string;
  stream_id: string;
}

export interface ToolCallMessage {
  type: "TOOL_CALL";
  seq: number;
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  stream_id: string;
}

export interface ToolResultMessage {
  type: "TOOL_RESULT";
  seq: number;
  call_id: string;
  result: Record<string, unknown>;
  stream_id: string;
}

export interface ContextSnapshotMessage {
  type: "CONTEXT_SNAPSHOT";
  seq: number;
  context_id: string;
  data: Record<string, unknown>;
}

export interface PingMessage {
  type: "PING";
  seq: number;
  challenge: string;
}

export interface StreamEndMessage {
  type: "STREAM_END";
  seq: number;
  stream_id: string;
}

export interface ErrorMessage {
  type: "ERROR";
  seq: number;
  code: string;
  message: string;
}

/**
 * Discriminated union of all server→client messages.
 * The `type` field is the discriminant — TypeScript uses it
 * to narrow the type in switch/if statements.
 */
export type ServerMessage =
  | TokenMessage
  | ToolCallMessage
  | ToolResultMessage
  | ContextSnapshotMessage
  | PingMessage
  | StreamEndMessage
  | ErrorMessage;

// ── Client → Server Messages ──────────────────────────────────

export interface UserMessagePayload {
  type: "USER_MESSAGE";
  content: string;
}

export interface PongPayload {
  type: "PONG";
  echo: string;
}

export interface ResumePayload {
  type: "RESUME";
  last_seq: number;
}

export interface ToolAckPayload {
  type: "TOOL_ACK";
  call_id: string;
}

/**
 * Union of all client→server messages.
 * We construct these — we don't parse them from unknown data.
 */
export type ClientMessage =
  | UserMessagePayload
  | PongPayload
  | ResumePayload
  | ToolAckPayload;

// ── Utility type: extract the `type` string literals ──────────

/**
 * All possible server message type strings.
 * Useful for filtering, timeline display, etc.
 */
export type ServerMessageType = ServerMessage["type"];
