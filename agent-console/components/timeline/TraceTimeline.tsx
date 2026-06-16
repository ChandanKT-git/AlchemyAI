"use client";

// ─────────────────────────────────────────────────────────────
// TraceTimeline — Scrollable event log with grouping + filtering
//
// This is the left panel of the 3-panel layout. It shows every
// event the reducer processed, with:
//
// 1. TOKEN GROUPING — consecutive tokens collapse into
//    "Streamed N tokens (X.Xs)" — expandable to show full text
//
// 2. FILTERING — checkboxes to show/hide event types +
//    text search on summary content
//
// 3. BIDIRECTIONAL LINKING —
//    • Click a timeline row → onSelectEntry fires → parent
//      can scroll/highlight the corresponding chat element
//    • Parent can set selectedSeq to highlight a timeline row
//      (e.g. when clicking a ToolCard in the chat)
//
// PERFORMANCE:
// We useMemo the grouped + filtered items so we don't re-group
// on every render. The grouping function is O(n) — one pass
// through the entries array.
// ─────────────────────────────────────────────────────────────

import { useMemo, useRef, useEffect } from "react";
import type { TimelineEntry } from "@/lib/agent/types";
import { groupTimelineEntries, type GroupedItem } from "@/lib/timeline/grouping";
import TimelineRow from "./TimelineRow";
import TimelineFilter, {
  createDefaultFilter,
  type FilterState,
} from "./TimelineFilter";
import styles from "./TraceTimeline.module.css";

interface TraceTimelineProps {
  entries: TimelineEntry[];
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
  onSelectEntry?: (entry: TimelineEntry) => void;
  selectedSeq?: number | null;
}

export { createDefaultFilter };
export type { FilterState };

export default function TraceTimeline({
  entries,
  filter,
  onFilterChange,
  onSelectEntry,
  selectedSeq,
}: TraceTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Count events by type (for filter badges) ──────
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) {
      c[e.type] = (c[e.type] ?? 0) + 1;
    }
    return c;
  }, [entries]);

  // ── Filter entries ────────────────────────────────
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      // Type filter
      if (!filter.enabledTypes.has(e.type as never)) return false;
      // Text search
      if (filter.searchText) {
        const q = filter.searchText.toLowerCase();
        return (
          e.summary.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [entries, filter]);

  // ── Group consecutive tokens ──────────────────────
  const grouped: GroupedItem[] = useMemo(
    () => groupTimelineEntries(filtered),
    [filtered]
  );

  // ── Auto-scroll to bottom when new entries arrive ─
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [grouped.length]);

  return (
    <div className={styles.container}>
      {/* Filter bar */}
      <TimelineFilter
        filter={filter}
        onChange={onFilterChange}
        counts={counts}
      />

      {/* Event list */}
      <div className={styles.list} ref={scrollRef}>
        {grouped.length === 0 ? (
          <p className={styles.empty}>
            {entries.length === 0
              ? "Events will appear here during streaming"
              : "No events match the current filter"}
          </p>
        ) : (
          grouped.map((item, i) => (
            <TimelineRow
              key={
                item.kind === "token_group"
                  ? `group-${item.startSeq}`
                  : `single-${item.entry.seq}`
              }
              item={item}
              onSelect={onSelectEntry}
              selectedSeq={selectedSeq}
            />
          ))
        )}
      </div>

      {/* Footer stats */}
      <div className={styles.footer}>
        {entries.length} events
        {filtered.length !== entries.length && ` (${filtered.length} shown)`}
      </div>
    </div>
  );
}
