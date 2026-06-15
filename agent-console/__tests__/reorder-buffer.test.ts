// ─────────────────────────────────────────────────────────────
// Tests for the Reorder Buffer
//
// These tests verify the three core behaviors:
// 1. In-order messages drain immediately
// 2. Out-of-order messages are buffered and drain when gaps fill
// 3. Duplicate messages are silently skipped
//
// Each test case maps to a real chaos-mode scenario.
// ─────────────────────────────────────────────────────────────

import { ReorderBuffer } from "@/lib/protocol/reorder-buffer";
import type { ServerMessage } from "@/lib/protocol/types";

/** Helper: create a minimal TOKEN message with a given seq */
function token(seq: number, text: string = `t${seq}`): ServerMessage {
  return { type: "TOKEN", seq, text, stream_id: "s_001" };
}

describe("ReorderBuffer", () => {
  let buffer: ReorderBuffer;

  beforeEach(() => {
    buffer = new ReorderBuffer();
  });

  // ── Basic operation ──────────────────────────────────────

  test("empty buffer has lastProcessedSeq = 0", () => {
    expect(buffer.getLastProcessedSeq()).toBe(0);
    expect(buffer.bufferedCount).toBe(0);
  });

  test("single message (seq=1) drains immediately", () => {
    const ready = buffer.insert(token(1));

    expect(ready).toHaveLength(1);
    expect(ready[0].seq).toBe(1);
    expect(buffer.getLastProcessedSeq()).toBe(1);
    expect(buffer.bufferedCount).toBe(0);
  });

  test("in-order sequence drains one at a time", () => {
    const r1 = buffer.insert(token(1));
    const r2 = buffer.insert(token(2));
    const r3 = buffer.insert(token(3));

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r3).toHaveLength(1);
    expect(r1[0].seq).toBe(1);
    expect(r2[0].seq).toBe(2);
    expect(r3[0].seq).toBe(3);
    expect(buffer.getLastProcessedSeq()).toBe(3);
  });

  // ── Deduplication ────────────────────────────────────────

  test("duplicate message is skipped (returns empty)", () => {
    buffer.insert(token(1));
    const duplicate = buffer.insert(token(1));

    expect(duplicate).toHaveLength(0);
    expect(buffer.getLastProcessedSeq()).toBe(1);
  });

  test("triple duplicate is skipped", () => {
    buffer.insert(token(1));
    expect(buffer.insert(token(1))).toHaveLength(0);
    expect(buffer.insert(token(1))).toHaveLength(0);
    expect(buffer.getLastProcessedSeq()).toBe(1);
  });

  // ── Out-of-order delivery ────────────────────────────────

  test("out-of-order: seq=3, seq=1, seq=2 → drains all in order", () => {
    // seq=3 arrives first — buffered (we expect 1)
    const r3 = buffer.insert(token(3));
    expect(r3).toHaveLength(0);
    expect(buffer.bufferedCount).toBe(1);

    // seq=1 arrives — drains immediately (but 2 is still missing)
    const r1 = buffer.insert(token(1));
    expect(r1).toHaveLength(1);
    expect(r1[0].seq).toBe(1);
    expect(buffer.bufferedCount).toBe(1); // seq=3 still buffered

    // seq=2 arrives — drains 2 AND 3 (contiguous chain)
    const r2 = buffer.insert(token(2));
    expect(r2).toHaveLength(2);
    expect(r2[0].seq).toBe(2);
    expect(r2[1].seq).toBe(3);
    expect(buffer.getLastProcessedSeq()).toBe(3);
    expect(buffer.bufferedCount).toBe(0);
  });

  test("fully reversed sequence (5,4,3,2,1) → all drain when 1 arrives", () => {
    expect(buffer.insert(token(5))).toHaveLength(0);
    expect(buffer.insert(token(4))).toHaveLength(0);
    expect(buffer.insert(token(3))).toHaveLength(0);
    expect(buffer.insert(token(2))).toHaveLength(0);

    // When seq=1 arrives, the entire chain 1→2→3→4→5 drains
    const ready = buffer.insert(token(1));
    expect(ready).toHaveLength(5);
    expect(ready.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(buffer.getLastProcessedSeq()).toBe(5);
  });

  test("gap that eventually fills", () => {
    // seq=1 arrives, drains
    buffer.insert(token(1));

    // seq=3 arrives — buffered (gap at 2)
    expect(buffer.insert(token(3))).toHaveLength(0);
    expect(buffer.getLastProcessedSeq()).toBe(1);

    // seq=2 arrives — fills gap, drains 2 and 3
    const ready = buffer.insert(token(2));
    expect(ready).toHaveLength(2);
    expect(ready[0].seq).toBe(2);
    expect(ready[1].seq).toBe(3);
    expect(buffer.getLastProcessedSeq()).toBe(3);
  });

  test("gap that never fills — seq=3 stays buffered", () => {
    buffer.insert(token(1));
    buffer.insert(token(3)); // gap at seq=2

    expect(buffer.getLastProcessedSeq()).toBe(1);
    expect(buffer.bufferedCount).toBe(1);
    // seq=2 never arrives — buffer retains seq=3 indefinitely
  });

  test("large gap (seq=1, seq=100) — only 1 drains", () => {
    const r1 = buffer.insert(token(1));
    expect(r1).toHaveLength(1);

    const r100 = buffer.insert(token(100));
    expect(r100).toHaveLength(0);
    expect(buffer.bufferedCount).toBe(1);
    expect(buffer.getLastProcessedSeq()).toBe(1);
  });

  // ── Mixed scenarios (chaos-like) ─────────────────────────

  test("chaos scenario: reorder + duplicates", () => {
    // Simulates chaos engine: buffer of 4, shuffled, with dupes
    expect(buffer.insert(token(3))).toHaveLength(0); // buffered
    expect(buffer.insert(token(1))).toHaveLength(1); // drain 1
    expect(buffer.insert(token(1))).toHaveLength(0); // duplicate
    expect(buffer.insert(token(4))).toHaveLength(0); // buffered
    expect(buffer.insert(token(2))).toHaveLength(3); // drain 2,3,4

    expect(buffer.getLastProcessedSeq()).toBe(4);
    expect(buffer.bufferedCount).toBe(0);
  });

  test("chaos scenario: multiple gaps fill in stages", () => {
    // Arrive: 1, 4, 2, 6, 3, 5
    buffer.insert(token(1));               // drain 1
    expect(buffer.insert(token(4))).toHaveLength(0);  // buffer
    const r2 = buffer.insert(token(2));    // drain 2 (gap at 3)
    expect(r2).toHaveLength(1);
    expect(buffer.insert(token(6))).toHaveLength(0);  // buffer
    const r3 = buffer.insert(token(3));    // drain 3, 4 (gap at 5)
    expect(r3).toHaveLength(2);
    expect(r3.map((m) => m.seq)).toEqual([3, 4]);
    const r5 = buffer.insert(token(5));    // drain 5, 6
    expect(r5).toHaveLength(2);
    expect(r5.map((m) => m.seq)).toEqual([5, 6]);

    expect(buffer.getLastProcessedSeq()).toBe(6);
  });

  // ── Different message types ──────────────────────────────

  test("handles mixed message types in correct order", () => {
    const contextMsg: ServerMessage = {
      type: "CONTEXT_SNAPSHOT",
      seq: 1,
      context_id: "ctx_report",
      data: { report: "Q3" },
    };
    const tokenMsg: ServerMessage = {
      type: "TOKEN",
      seq: 2,
      text: "Hello",
      stream_id: "s_001",
    };
    const toolMsg: ServerMessage = {
      type: "TOOL_CALL",
      seq: 3,
      call_id: "tc_001",
      tool_name: "lookup",
      args: { key: "value" },
      stream_id: "s_001",
    };

    // Arrive out of order: tool, context, token
    expect(buffer.insert(toolMsg)).toHaveLength(0);
    const r1 = buffer.insert(contextMsg);
    expect(r1).toHaveLength(1);
    expect(r1[0].type).toBe("CONTEXT_SNAPSHOT");

    const r2 = buffer.insert(tokenMsg);
    expect(r2).toHaveLength(2);
    expect(r2[0].type).toBe("TOKEN");
    expect(r2[1].type).toBe("TOOL_CALL");
  });

  // ── Reset ────────────────────────────────────────────────

  test("reset clears all state for a new conversation turn", () => {
    buffer.insert(token(1));
    buffer.insert(token(2));
    buffer.insert(token(5)); // buffered

    expect(buffer.getLastProcessedSeq()).toBe(2);
    expect(buffer.bufferedCount).toBe(1);

    buffer.reset();

    expect(buffer.getLastProcessedSeq()).toBe(0);
    expect(buffer.bufferedCount).toBe(0);
    expect(buffer.nextExpectedSeq).toBe(1);

    // After reset, seq=1 works again (server resets its counter too)
    const ready = buffer.insert(token(1));
    expect(ready).toHaveLength(1);
    expect(ready[0].seq).toBe(1);
  });

  // ── getLastProcessedSeq precision ────────────────────────

  test("getLastProcessedSeq does NOT count buffered (unprocessed) messages", () => {
    buffer.insert(token(1));
    buffer.insert(token(3)); // buffered, NOT processed
    buffer.insert(token(5)); // buffered, NOT processed

    // Only seq=1 has been processed. 3 and 5 are waiting.
    expect(buffer.getLastProcessedSeq()).toBe(1);
  });
});
