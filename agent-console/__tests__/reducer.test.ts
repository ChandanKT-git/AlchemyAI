// ─────────────────────────────────────────────────────────────
// Tests for the Agent Reducer
//
// These tests verify every state transition:
// 1. TOKEN appends text to the current TextBlock
// 2. TOOL_CALL freezes text, creates a new ToolCallBlock
// 3. TOOL_RESULT updates the correct ToolCallBlock
// 4. Sequential tool calls produce stacked blocks
// 5. STREAM_END marks stream complete
// 6. CONTEXT_SNAPSHOT stores snapshots with history
// 7. resetForNewTurn clears stream but preserves context
// ─────────────────────────────────────────────────────────────

import {
  agentReducer,
  createInitialState,
  resetForNewTurn,
  clearPendingAcks,
} from "@/lib/agent/reducer";
import type { AgentState } from "@/lib/agent/types";
import type { ServerMessage } from "@/lib/protocol/types";

// ── Helpers ──────────────────────────────────────────────────

function token(seq: number, text: string): ServerMessage {
  return { type: "TOKEN", seq, text, stream_id: "s_001" };
}

function toolCall(
  seq: number,
  callId: string,
  toolName: string,
  args: Record<string, unknown> = {}
): ServerMessage {
  return {
    type: "TOOL_CALL",
    seq,
    call_id: callId,
    tool_name: toolName,
    args,
    stream_id: "s_001",
  };
}

function toolResult(
  seq: number,
  callId: string,
  result: Record<string, unknown> = {}
): ServerMessage {
  return {
    type: "TOOL_RESULT",
    seq,
    call_id: callId,
    result,
    stream_id: "s_001",
  };
}

function contextSnapshot(
  seq: number,
  contextId: string,
  data: Record<string, unknown>
): ServerMessage {
  return { type: "CONTEXT_SNAPSHOT", seq, context_id: contextId, data };
}

function streamEnd(seq: number): ServerMessage {
  return { type: "STREAM_END", seq, stream_id: "s_001" };
}

function ping(seq: number, challenge: string): ServerMessage {
  return { type: "PING", seq, challenge };
}

function errorMsg(seq: number, code: string, message: string): ServerMessage {
  return { type: "ERROR", seq, code, message };
}

/** Apply a sequence of messages to a fresh state */
function applyAll(messages: ServerMessage[]): AgentState {
  let state = createInitialState();
  for (const msg of messages) {
    state = agentReducer(state, msg);
  }
  return state;
}

// ── TOKEN handling ───────────────────────────────────────────

describe("agentReducer — TOKEN", () => {
  test("first TOKEN creates a TextBlock and sets status to streaming", () => {
    const state = applyAll([token(1, "Hello ")]);

    expect(state.stream.status).toBe("streaming");
    expect(state.stream.streamId).toBe("s_001");
    expect(state.stream.blocks).toHaveLength(1);
    expect(state.stream.blocks[0].kind).toBe("text");
    if (state.stream.blocks[0].kind === "text") {
      expect(state.stream.blocks[0].text).toBe("Hello ");
      expect(state.stream.blocks[0].tokenCount).toBe(1);
    }
  });

  test("subsequent TOKENs append to the same TextBlock", () => {
    const state = applyAll([
      token(1, "Hello "),
      token(2, "World"),
      token(3, "!"),
    ]);

    expect(state.stream.blocks).toHaveLength(1);
    if (state.stream.blocks[0].kind === "text") {
      expect(state.stream.blocks[0].text).toBe("Hello World!");
      expect(state.stream.blocks[0].tokenCount).toBe(3);
    }
  });
});

// ── TOOL_CALL handling ───────────────────────────────────────

