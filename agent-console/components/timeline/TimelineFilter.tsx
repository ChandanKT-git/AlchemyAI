"use client";

// ─────────────────────────────────────────────────────────────
// TimelineFilter — Event type filter checkboxes + search
//
// Allows the user to show/hide specific event types in the
// timeline. Each checkbox corresponds to a ServerMessage type.
// Also includes a text search that filters by summary content.
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import styles from "./TimelineFilter.module.css";

/** All filterable event types */
export const EVENT_TYPES = [
  "TOKEN",
  "TOOL_CALL",
  "TOOL_RESULT",
  "CONTEXT_SNAPSHOT",
  "PING",
  "STREAM_END",
  "ERROR",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const EVENT_COLORS: Record<EventType, string> = {
  TOKEN: "var(--color-accent-blue)",
  TOOL_CALL: "var(--color-accent-orange)",
  TOOL_RESULT: "var(--color-accent-green)",
  CONTEXT_SNAPSHOT: "var(--color-accent-purple)",
  PING: "var(--color-accent-gray)",
  STREAM_END: "var(--color-accent-gray)",
  ERROR: "var(--color-accent-red)",
};

const EVENT_LABELS: Record<EventType, string> = {
  TOKEN: "Tokens",
  TOOL_CALL: "Tool Calls",
  TOOL_RESULT: "Results",
  CONTEXT_SNAPSHOT: "Context",
  PING: "Ping",
  STREAM_END: "End",
  ERROR: "Errors",
};

export interface FilterState {
  /** Which event types are visible */
  enabledTypes: Set<EventType>;
  /** Text search (filters by summary) */
  searchText: string;
}

interface TimelineFilterProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
  /** Total count per event type (for badge display) */
  counts: Record<string, number>;
}

export function createDefaultFilter(): FilterState {
  return {
    enabledTypes: new Set(EVENT_TYPES),
    searchText: "",
  };
}

export default function TimelineFilter({
  filter,
  onChange,
  counts,
}: TimelineFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleType = (type: EventType) => {
    const next = new Set(filter.enabledTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    onChange({ ...filter, enabledTypes: next });
  };

  const toggleAll = () => {
    if (filter.enabledTypes.size === EVENT_TYPES.length) {
      // Deselect all
      onChange({ ...filter, enabledTypes: new Set() });
    } else {
      // Select all
      onChange({ ...filter, enabledTypes: new Set(EVENT_TYPES) });
    }
  };

  return (
    <div className={styles.filterBar}>
      <div className={styles.filterTop}>
        {/* Search input */}
        <input
          className={styles.search}
          type="text"
          placeholder="Search events..."
          value={filter.searchText}
          onChange={(e) =>
            onChange({ ...filter, searchText: e.target.value })
          }
        />
        <button
          className={styles.filterToggle}
          onClick={() => setIsExpanded((v) => !v)}
          title="Filter by event type"
        >
          ⚡ {isExpanded ? "▾" : "▸"}
        </button>
      </div>

      {/* Expandable filter chips */}
      {isExpanded && (
        <div className={styles.chips}>
          <button
            className={`${styles.chip} ${styles.allChip}`}
            onClick={toggleAll}
          >
            {filter.enabledTypes.size === EVENT_TYPES.length ? "None" : "All"}
          </button>
          {EVENT_TYPES.map((type) => {
            const enabled = filter.enabledTypes.has(type);
            const count = counts[type] ?? 0;
            return (
              <button
                key={type}
                className={`${styles.chip} ${enabled ? styles.chipActive : ""}`}
                style={
                  enabled
                    ? { borderColor: EVENT_COLORS[type], color: EVENT_COLORS[type] }
                    : undefined
                }
                onClick={() => toggleType(type)}
              >
                {EVENT_LABELS[type]}
                {count > 0 && (
                  <span className={styles.chipCount}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
