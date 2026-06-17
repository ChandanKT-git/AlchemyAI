# Engineering Decisions

Six non-obvious design choices made during implementation, with reasoning.

---

## 1. Sequence Ordering — ReorderBuffer with Set + Map

**Problem:** In chaos mode the server delivers messages out of order and sends duplicates. A naïve approach would be to collect all messages and sort them before rendering, but that requires waiting for the full stream to finish — defeating the point of real-time streaming.

**Decision:** A streaming reorder buffer modelled on TCP's receive window.

```
nextExpected = 1
processed    = Set<number>   ← dedup: already-committed seqs
buffer       = Map<seq, msg> ← holding area for future seqs
```

On each incoming message:

1. `seq ∈ processed` → duplicate, drop immediately (O(1) lookup).
2. `seq > nextExpected` → gap exists, store in `buffer` and wait.
3. `seq === nextExpected` → commit this message, then drain any contiguous chain from `buffer` in one pass.

**Why not a sorted array?** Insertion into a sorted array is O(n). The Map gives O(1) lookup for drain checks, and the Set gives O(1) dedup. Both operations happen on every message at 30+ msg/sec in chaos mode.

**Why not just keep a `maxSeq` and check `seq <= maxSeq`?** A corrupted or replayed message with a high seq number would permanently block the buffer. The `processed` Set remembers the exact seqs we committed, so a replay of seq=5 after we've processed seq=8 is still correctly identified as a duplicate.

**Key invariant:** `getLastProcessedSeq()` returns `nextExpected - 1` — the highest seq that has been *consecutively* committed. It deliberately does NOT return the highest seq *seen*, because a buffered-but-unprocessed seq=20 should not be reported as "processed" when we're still waiting for seq=7.

---

## 2. Layout Shift Prevention — Structural Blocks, Not String Mutation

**Problem:** A streaming response interleaved with tool calls looks like:

```
"Here is the analysis..." [TOOL_CALL: lookup_metric] "...the result shows..."
```

A string-based approach would require splitting and re-splitting the text on every TOOL_CALL. When the tool result arrives, inserting it at the right position inside a string means touching every downstream render.

**Decision:** The reducer builds an ordered array of typed *blocks*:

```typescript
type Block = TextBlock | ToolCallBlock

// Stream state at any point:
blocks = [TextBlock("Here is the analysis..."), ToolCallBlock(pending), TextBlock("")]
```

On TOOL_CALL:
- The current TextBlock is frozen (no more appends).
- A new ToolCallBlock is pushed.
- An empty TextBlock is pushed for post-tool tokens.

On TOKEN: append to the last TextBlock only — never touch earlier blocks.  
On TOOL_RESULT: update exactly the matching ToolCallBlock by `call_id`.

**Why this eliminates layout shift:** React re-renders only the block that actually changed. A new TOKEN updates only the last `TextBlock` component (memoized via `React.memo`). A TOOL_RESULT update re-renders only one `ToolCard`. No other DOM nodes are touched.

**Why the reducer, not `useState`?** A TOOL_CALL requires three simultaneous state changes: freeze current text, push tool card, push new empty text. With scattered `useState` calls, React would render an intermediate inconsistent state between each `set*` call. The reducer does all three atomically — React sees one state transition.

---

## 3. Reconnection State Recovery — `getLastProcessedSeq()`

**Problem:** On reconnect, the server needs to know where to resume. Two candidate values:
- **Highest seq seen** — includes messages buffered but not yet processed (gap not filled).
- **Highest seq consecutively processed** — only includes messages that have been committed to UI state.

**Decision:** Use `getLastProcessedSeq()` = `nextExpected - 1`, which is the highest *consecutive* seq. This is sent in `RESUME { last_seq }`.

**Why not highest seen?** If we received seq 1–5 and seq 8–10 (gap at 6–7), the highest *seen* is 10. If we send `RESUME { last_seq: 10 }`, the server won't replay 6–7. Our gap never fills. The buffer stays broken forever.

With `last_seq: 5`, the server replays 6, 7, 8, 9, 10. The reorder buffer receives them, fills the gap at 6, then drains 7–10 from its in-memory buffer. The gap resolves correctly.

**Three-layer defense against duplicate rendering on replay:**
1. ReorderBuffer `processed` Set skips any seq we already committed.
2. Reducer `handleToolCall` dedup check skips already-existing ToolCallBlocks.
3. On reconnect, `requeuePendingAcks()` re-sends TOOL_ACK for any tool calls whose ACK may have been lost in transit — preventing a server stall if the connection dropped between the client sending the ACK and the server receiving it.

**Connection state vs stream state are separate by design.** A connection drop does NOT reset the reducer state. Tool cards remain visible. The accumulated text stays. Only the reorder buffer retains its gap state across the reconnect, which is what enables correct RESUME.