describe("agentReducer — TOOL_CALL", () => {
  test("TOOL_CALL freezes text and creates ToolCallBlock + empty TextBlock", () => {
    const state = applyAll([
      token(1, "Let me look that up."),
      toolCall(2, "tc_001", "lookup_metric", { metric: "revenue" }),
    ]);

    // Should have: TextBlock, ToolCallBlock, TextBlock (empty)
    expect(state.stream.blocks).toHaveLength(3);
    expect(state.stream.status).toBe("tool_pending");

    // Block 0: frozen text
    expect(state.stream.blocks[0].kind).toBe("text");
    if (state.stream.blocks[0].kind === "text") {
      expect(state.stream.blocks[0].text).toBe("Let me look that up.");
    }

    // Block 1: tool call card
    expect(state.stream.blocks[1].kind).toBe("tool_call");
    if (state.stream.blocks[1].kind === "tool_call") {
      expect(state.stream.blocks[1].callId).toBe("tc_001");
      expect(state.stream.blocks[1].toolName).toBe("lookup_metric");
      expect(state.stream.blocks[1].args).toEqual({ metric: "revenue" });
      expect(state.stream.blocks[1].status).toBe("pending");
      expect(state.stream.blocks[1].result).toBeNull();
    }

    // Block 2: empty text block for post-tool tokens
    expect(state.stream.blocks[2].kind).toBe("text");
    if (state.stream.blocks[2].kind === "text") {
      expect(state.stream.blocks[2].text).toBe("");
    }
  });

  test("TOOL_CALL before any tokens (immediate tool call)", () => {
    const state = applyAll([
      toolCall(1, "tc_001", "search_docs", { query: "SLA" }),
    ]);

    // Should have: ToolCallBlock, TextBlock (empty)
    expect(state.stream.blocks).toHaveLength(2);
    expect(state.stream.blocks[0].kind).toBe("tool_call");
    expect(state.stream.blocks[1].kind).toBe("text");
    expect(state.stream.status).toBe("tool_pending");
  });
});

// ── TOOL_RESULT handling ─────────────────────────────────────

describe("agentReducer — TOOL_RESULT", () => {
  test("TOOL_RESULT updates the matching ToolCallBlock", () => {
    const state = applyAll([
      token(1, "Looking up..."),
      toolCall(2, "tc_001", "lookup_metric", { metric: "revenue" }),
      toolResult(3, "tc_001", { value: "23.4%", period: "YoY" }),
    ]);

    // Find the tool call block
    const toolBlock = state.stream.blocks.find(
      (b) => b.kind === "tool_call" && b.callId === "tc_001"
    );
    expect(toolBlock).toBeDefined();
    if (toolBlock?.kind === "tool_call") {
      expect(toolBlock.status).toBe("complete");
      expect(toolBlock.result).toEqual({ value: "23.4%", period: "YoY" });
    }

    // Status should return to streaming (no more pending tools)
    expect(state.stream.status).toBe("streaming");
  });

  test("tokens resume after TOOL_RESULT into the trailing TextBlock", () => {
    const state = applyAll([
      token(1, "Before."),
      toolCall(2, "tc_001", "lookup"),
      toolResult(3, "tc_001", { val: 42 }),
      token(4, "After."),
    ]);

    // Blocks: Text("Before."), ToolCall(complete), Text("After.")
    expect(state.stream.blocks).toHaveLength(3);
    const lastBlock = state.stream.blocks[2];
    expect(lastBlock.kind).toBe("text");
    if (lastBlock.kind === "text") {
      expect(lastBlock.text).toBe("After.");
    }
  });
});

// ── Sequential tool calls ────────────────────────────────────

