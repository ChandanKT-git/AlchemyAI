// ─────────────────────────────────────────────────────────────
// Reorder Buffer — Sequence-based message ordering + deduplication
//
// WHY THIS EXISTS:
// In chaos mode, the server delivers messages out of order and
// may send duplicates. Without this buffer, tokens arrive as
// seq=5, seq=3, seq=4, seq=3 and the chat renders garbled text.
//
// HOW IT WORKS:
// Think of TCP's receive window:
// 1. Track `nextExpected` (starts at 1)
// 2. When a message arrives:
//    - If seq < nextExpected → duplicate, skip
//    - If seq === nextExpected → process it, then drain any
//      buffered messages that form a contiguous sequence
//    - If seq > nextExpected → buffer it, wait for the gap to fill
//
// IMPORTANT DETAIL:
// The server resets seq to 0 on each new USER_MESSAGE. So the
// client must call reset() before sending a new message.
// ─────────────────────────────────────────────────────────────

import type { ServerMessage } from "./types";

export class ReorderBuffer {
  /** The next seq we expect to process. Starts at 1. */
  private nextExpected: number = 1;

  /**
   * Set of all seq numbers we've already processed.
   * Used for deduplication — if a seq is in this set, we skip it.
   */
  private processed: Set<number> = new Set();

  /**
   * Buffer for messages that arrived ahead of their turn.
   * Key: seq number, Value: the message.
   * Example: if nextExpected=3 and seq=5 arrives, we store {5: msg}.
   */
  private buffer: Map<number, ServerMessage> = new Map();

  /**
   * Insert a message into the buffer. Returns an array of messages
   * that are ready to be processed, in correct seq order.
   *
   * Returns empty array if:
   * - The message is a duplicate (already processed)
   * - The message is ahead of nextExpected (buffered, waiting for gap fill)
   *
   * Returns one or more messages if:
   * - The message fills the next expected slot AND there are
   *   contiguous buffered messages following it
   *
   * @example
   *   // In-order delivery:
   *   buffer.insert(seq=1) → [msg1]
   *   buffer.insert(seq=2) → [msg2]
   *
   *   // Out-of-order delivery:
   *   buffer.insert(seq=3) → []        // buffered, waiting for 1
   *   buffer.insert(seq=1) → [msg1]    // 1 drains, but 2 is missing
   *   buffer.insert(seq=2) → [msg2, msg3]  // 2 drains, then 3 drains
   *
   *   // Duplicate:
   *   buffer.insert(seq=1) → [msg1]    // first time: processed
   *   buffer.insert(seq=1) → []        // second time: skip
   */
  insert(msg: ServerMessage): ServerMessage[] {
    const seq = msg.seq;

    // ── Duplicate check ──────────────────────────────────
    if (this.processed.has(seq)) {
      return [];
    }

    // ── Future message (gap exists) ──────────────────────
    if (seq > this.nextExpected) {
      // Don't overwrite if somehow we get the same future seq twice
      // (the processed check above handles already-processed ones,
      //  but this handles buffered-but-not-yet-processed dupes)
      if (!this.buffer.has(seq)) {
        this.buffer.set(seq, msg);
      }
      return [];
    }

    // ── Stale message (seq < nextExpected) ────────────────
    // This means we somehow skipped it or it's a very old duplicate
    // that wasn't in our processed set (e.g., after a reset).
    if (seq < this.nextExpected) {
      return [];
    }

    // ── Expected message (seq === nextExpected) ──────────
    // Process this message and drain any contiguous buffered messages
    const ready: ServerMessage[] = [];

    // Process the current message
    ready.push(msg);
    this.processed.add(seq);
    this.nextExpected = seq + 1;

    // Drain contiguous buffered messages
    while (this.buffer.has(this.nextExpected)) {
      const buffered = this.buffer.get(this.nextExpected)!;
      this.buffer.delete(this.nextExpected);
      ready.push(buffered);
      this.processed.add(this.nextExpected);
      this.nextExpected++;
    }

    return ready;
  }

  /**
   * Returns the highest seq that has been fully processed.
   * This is the value sent in RESUME { last_seq }.
   *
   * Returns 0 if nothing has been processed yet.
   *
   * CRITICAL: This returns nextExpected - 1, which is the last
   * seq that was actually consumed. NOT the highest seq we've
   * seen (which could be a buffered future message).
   */
  getLastProcessedSeq(): number {
    return this.nextExpected - 1;
  }

  /**
   * Reset the buffer for a new conversation turn.
   * Called before sending a new USER_MESSAGE, because the server
   * resets its seq counter to 0 on each new turn.
   */
  reset(): void {
    this.nextExpected = 1;
    this.processed.clear();
    this.buffer.clear();
  }

  /** Number of messages currently buffered (waiting for gap fill). */
  get bufferedCount(): number {
    return this.buffer.size;
  }

  /** The next seq number we're waiting for. */
  get nextExpectedSeq(): number {
    return this.nextExpected;
  }
}
