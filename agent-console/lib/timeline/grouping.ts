// ─────────────────────────────────────────────────────────────
// Token Grouping — Batch consecutive TOKEN timeline entries
//
// WHY GROUPING?
// Tokens arrive every 30–80ms, creating 15–33 timeline entries
// per second. Rendering each one individually:
//   #1 TOKEN "Hello "
//   #2 TOKEN "World"
//   #3 TOKEN "!"
//
// is noisy and causes jank. Instead, we group consecutive tokens
// into a single expandable row:
//   #1–3 Streamed 3 tokens (0.2s)
//
// Non-token events (TOOL_CALL, CONTEXT_SNAPSHOT, etc.) break
// the group. So the output alternates between token groups
// and individual events.
// ─────────────────────────────────────────────────────────────

import type { TimelineEntry } from "@/lib/agent/types";

// ── Grouped Entry Types ──────────────────────────────────────

export interface TokenGroup {
  kind: "token_group";
  /** The entries in this group (for expanding) */
  entries: TimelineEntry[];
  /** First seq in the group */
  startSeq: number;
  /** Last seq in the group */
  endSeq: number;
  /** Time span in ms */
  durationMs: number;
  /** Concatenated text of all tokens */
  fullText: string;
}

export interface SingleEntry {
  kind: "single";
  entry: TimelineEntry;
}

export type GroupedItem = TokenGroup | SingleEntry;

// ── Grouping Function ────────────────────────────────────────

/**
 * Groups consecutive TOKEN entries into batches.
 * All other event types become individual items.
 *
 * @param entries - Raw timeline entries from the reducer
 * @returns Grouped items for rendering
 */
export function groupTimelineEntries(entries: TimelineEntry[]): GroupedItem[] {
  if (entries.length === 0) return [];

  const result: GroupedItem[] = [];
  let currentTokenGroup: TimelineEntry[] = [];

  const flushTokenGroup = () => {
    if (currentTokenGroup.length === 0) return;

    if (currentTokenGroup.length === 1) {
      // Single token — don't group it, show as individual
      result.push({ kind: "single", entry: currentTokenGroup[0] });
    } else {
      // Multiple consecutive tokens — group them
      const first = currentTokenGroup[0];
      const last = currentTokenGroup[currentTokenGroup.length - 1];
      const fullText = currentTokenGroup
        .map((e) => {
          // Extract the quoted text from the summary: "Hello " → Hello 
          const match = e.summary.match(/^"(.*)"$/);
          return match ? match[1] : e.summary;
        })
        .join("");

      result.push({
        kind: "token_group",
        entries: [...currentTokenGroup],
        startSeq: first.seq,
        endSeq: last.seq,
        durationMs: last.timestamp - first.timestamp,
        fullText,
      });
    }

    currentTokenGroup = [];
  };

  for (const entry of entries) {
    if (entry.type === "TOKEN") {
      currentTokenGroup.push(entry);
    } else {
      // Non-token event breaks the group
      flushTokenGroup();
      result.push({ kind: "single", entry });
    }
  }

  // Flush any trailing tokens
  flushTokenGroup();

  return result;
}