describe("agentReducer — sequential tool calls", () => {
  test("two sequential tool calls produce stacked blocks", () => {
    const state = applyAll([
      token(1, "Starting analysis..."),
      toolCall(2, "tc_001", "fetch_dataset"),
      toolResult(3, "tc_001", { rows: 1000 }),
      token(4, "Got data. "),
      toolCall(5, "tc_002", "compute_correlation"),
      toolResult(6, "tc_002", { r: 0.87 }),
      token(7, "Correlation is 0.87."),
    ]);

    // Expected blocks:
    // 0: Text("Starting analysis...")
    // 1: ToolCall(fetch_dataset, complete)
    // 2: Text("Got data. ")
    // 3: ToolCall(compute_correlation, complete)
    // 4: Text("Correlation is 0.87.")
    expect(state.stream.blocks).toHaveLength(5);

    expect(state.stream.blocks[0].kind).toBe("text");
    expect(state.stream.blocks[1].kind).toBe("tool_call");
    expect(state.stream.blocks[2].kind).toBe("text");
    expect(state.stream.blocks[3].kind).toBe("tool_call");
    expect(state.stream.blocks[4].kind).toBe("text");

    if (state.stream.blocks[1].kind === "tool_call") {
      expect(state.stream.blocks[1].toolName).toBe("fetch_dataset");
      expect(state.stream.blocks[1].status).toBe("complete");
    }
    if (state.stream.blocks[3].kind === "tool_call") {
      expect(state.stream.blocks[3].toolName).toBe("compute_correlation");
      expect(state.stream.blocks[3].status).toBe("complete");
    }

    // Final text
    if (state.stream.blocks[4].kind === "text") {
      expect(state.stream.blocks[4].text).toBe("Correlation is 0.87.");
    }
  });

  test("rapid back-to-back tool calls (no tokens between)", () => {
    const state = applyAll([
      toolCall(1, "tc_001", "tool_a"),
      toolCall(2, "tc_002", "tool_b"),
    ]);

    // Blocks: ToolCall_a, Text(empty), ToolCall_b, Text(empty)
    expect(state.stream.blocks).toHaveLength(4);
    expect(state.stream.blocks[0].kind).toBe("tool_call");
    expect(state.stream.blocks[1].kind).toBe("text");
    expect(state.stream.blocks[2].kind).toBe("tool_call");
    expect(state.stream.blocks[3].kind).toBe("text");
    expect(state.stream.status).toBe("tool_pending");
  });
});

// ── STREAM_END ───────────────────────────────────────────────

describe("agentReducer — STREAM_END", () => {
  test("STREAM_END marks stream as complete", () => {
    const state = applyAll([
      token(1, "Hello!"),
      streamEnd(2),
    ]);

    expect(state.stream.status).toBe("complete");
  });
});

// ── CONTEXT_SNAPSHOT ──────────────────────────────────────────

describe("agentReducer — CONTEXT_SNAPSHOT", () => {
  test("stores context by context_id", () => {
    const state = applyAll([
      contextSnapshot(1, "ctx_report", { report: "Q3", pages: 47 }),
    ]);

    expect(state.context.contexts["ctx_report"]).toHaveLength(1);
    expect(state.context.contexts["ctx_report"][0].data).toEqual({
      report: "Q3",
      pages: 47,
    });
    expect(state.context.contexts["ctx_report"][0].seq).toBe(1);
  });

  test("multiple snapshots for same context_id build history", () => {
    const state = applyAll([
      contextSnapshot(1, "ctx_report", { version: 1 }),
      contextSnapshot(5, "ctx_report", { version: 2, updated: true }),
    ]);

    expect(state.context.contexts["ctx_report"]).toHaveLength(2);
    expect(state.context.contexts["ctx_report"][0].data).toEqual({ version: 1 });
    expect(state.context.contexts["ctx_report"][1].data).toEqual({
      version: 2,
      updated: true,
    });
  });

  test("different context_ids are stored separately", () => {
    const state = applyAll([
      contextSnapshot(1, "ctx_a", { a: 1 }),
      contextSnapshot(2, "ctx_b", { b: 2 }),
    ]);

    expect(Object.keys(state.context.contexts)).toHaveLength(2);
    expect(state.context.contexts["ctx_a"]).toHaveLength(1);
    expect(state.context.contexts["ctx_b"]).toHaveLength(1);
  });
});

// ── PING ─────────────────────────────────────────────────────

describe("agentReducer — PING", () => {
  test("PING adds a timeline entry but doesn't change stream", () => {
    let state = createInitialState();
    state = agentReducer(state, ping(1, "abc123"));

    expect(state.timeline).toHaveLength(1);
    expect(state.timeline[0].type).toBe("PING");
    expect(state.stream.status).toBe("idle");
  });
});

