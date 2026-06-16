"use client";

// ─────────────────────────────────────────────────────────────
// TimelineRow — Renders one row in the trace timeline
//
// Two variants:
// 1. SingleEntry — one event (TOOL_CALL, CONTEXT_SNAPSHOT, etc.)
// 2. TokenGroup  — collapsed batch of consecutive TOKENs
//    "Streamed 47 tokens (1.2s)" — expandable to show full text
//
// Each row type has a distinct color/icon matching the plan:
//   TOKEN (grouped) → Blue
//   TOOL_CALL       → Orange
//   TOOL_RESULT     → Green (indented, linked to TOOL_CALL)
//   CONTEXT_SNAPSHOT→ Purple
//   PING            → Gray
//   STREAM_END      → Gray
//   ERROR           → Red
//
// BIDIRECTIONAL LINKING:
// Each row has data-seq and optional data-call-id attributes.
// Clicking a row fires onSelect(entry) which the parent uses
// to scroll/highlight the corresponding chat element.
// ─────────────────────────────────────────────────────────────

import React, { useState } from "react";
import type { TimelineEntry } from "@/lib/agent/types";
import type { GroupedItem } from "@/lib/timeline/grouping";
import styles from "./TimelineRow.module.css";

interface TimelineRowProps {
  item: GroupedItem;
  onSelect?: (entry: TimelineEntry) => void;
  selectedSeq?: number | null;
}

// ── Color and icon mapping ───────────────────────────────────

const EVENT_STYLES: Record<string, { color: string; icon: string; label: string }> = {
  TOKEN:            { color: "blue",   icon: "◆", label: "TOKEN" },
  TOOL_CALL:        { color: "orange", icon: "⚡", label: "TOOL_CALL" },
  TOOL_RESULT:      { color: "green",  icon: "✓", label: "TOOL_RESULT" },
  CONTEXT_SNAPSHOT: { color: "purple", icon: "◎", label: "CONTEXT" },
  PING:             { color: "gray",   icon: "↔", label: "PING" },
  STREAM_END:       { color: "gray",   icon: "■", label: "STREAM_END" },
  ERROR:            { color: "red",    icon: "✕", label: "ERROR" },
};

function getEventStyle(type: string) {
  return EVENT_STYLES[type] ?? { color: "gray", icon: "?", label: type };
}

// ── Main Component ───────────────────────────────────────────

function TimelineRowInner({ item, onSelect, selectedSeq }: TimelineRowProps) {
  if (item.kind === "token_group") {
    return (
      <TokenGroupRow
        item={item}
        onSelect={onSelect}
        selectedSeq={selectedSeq}
      />
    );
  }

  return (
    <SingleRow
      entry={item.entry}
      onSelect={onSelect}
      selectedSeq={selectedSeq}
    />
  );
}

// ── Single Event Row ─────────────────────────────────────────

function SingleRow({
  entry,
  onSelect,
  selectedSeq,
}: {
  entry: TimelineEntry;
  onSelect?: (entry: TimelineEntry) => void;
  selectedSeq?: number | null;
}) {
  const style = getEventStyle(entry.type);
  const isSelected = selectedSeq === entry.seq;
  const isToolResult = entry.type === "TOOL_RESULT";

  return (
    <div
      className={`${styles.row} ${styles[style.color]} ${isSelected ? styles.selected : ""} ${isToolResult ? styles.indented : ""}`}
      data-seq={entry.seq}
      data-call-id={entry.callId ?? undefined}
      onClick={() => onSelect?.(entry)}
      role="button"
      tabIndex={0}
    >
      <span className={styles.seq}>#{entry.seq}</span>
      <span className={styles.icon}>{style.icon}</span>
      <span className={styles.label}>{style.label}</span>
      <span className={styles.summary} title={entry.summary}>
        {entry.summary}
      </span>
    </div>
  );
}

// ── Token Group Row (expandable) ─────────────────────────────

function TokenGroupRow({
  item,
  onSelect,
  selectedSeq,
}: {
  item: Extract<GroupedItem, { kind: "token_group" }>;
  onSelect?: (entry: TimelineEntry) => void;
  selectedSeq?: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const style = getEventStyle("TOKEN");
  const duration = (item.durationMs / 1000).toFixed(1);
  const isSelected =
    selectedSeq != null &&
    selectedSeq >= item.startSeq &&
    selectedSeq <= item.endSeq;

  return (
    <div className={styles.group}>
      {/* Collapsed header */}
      <div
        className={`${styles.row} ${styles.groupHeader} ${styles[style.color]} ${isSelected ? styles.selected : ""}`}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
      >
        <span className={styles.seq}>
          #{item.startSeq}–{item.endSeq}
        </span>
        <span className={styles.icon}>{style.icon}</span>
        <span className={styles.label}>TOKENS</span>
        <span className={styles.summary}>
          Streamed {item.entries.length} tokens ({duration}s)
        </span>
        <span className={styles.expandIcon}>
          {expanded ? "▾" : "▸"}
        </span>
      </div>

      {/* Expanded: show full text */}
      {expanded && (
        <div className={styles.groupBody}>
          <pre className={styles.groupText}>{item.fullText}</pre>
        </div>
      )}
    </div>
  );
}

const TimelineRow = React.memo(TimelineRowInner);
export default TimelineRow;
