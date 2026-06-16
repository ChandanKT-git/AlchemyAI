// ─────────────────────────────────────────────────────────────
// Agent Reducer — Pure state machine for stream/tool events
//
// This is the heart of Layer 2. It takes the current state and
// a server message, and returns a NEW state (immutable update).
//
// STATE TRANSITIONS:
//   TOKEN         → append text to the last TextBlock
//   TOOL_CALL     → freeze current text, push ToolCallBlock + new TextBlock
//   TOOL_RESULT   → update matching ToolCallBlock by call_id
//   STREAM_END    → mark stream as "complete"
//   CONTEXT_SNAPSHOT → store in context history by context_id
//   PING          → timeline entry only (PONG is handled in ws-client)
//   ERROR         → store error
//
// WHY A REDUCER?
// With scattered useState, a TOOL_CALL would need to:
//   setTokens(prev => freeze)
//   setToolCards(prev => [...prev, card])
//   setStreamStatus("tool_pending")
// These 3 updates could render intermediate inconsistent states.
// A reducer does all 3 atomically in one state transition.
// ─────────────────────────────────────────────────────────────

import type { ServerMessage } from "@/lib/protocol/types";
import type {
  AgentState,
  StreamState,
  TextBlock,
  ToolCallBlock,
  Block,
  TimelineEntry,
} from "./types";

// ── Initial State ────────────────────────────────────────────

export function createInitialState(): AgentState {
  return {
    stream: createInitialStreamState(),
    context: { contexts: {} },
    timeline: [],
    lastError: null,
    pendingAcks: [],
  };
}

function createInitialStreamState(): StreamState {
  return {
    streamId: null,
    status: "idle",
    blocks: [],
  };
}

// ── Reducer ──────────────────────────────────────────────────

/**
 * Pure reducer: (state, message) → newState
 *
 * This function NEVER mutates the input state. It always returns
 * a new object. This is critical for React — if we mutated state,
 * React wouldn't know to re-render.
 */
export function agentReducer(
  state: AgentState,
  msg: ServerMessage
): AgentState {
  // Build timeline entry for every message
  const timelineEntry = createTimelineEntry(msg);

  // Start with timeline updated (every message gets logged)
  const withTimeline: AgentState = {
    ...state,
    timeline: [...state.timeline, timelineEntry],
  };

  switch (msg.type) {
    case "TOKEN":
      return handleToken(withTimeline, msg.text, msg.stream_id);

    case "TOOL_CALL":
      return handleToolCall(
        withTimeline,
        msg.call_id,
        msg.tool_name,
        msg.args,
        msg.stream_id
      );  // Also queues the call_id in pendingAcks

    case "TOOL_RESULT":
      return handleToolResult(withTimeline, msg.call_id, msg.result);

    case "STREAM_END":
      return handleStreamEnd(withTimeline);

    case "CONTEXT_SNAPSHOT":
      return handleContextSnapshot(
        withTimeline,
        msg.context_id,
        msg.data,
        msg.seq
      );

    case "PING":
      // PONG reply is handled in ws-client.ts.
      // We just record it in the timeline (already done above).
      return withTimeline;

    case "ERROR":
      return {
        ...withTimeline,
        lastError: { code: msg.code, message: msg.message },
      };

    default:
      return withTimeline;
  }
}

// ── Handlers ─────────────────────────────────────────────────

function handleToken(
  state: AgentState,
  text: string,
  streamId: string
): AgentState {
  const stream = state.stream;

  // If this is the first token, initialize the stream
  const blocks =
    stream.blocks.length === 0
      ? [createTextBlock()]  // First token → create initial TextBlock
      : [...stream.blocks];

  // Append text to the LAST TextBlock
  const lastBlock = blocks[blocks.length - 1];

  if (lastBlock.kind === "text") {
    // Replace last block with updated text (immutable)
    blocks[blocks.length - 1] = {
      ...lastBlock,
      text: lastBlock.text + text,
      tokenCount: lastBlock.tokenCount + 1,
    };
  } else {
    // Last block is a ToolCallBlock — this shouldn't happen if
    // TOOL_RESULT was processed, but handle it defensively by
    // creating a new TextBlock
    blocks.push({ kind: "text", text, tokenCount: 1 });
  }

  return {
    ...state,
    stream: {
      streamId,
      status: "streaming",
      blocks,
    },
  };
}