// ── ERROR ────────────────────────────────────────────────────

describe("agentReducer — ERROR", () => {
  test("ERROR stores the error and adds timeline entry", () => {
    const state = applyAll([
      errorMsg(1, "INTERNAL_ERROR", "Something went wrong"),
    ]);

    expect(state.lastError).toEqual({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
    });
    expect(state.timeline).toHaveLength(1);
    expect(state.timeline[0].type).toBe("ERROR");
  });
});

// ── Timeline ─────────────────────────────────────────────────

describe("agentReducer — Timeline", () => {
  test("every message creates a timeline entry", () => {
    const state = applyAll([
      contextSnapshot(1, "ctx", { data: true }),
      token(2, "Hello"),
      token(3, " World"),
      toolCall(4, "tc_001", "lookup"),
      toolResult(5, "tc_001", { val: 42 }),
      token(6, "Done."),
      streamEnd(7),
    ]);

    expect(state.timeline).toHaveLength(7);
    expect(state.timeline.map((t) => t.type)).toEqual([
      "CONTEXT_SNAPSHOT",
      "TOKEN",
      "TOKEN",
      "TOOL_CALL",
      "TOOL_RESULT",
      "TOKEN",
      "STREAM_END",
    ]);
  });

  test("TOOL_CALL and TOOL_RESULT timeline entries have callId", () => {
    const state = applyAll([
      toolCall(1, "tc_001", "search"),
      toolResult(2, "tc_001", {}),
    ]);

    expect(state.timeline[0].callId).toBe("tc_001");
    expect(state.timeline[1].callId).toBe("tc_001");
  });
});

// ── resetForNewTurn ──────────────────────────────────────────

describe("resetForNewTurn", () => {
  test("resets stream and timeline but preserves context", () => {
    // Build up some state
    let state = applyAll([
      contextSnapshot(1, "ctx_report", { report: "Q3" }),
      token(2, "Hello"),
      token(3, " World"),
      streamEnd(4),
    ]);

    // Now reset for a new turn
    state = resetForNewTurn(state);

    // Stream is reset
    expect(state.stream.status).toBe("idle");
    expect(state.stream.blocks).toHaveLength(0);
    expect(state.stream.streamId).toBeNull();

    // Timeline is reset
    expect(state.timeline).toHaveLength(0);

    // Context is preserved!
    expect(state.context.contexts["ctx_report"]).toHaveLength(1);
    expect(state.context.contexts["ctx_report"][0].data).toEqual({ report: "Q3" });

    // Error is cleared
    expect(state.lastError).toBeNull();
  });
});

// ── Full integration scenario ────────────────────────────────

describe("agentReducer — full integration", () => {
  test("simulates 'summarize the report' flow", () => {
    const state = applyAll([
      // Server sends context first
      contextSnapshot(1, "ctx_report", { report: "Q3-2025", pages: 47 }),
      // Then starts streaming tokens
      token(2, "Based "),
      token(3, "on "),
      token(4, "the "),
      token(5, "report, "),
      // Tool call interrupts
      toolCall(6, "tc_001", "lookup_metric", { metric: "revenue_yoy" }),
      // Tool result arrives
      toolResult(7, "tc_001", { value: "23.4%", period: "YoY" }),
      // Context updated after tool call
      contextSnapshot(8, "ctx_report", {
        report: "Q3-2025",
        pages: 47,
        metrics_fetched: true,
      }),
      // Streaming resumes
      token(9, "the "),
      token(10, "revenue "),
      token(11, "grew "),
      token(12, "23.4%."),
      // Stream ends
      streamEnd(13),
    ]);

    // Stream is complete
    expect(state.stream.status).toBe("complete");

    // Blocks: Text, ToolCall, Text
    expect(state.stream.blocks).toHaveLength(3);

    // First text block (pre-tool)
    if (state.stream.blocks[0].kind === "text") {
      expect(state.stream.blocks[0].text).toBe("Based on the report, ");
    }

    // Tool call block
    if (state.stream.blocks[1].kind === "tool_call") {
      expect(state.stream.blocks[1].toolName).toBe("lookup_metric");
      expect(state.stream.blocks[1].status).toBe("complete");
      expect(state.stream.blocks[1].result).toEqual({
        value: "23.4%",
        period: "YoY",
      });
    }

    // Second text block (post-tool)
    if (state.stream.blocks[2].kind === "text") {
      expect(state.stream.blocks[2].text).toBe("the revenue grew 23.4%.");
    }

    // Context has 2 snapshots (history)
    expect(state.context.contexts["ctx_report"]).toHaveLength(2);

    // Timeline has 13 entries
    expect(state.timeline).toHaveLength(13);
  });
});

