"use client";

/**
 * AppShell — The 3-panel layout for the Agent Console.
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ Connection Status Bar                                │
 * ├──────────┬──────────────────────┬────────────────────┤
 * │ Timeline │   Chat Panel         │ Context Inspector  │
 * │ (left)   │   (center)           │ (right)            │
 * │          │                      │                    │
 * └──────────┴──────────────────────┴────────────────────┘
 *
 * Architecture:
 * - AppShell wraps everything in <AgentProvider>
 * - <AppShellInner> uses useAgent() to access connection state
 * - <ChatPanel> uses useAgent() for stream state + actions
 * - <TraceTimeline> gets entries from state + filter from local state
 *
 * BIDIRECTIONAL LINKING:
 * - Click a timeline row → scrolls chat to that tool card (by call_id)
 * - Click a tool card in chat → could highlight timeline row (future)
 * - Both use data-call-id attributes on DOM elements
 */

import { useState, useCallback } from "react";
import { AgentProvider, useAgent } from "@/lib/agent/context";
import ConnectionStatus from "./ConnectionStatus";
import ChatPanel from "../chat/ChatPanel";
import TraceTimeline, {
  createDefaultFilter,
  type FilterState,
} from "../timeline/TraceTimeline";
import ContextPanel from "../context/ContextPanel";
import type { TimelineEntry } from "@/lib/agent/types";
import styles from "./AppShell.module.css";

/** The agent server WebSocket URL */
const WS_URL = "ws://localhost:4747/ws";

export default function AppShell() {
  return (
    <AgentProvider url={WS_URL}>
      <AppShellInner />
    </AgentProvider>
  );
}

/**
 * Inner shell — lives inside AgentProvider so it can use useAgent().
 * Owns panel visibility toggles, timeline filter, and layout structure.
 */
function AppShellInner() {
  const { state, connectionState, reconnectInfo } = useAgent();
  const [showTimeline, setShowTimeline] = useState(true);
  const [showContext, setShowContext] = useState(true);
  const [timelineFilter, setTimelineFilter] =
    useState<FilterState>(createDefaultFilter);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

  // ── Bidirectional linking: timeline → chat ──────────
  const handleTimelineSelect = useCallback((entry: TimelineEntry) => {
    setSelectedSeq(entry.seq);

    // If this entry has a callId, try to scroll the chat panel
    // to the matching ToolCard (which has data-call-id attribute)
    if (entry.callId) {
      const el = document.querySelector(`[data-call-id="${entry.callId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Flash highlight
        el.classList.add("timeline-highlight");
        setTimeout(() => el.classList.remove("timeline-highlight"), 1500);
      }
    }
  }, []);

  return (
    <div className={styles.shell}>
      {/* ── Top bar ─────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Agent Console</h1>
          <ConnectionStatus
            state={connectionState}
            reconnectInfo={reconnectInfo}
          />
        </div>
        <div className={styles.headerRight}>
          <button
            className={`${styles.toggleBtn} ${showTimeline ? styles.active : ""}`}
            onClick={() => setShowTimeline((v) => !v)}
            title="Toggle Timeline"
          >
            Timeline
          </button>
          <button
            className={`${styles.toggleBtn} ${showContext ? styles.active : ""}`}
            onClick={() => setShowContext((v) => !v)}
            title="Toggle Context Inspector"
          >
            Context
          </button>
        </div>
      </header>

      {/* ── Main panels ────────────────────────────── */}
      <main className={styles.main}>
        {/* Timeline (left) — now the real TraceTimeline */}
        {showTimeline && (
          <aside className={styles.timeline}>
            <TraceTimeline
              entries={state.timeline}
              filter={timelineFilter}
              onFilterChange={setTimelineFilter}
              onSelectEntry={handleTimelineSelect}
              selectedSeq={selectedSeq}
            />
          </aside>
        )}

        {/* Chat (center) — uses useAgent internally */}
        <ChatPanel />

        {/* Context Inspector (right) — full Milestone 9 panel */}
        {showContext && (
          <aside className={styles.context}>
            <ContextPanel context={state.context} />
          </aside>
        )}
      </main>
    </div>
  );
}
