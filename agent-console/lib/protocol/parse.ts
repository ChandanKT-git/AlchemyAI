// ─────────────────────────────────────────────────────────────
// Runtime Parser — Safely converts unknown data to ServerMessage
//
// WHY THIS EXISTS:
// JSON.parse returns `any`. TypeScript types are erased at runtime.
// If we do `JSON.parse(data) as ServerMessage`, we're lying to the
// compiler. A malformed message would crash somewhere deep in our
// reducer or renderer with a confusing error.
//
// This parser validates at the BOUNDARY — the moment data enters
// our system from the WebSocket. If it's malformed, we return null
// and the caller can log/skip it. Everything downstream gets a
// guaranteed, type-safe ServerMessage.
//
// DESIGN CHOICES:
// - Returns null on failure (not throw) so the caller can decide
//   whether to log, skip, or disconnect
// - Each message type has its own validator for clarity
// ─────────────────────────────────────────────────────────────

import type { ServerMessage } from "./types";

/**
 * Parse raw JSON data (already parsed from JSON.parse) into a
 * validated ServerMessage. Returns null if the data doesn't match
 * any known message type.
 *
 * Usage:
 *   const raw = JSON.parse(event.data);
 *   const msg = parseServerMessage(raw);
 *   if (!msg) { console.warn("Malformed message", raw); return; }
 *   // msg is now a guaranteed ServerMessage
 */
export function parseServerMessage(data: unknown): ServerMessage | null {
  // Must be a non-null object
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  // Must have a `type` string field
  const obj = data as Record<string, unknown>;
  if (typeof obj.type !== "string") {
    return null;
  }

  // Must have a `seq` number field (all server messages have this)
  if (typeof obj.seq !== "number" || !Number.isFinite(obj.seq)) {
    return null;
  }

  // Dispatch to type-specific validators
  switch (obj.type) {
    case "TOKEN":
      return parseToken(obj);
    case "TOOL_CALL":
      return parseToolCall(obj);
    case "TOOL_RESULT":
      return parseToolResult(obj);
    case "CONTEXT_SNAPSHOT":
      return parseContextSnapshot(obj);
    case "PING":
      return parsePing(obj);
    case "STREAM_END":
      return parseStreamEnd(obj);
    case "ERROR":
      return parseError(obj);
    default:
      // Unknown type — could be a future protocol extension.
      // Return null so we skip it gracefully.
      return null;
  }
}

// ── Type-specific validators ────────────────────────────────

function parseToken(obj: Record<string, unknown>): ServerMessage | null {
  if (typeof obj.text !== "string") return null;
  if (typeof obj.stream_id !== "string") return null;

  return {
    type: "TOKEN",
    seq: obj.seq as number,
    text: obj.text,
    stream_id: obj.stream_id,
  };
}

function parseToolCall(obj: Record<string, unknown>): ServerMessage | null {
  if (typeof obj.call_id !== "string") return null;
  if (typeof obj.tool_name !== "string") return null;
  if (typeof obj.args !== "object" || obj.args === null) return null;
  if (typeof obj.stream_id !== "string") return null;

  return {
    type: "TOOL_CALL",
    seq: obj.seq as number,
    call_id: obj.call_id,
    tool_name: obj.tool_name,
    args: obj.args as Record<string, unknown>,
    stream_id: obj.stream_id,
  };
}

function parseToolResult(obj: Record<string, unknown>): ServerMessage | null {
  if (typeof obj.call_id !== "string") return null;
  if (typeof obj.result !== "object" || obj.result === null) return null;
  if (typeof obj.stream_id !== "string") return null;

  return {
    type: "TOOL_RESULT",
    seq: obj.seq as number,
    call_id: obj.call_id,
    result: obj.result as Record<string, unknown>,
    stream_id: obj.stream_id,
  };
}

function parseContextSnapshot(obj: Record<string, unknown>): ServerMessage | null {
  if (typeof obj.context_id !== "string") return null;
  if (typeof obj.data !== "object" || obj.data === null) return null;

  return {
    type: "CONTEXT_SNAPSHOT",
    seq: obj.seq as number,
    context_id: obj.context_id,
    data: obj.data as Record<string, unknown>,
  };
}

function parsePing(obj: Record<string, unknown>): ServerMessage | null {
  // NOTE: challenge CAN be empty string "" in chaos mode.
  // We still accept it — the client must reply with PONG { echo: "" }.
  // We only reject if challenge is not a string at all.
  if (typeof obj.challenge !== "string") return null;

  return {
    type: "PING",
    seq: obj.seq as number,
    challenge: obj.challenge,
  };
}

function parseStreamEnd(obj: Record<string, unknown>): ServerMessage | null {
  if (typeof obj.stream_id !== "string") return null;

  return {
    type: "STREAM_END",
    seq: obj.seq as number,
    stream_id: obj.stream_id,
  };
}

function parseError(obj: Record<string, unknown>): ServerMessage | null {
  if (typeof obj.code !== "string") return null;
  if (typeof obj.message !== "string") return null;

  return {
    type: "ERROR",
    seq: obj.seq as number,
    code: obj.code,
    message: obj.message,
  };
}

/**
 * Convenience: parse a raw WebSocket message string into a ServerMessage.
 * Handles JSON.parse errors gracefully.
 *
 * Usage:
 *   ws.onmessage = (event) => {
 *     const msg = parseRawMessage(event.data);
 *     if (!msg) return; // malformed
 *     // process msg
 *   };
 */
export function parseRawMessage(raw: string): ServerMessage | null {
  try {
    const data: unknown = JSON.parse(raw);
    return parseServerMessage(data);
  } catch {
    // JSON.parse failed — malformed data
    return null;
  }
}