---

## 4. Scaling to 50 Concurrent Streams

The current architecture handles one active stream at a time. Here is what would change to support 50:

**What stays the same:**
- The `ReorderBuffer` and `WSClient` are already per-connection, not global.
- The `agentReducer` is a pure function — it can be called with any stream's state.
- The `parseRawMessage` boundary validator is stateless.

**What would change:**

| Current | At 50 streams |
|---|---|
| `AgentState.stream: StreamState` (single) | `AgentState.streams: Map<stream_id, StreamState>` |
| One `AgentProvider` with one WSClient | One `AgentProvider`, but dispatch routed by `stream_id` |
| `ChatPanel` reads `state.stream` | `ChatPanel` reads `state.streams.get(activeStreamId)` |
| Timeline is flat | Timeline grouped by `stream_id` with collapsible sections |

The `TOKEN`, `TOOL_CALL`, `TOOL_RESULT`, and `STREAM_END` messages all carry `stream_id`. The reducer switch on `stream_id` to find the right `StreamState` to update. React's `useMemo` on the active stream prevents re-rendering inactive panels.

**Performance:** 50 streams × 30 tokens/sec = 1500 reducer calls/sec. Each reducer call is O(1) Map lookup + O(k) block array update where k is the number of blocks in that stream. This is well within React 18's concurrent mode throughput.

---

## 5. Handling 100× Longer Responses

A response 100× longer than the current demo scripts would mean:
- ~1400 token blocks (14 tokens × 100) in a single `TextBlock`.
- 5000+ timeline entries.
- Multiple large `CONTEXT_SNAPSHOT` payloads.

**Current bottlenecks and fixes:**

**Chat panel — text rendering:** A single `TextBlock` containing 1400 tokens renders as one `<div>`. This is already fast. The real issue would be if a response produced 1400 *separate* text blocks — but the reducer's design ensures all tokens go into one block. No issue here.

**Timeline — 5000+ entries:** Already handled via `useMemo` + token grouping. Consecutive TOKEN entries collapse into a single "Streamed N tokens" row. In practice 1400 tokens → 1 group row. If the timeline still grows too large (many tool calls, snapshots), the fix is **virtual scrolling** — only render the rows in the visible viewport. Libraries like `react-virtual` drop this from O(n) DOM nodes to O(viewport/rowHeight).

**Context inspector — 500 KB+ payloads:** Already handled via lazy tree expansion. Nodes are not rendered until the user clicks to expand. For even larger payloads (5 MB+), the diff algorithm would need to be moved to a Web Worker to avoid blocking the main thread.

**Message input blocking:** The `isStreaming` guard already prevents sending a new message until `STREAM_END` arrives. For very long streams this could be frustrating. The fix is a "Stop" button that sends a `CANCEL` message and transitions stream state to `complete` optimistically.

---

## 6. The TOOL_ACK Race Condition

**What the protocol requires:** When the client renders a TOOL_CALL card, it must send `TOOL_ACK { call_id }` to unblock the server. The server waits for ACK before executing the tool and sending TOOL_RESULT.

**The race condition:** The reducer is a pure function — it cannot call `ws.send()`. If we sent TOOL_ACK inside the reducer, the reducer would have a side effect, making it impure and untestable.

**Naive fix (wrong):** Send TOOL_ACK inside the `onMessage` handler in `WSClient`, before the message reaches the reducer. This sends ACK before the card is rendered — a protocol violation. "ACK" means "I have rendered this card", not "I have received this message".

**Our fix — the command pattern:**

```
reducer processes TOOL_CALL
  → returns newState with pendingAcks: ["call_id"]

AgentProvider useEffect watches pendingAcks
  → when non-empty, sends TOOL_ACK via WSClient
  → then calls clearPendingAcks(state)
```

`useEffect` runs *after* React commits the state to the DOM. This means the ToolCard is already visible in the browser when TOOL_ACK is sent — exactly what the protocol requires.

**The second race condition — connection drop between TOOL_CALL and ACK:**

If the connection drops after the reducer processes TOOL_CALL but before ACK reaches the server:
1. We reconnect and send `RESUME { last_seq: N }` where N ≥ TOOL_CALL's seq.
2. The server does NOT replay TOOL_CALL (it was before last_seq).
3. The client has no pending TOOL_CALL to re-ACK — `pendingAcks` was cleared.
4. The server stalls waiting for an ACK that will never come.

**Fix:** The `onReconnected` callback in `WSClient` fires after RESUME is sent. `AgentProvider` responds by calling `requeuePendingAcks(state)` — scanning all blocks for `status === "pending"` ToolCallBlocks and re-adding them to `pendingAcks`. The existing `useEffect` then re-sends the ACKs. This is safe to repeat because the server deduplicates ACKs by `call_id`.