function handleToolCall(
  state: AgentState,
  callId: string,
  toolName: string,
  args: Record<string, unknown>,
  streamId: string
): AgentState {
  // ── DEDUP CHECK ──────────────────────────────────────
  // On reconnect, the server replays events including TOOL_CALL.
  // If we already have a ToolCallBlock with this callId,
  // DON'T create a second card — but DO queue the ACK again
  // (the server needs it for the new connection).
  const alreadyExists = state.stream.blocks.some(
    (b) => b.kind === "tool_call" && b.callId === callId
  );

  if (alreadyExists) {
    // Card exists — just re-queue the ACK
    return {
      ...state,
      pendingAcks: [...state.pendingAcks, callId],
    };
  }

  // ── NORMAL PATH ──────────────────────────────────────
  const blocks = [...state.stream.blocks];

  // If there are no blocks yet (tool call before any tokens),
  // we don't need to freeze anything — just add the tool card
  if (blocks.length === 0) {
    blocks.push(createToolCallBlock(callId, toolName, args));
    blocks.push(createTextBlock()); // Empty TextBlock for post-tool tokens
  } else {
    // Freeze current text (don't modify the last TextBlock anymore)
    // Add tool card and a new empty TextBlock
    blocks.push(createToolCallBlock(callId, toolName, args));
    blocks.push(createTextBlock());
  }

  return {
    ...state,
    stream: {
      streamId,
      status: "tool_pending",
      blocks,
    },
    // Queue TOOL_ACK — the provider will send it
    pendingAcks: [...state.pendingAcks, callId],
  };
}

function handleToolResult(
  state: AgentState,
  callId: string,
  result: Record<string, unknown>
): AgentState {
  // Find the ToolCallBlock with matching call_id and update it
  const blocks = state.stream.blocks.map((block): Block => {
    if (block.kind === "tool_call" && block.callId === callId) {
      return {
        ...block,
        result,
        status: "complete",
      };
    }
    return block;
  });

  // Check if there are still pending tool calls
  const hasPending = blocks.some(
    (b) => b.kind === "tool_call" && b.status === "pending"
  );

  return {
    ...state,
    stream: {
      ...state.stream,
      status: hasPending ? "tool_pending" : "streaming",
      blocks,
    },
  };
}

function handleStreamEnd(state: AgentState): AgentState {
  return {
    ...state,
    stream: {
      ...state.stream,
      status: "complete",
    },
  };
}

function handleContextSnapshot(
  state: AgentState,
  contextId: string,
  data: Record<string, unknown>,
  seq: number
): AgentState {
  const existing = state.context.contexts[contextId] ?? [];

  return {
    ...state,
    context: {
      contexts: {
        ...state.context.contexts,
        [contextId]: [...existing, { data, seq }],
      },
    },
  };
}

// ── Helper: reset stream for a new turn ──────────────────────

/**
 * Reset the agent state for a new conversation turn.
 * Called when the user sends a new message.
 * Preserves context history but resets stream and timeline.
 */
export function resetForNewTurn(state: AgentState): AgentState {
  return {
    ...state,
    stream: createInitialStreamState(),
    timeline: [],
    lastError: null,
    pendingAcks: [],
  };
}

/**
 * Clear the pendingAcks queue after the provider has sent them.
 * This is called by the context provider after it sends TOOL_ACK
 * messages over the WebSocket.
 */
export function clearPendingAcks(state: AgentState): AgentState {
  if (state.pendingAcks.length === 0) return state;
  return { ...state, pendingAcks: [] };
}

// ── Factory functions ────────────────────────────────────────

function createTextBlock(): TextBlock {
  return { kind: "text", text: "", tokenCount: 0 };
}

function createToolCallBlock(
  callId: string,
  toolName: string,
  args: Record<string, unknown>
): ToolCallBlock {
  return {
    kind: "tool_call",
    callId,
    toolName,
    args,
    result: null,
    status: "pending",
  };
}

// ── Timeline entry creation ──────────────────────────────────

function createTimelineEntry(msg: ServerMessage): TimelineEntry {
  const base = {
    seq: msg.seq,
    timestamp: Date.now(),
  };

  switch (msg.type) {
    case "TOKEN":
      return {
        ...base,
        type: "TOKEN",
        summary: `"${msg.text.slice(0, 30)}${msg.text.length > 30 ? "..." : ""}"`,
      };

    case "TOOL_CALL":
      return {
        ...base,
        type: "TOOL_CALL",
        summary: `${msg.tool_name}(${Object.keys(msg.args).join(", ")})`,
        callId: msg.call_id,
      };

    case "TOOL_RESULT":
      return {
        ...base,
        type: "TOOL_RESULT",
        summary: `Result for ${msg.call_id}`,
        callId: msg.call_id,
      };

    case "CONTEXT_SNAPSHOT":
      return {
        ...base,
        type: "CONTEXT_SNAPSHOT",
        summary: `${msg.context_id} (${JSON.stringify(msg.data).length} bytes)`,
      };

    case "PING":
      return {
        ...base,
        type: "PING",
        summary: `challenge: "${msg.challenge}"`,
      };

    case "STREAM_END":
      return {
        ...base,
        type: "STREAM_END",
        summary: `Stream ${msg.stream_id} ended`,
      };

    case "ERROR":
      return {
        ...base,
        type: "ERROR",
        summary: `${msg.code}: ${msg.message}`,
      };
  }
}
