// ─────────────────────────────────────────────────────────────
// Tests for the protocol parser
//
// These tests verify that:
// 1. Valid messages of every type parse correctly
// 2. Missing required fields return null (not crash)
// 3. Extra fields are tolerated (forward compatibility)
// 4. Edge cases (empty strings, non-JSON) are handled
// ─────────────────────────────────────────────────────────────

import { parseServerMessage, parseRawMessage } from "@/lib/protocol/parse";

// ── Valid message parsing ────────────────────────────────────

describe("parseServerMessage — valid messages", () => {
  test("TOKEN", () => {
    const msg = parseServerMessage({
      type: "TOKEN",
      seq: 1,
      text: "Hello ",
      stream_id: "s_001",
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("TOKEN");
    if (msg!.type === "TOKEN") {
      expect(msg!.text).toBe("Hello ");
      expect(msg!.stream_id).toBe("s_001");
      expect(msg!.seq).toBe(1);
    }
  });

  test("TOOL_CALL", () => {
    const msg = parseServerMessage({
      type: "TOOL_CALL",
      seq: 5,
      call_id: "tc_001",
      tool_name: "lookup_metric",
      args: { metric: "revenue_yoy" },
      stream_id: "s_001",
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("TOOL_CALL");
    if (msg!.type === "TOOL_CALL") {
      expect(msg!.call_id).toBe("tc_001");
      expect(msg!.tool_name).toBe("lookup_metric");
      expect(msg!.args).toEqual({ metric: "revenue_yoy" });
      expect(msg!.stream_id).toBe("s_001");
    }
  });

  test("TOOL_RESULT", () => {
    const msg = parseServerMessage({
      type: "TOOL_RESULT",
      seq: 6,
      call_id: "tc_001",
      result: { value: "23.4%", period: "YoY" },
      stream_id: "s_001",
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("TOOL_RESULT");
    if (msg!.type === "TOOL_RESULT") {
      expect(msg!.call_id).toBe("tc_001");
      expect(msg!.result).toEqual({ value: "23.4%", period: "YoY" });
    }
  });

  test("CONTEXT_SNAPSHOT", () => {
    const msg = parseServerMessage({
      type: "CONTEXT_SNAPSHOT",
      seq: 1,
      context_id: "ctx_report",
      data: { report: "Q3-2025", pages: 47 },
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("CONTEXT_SNAPSHOT");
    if (msg!.type === "CONTEXT_SNAPSHOT") {
      expect(msg!.context_id).toBe("ctx_report");
      expect(msg!.data).toEqual({ report: "Q3-2025", pages: 47 });
    }
  });

  test("PING with normal challenge", () => {
    const msg = parseServerMessage({
      type: "PING",
      seq: 15,
      challenge: "a1b2c3",
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("PING");
    if (msg!.type === "PING") {
      expect(msg!.challenge).toBe("a1b2c3");
    }
  });

  test("PING with empty challenge (chaos mode)", () => {
    // In chaos mode, the server sends PINGs with empty challenge.
    // This is VALID — we must accept it and reply PONG { echo: "" }.
    const msg = parseServerMessage({
      type: "PING",
      seq: 20,
      challenge: "",
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("PING");
    if (msg!.type === "PING") {
      expect(msg!.challenge).toBe("");
    }
  });

  test("STREAM_END", () => {
    const msg = parseServerMessage({
      type: "STREAM_END",
      seq: 42,
      stream_id: "s_001",
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("STREAM_END");
    if (msg!.type === "STREAM_END") {
      expect(msg!.stream_id).toBe("s_001");
    }
  });

  test("ERROR", () => {
    const msg = parseServerMessage({
      type: "ERROR",
      seq: 10,
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("ERROR");
    if (msg!.type === "ERROR") {
      expect(msg!.code).toBe("INTERNAL_ERROR");
      expect(msg!.message).toBe("Something went wrong");
    }
  });
});

// ── Missing required fields ──────────────────────────────────

describe("parseServerMessage — missing fields", () => {
  test("missing type → null", () => {
    expect(parseServerMessage({ seq: 1, text: "hello" })).toBeNull();
  });

  test("missing seq → null", () => {
    expect(parseServerMessage({ type: "TOKEN", text: "hello", stream_id: "s_001" })).toBeNull();
  });

  test("TOKEN missing text → null", () => {
    expect(parseServerMessage({ type: "TOKEN", seq: 1, stream_id: "s_001" })).toBeNull();
  });

  test("TOKEN missing stream_id → null", () => {
    expect(parseServerMessage({ type: "TOKEN", seq: 1, text: "hello" })).toBeNull();
  });

  test("TOOL_CALL missing call_id → null", () => {
    expect(parseServerMessage({
      type: "TOOL_CALL", seq: 1, tool_name: "test",
      args: {}, stream_id: "s_001",
    })).toBeNull();
  });

  test("TOOL_CALL missing args → null", () => {
    expect(parseServerMessage({
      type: "TOOL_CALL", seq: 1, call_id: "tc_1", tool_name: "test",
      stream_id: "s_001",
    })).toBeNull();
  });

  test("TOOL_RESULT missing result → null", () => {
    expect(parseServerMessage({
      type: "TOOL_RESULT", seq: 1, call_id: "tc_1", stream_id: "s_001",
    })).toBeNull();
  });

  test("CONTEXT_SNAPSHOT missing data → null", () => {
    expect(parseServerMessage({
      type: "CONTEXT_SNAPSHOT", seq: 1, context_id: "ctx_1",
    })).toBeNull();
  });

  test("PING missing challenge → null", () => {
    // Note: empty string challenge IS valid. Missing challenge is not.
    expect(parseServerMessage({ type: "PING", seq: 1 })).toBeNull();
  });

  test("ERROR missing code → null", () => {
    expect(parseServerMessage({
      type: "ERROR", seq: 1, message: "oops",
    })).toBeNull();
  });
});

// ── Edge cases ───────────────────────────────────────────────

describe("parseServerMessage — edge cases", () => {
  test("null input → null", () => {
    expect(parseServerMessage(null)).toBeNull();
  });

  test("undefined input → null", () => {
    expect(parseServerMessage(undefined)).toBeNull();
  });

  test("string input → null", () => {
    expect(parseServerMessage("hello")).toBeNull();
  });

  test("number input → null", () => {
    expect(parseServerMessage(42)).toBeNull();
  });

  test("array input → null", () => {
    expect(parseServerMessage([1, 2, 3])).toBeNull();
  });

  test("unknown type → null", () => {
    expect(parseServerMessage({ type: "UNKNOWN", seq: 1 })).toBeNull();
  });

  test("seq is NaN → null", () => {
    expect(parseServerMessage({ type: "TOKEN", seq: NaN, text: "hi", stream_id: "s" })).toBeNull();
  });

  test("seq is Infinity → null", () => {
    expect(parseServerMessage({ type: "TOKEN", seq: Infinity, text: "hi", stream_id: "s" })).toBeNull();
  });

  test("extra fields are preserved (forward compatibility)", () => {
    // If the server adds a new field in the future, we should
    // still parse the message successfully (we just ignore the extra).
    const msg = parseServerMessage({
      type: "TOKEN",
      seq: 1,
      text: "Hello",
      stream_id: "s_001",
      new_future_field: true,      // extra field
      another_one: { nested: 42 }, // extra field
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("TOKEN");
  });

  test("TOOL_CALL args can contain nested objects", () => {
    const msg = parseServerMessage({
      type: "TOOL_CALL",
      seq: 1,
      call_id: "tc_1",
      tool_name: "complex_tool",
      args: {
        nested: { deeply: { value: [1, 2, 3] } },
        flag: true,
      },
      stream_id: "s_001",
    });

    expect(msg).not.toBeNull();
    if (msg!.type === "TOOL_CALL") {
      expect(msg!.args).toEqual({
        nested: { deeply: { value: [1, 2, 3] } },
        flag: true,
      });
    }
  });
});

// ── parseRawMessage (JSON string → ServerMessage) ────────────

describe("parseRawMessage — from raw JSON strings", () => {
  test("valid JSON string → parsed message", () => {
    const raw = JSON.stringify({
      type: "TOKEN",
      seq: 1,
      text: "Hello",
      stream_id: "s_001",
    });

    const msg = parseRawMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("TOKEN");
  });

  test("invalid JSON string → null (no crash)", () => {
    expect(parseRawMessage("{invalid json}")).toBeNull();
  });

  test("empty string → null (no crash)", () => {
    expect(parseRawMessage("")).toBeNull();
  });

  test("non-JSON string → null", () => {
    expect(parseRawMessage("hello world")).toBeNull();
  });

  test("JSON array → null", () => {
    expect(parseRawMessage("[1, 2, 3]")).toBeNull();
  });

  test("JSON null → null", () => {
    expect(parseRawMessage("null")).toBeNull();
  });
});