// ── pendingAcks — TOOL_ACK queueing ─────────────────────────

describe("agentReducer — pendingAcks", () => {
  test("initial state has empty pendingAcks", () => {
    const state = createInitialState();
    expect(state.pendingAcks).toEqual([]);
  });

  test("TOOL_CALL queues callId in pendingAcks", () => {
    const state = applyAll([
      toolCall(1, "tc_001", "lookup_metric"),
    ]);

    expect(state.pendingAcks).toContain("tc_001");
  });

  test("multiple TOOL_CALLs queue all callIds", () => {
    const state = applyAll([
      toolCall(1, "tc_001", "tool_a"),
      toolCall(2, "tc_002", "tool_b"),
    ]);

    expect(state.pendingAcks).toContain("tc_001");
    expect(state.pendingAcks).toContain("tc_002");
  });

  test("clearPendingAcks empties the queue", () => {
    let state = applyAll([
      toolCall(1, "tc_001", "lookup"),
    ]);
    expect(state.pendingAcks).toHaveLength(1);

    state = clearPendingAcks(state);
    expect(state.pendingAcks).toHaveLength(0);
  });

  test("clearPendingAcks is a no-op if queue is already empty", () => {
    const state = createInitialState();
    const result = clearPendingAcks(state);
    expect(result).toBe(state); // same reference (no unnecessary re-render)
  });

  test("resetForNewTurn clears pendingAcks", () => {
    let state = applyAll([
      toolCall(1, "tc_001", "lookup"),
    ]);
    expect(state.pendingAcks).toHaveLength(1);

    state = resetForNewTurn(state);
    expect(state.pendingAcks).toHaveLength(0);
  });
});

// ── TOOL_CALL dedup (reconnection replay) ────────────────────

describe("agentReducer — TOOL_CALL dedup", () => {
  test("duplicate TOOL_CALL (same callId) does not create second block", () => {
    const state = applyAll([
      token(1, "Before."),
      toolCall(2, "tc_001", "lookup"),
      // Simulate reconnect replay — same TOOL_CALL arrives again
      toolCall(2, "tc_001", "lookup"),
    ]);

    // Should still have only 3 blocks: Text, ToolCall, Text
    // NOT 5 blocks (Text, ToolCall, Text, ToolCall, Text)
    const toolBlocks = state.stream.blocks.filter(
      (b) => b.kind === "tool_call"
    );
    expect(toolBlocks).toHaveLength(1);
  });

  test("duplicate TOOL_CALL re-queues ACK (server needs it for new connection)", () => {
    let state = applyAll([
      toolCall(1, "tc_001", "lookup"),
    ]);

    // Clear the first ACK (as if the provider sent it)
    state = clearPendingAcks(state);
    expect(state.pendingAcks).toHaveLength(0);

    // Simulate reconnect replay — same TOOL_CALL arrives again
    state = agentReducer(state, toolCall(1, "tc_001", "lookup"));

    // ACK is queued again for the new connection
    expect(state.pendingAcks).toContain("tc_001");
  });

  test("different callIds are NOT deduped", () => {
    const state = applyAll([
      toolCall(1, "tc_001", "tool_a"),
      toolCall(2, "tc_002", "tool_b"),
    ]);

    const toolBlocks = state.stream.blocks.filter(
      (b) => b.kind === "tool_call"
    );
    expect(toolBlocks).toHaveLength(2);
  });
});
