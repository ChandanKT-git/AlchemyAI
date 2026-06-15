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
 *
 * This split is needed because useAgent() can only be called
 * INSIDE the AgentProvider, not in the component that renders it.
 */

import { useState } from "react";
import { AgentProvider, useAgent } from "@/lib/agent/context";
import ConnectionStatus from "./ConnectionStatus";
import ChatPanel from "../chat/ChatPanel";
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
 * Owns panel visibility toggles and layout structure.
 */
function AppShellInner() {
  const { state, connectionState } = useAgent();
  const [showTimeline, setShowTimeline] = useState(true);
  const [showContext, setShowContext] = useState(true);

  return (
    <div className={styles.shell}>
      {/* ── Top bar ─────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Agent Console</h1>
          <ConnectionStatus state={connectionState} />
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
        {/* Timeline (left) */}
        {showTimeline && (
          <aside className={styles.timeline}>
            <div className={styles.panelHeader}>Trace Timeline</div>
            <div className={styles.panelBody}>
              {state.timeline.length === 0 ? (
                <p className={styles.placeholder}>
                  Events will appear here during streaming
                </p>
              ) : (
                <div className={styles.debugLog}>
                  {state.timeline.map((entry, i) => (
                    <div key={i} className={styles.debugEntry}>
                      <span className={styles.debugSeq}>#{entry.seq}</span>
                      <span className={styles.debugType}>{entry.type}</span>
                      <span className={styles.debugText}>{entry.summary}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Chat (center) — uses useAgent internally */}
        <ChatPanel />

        {/* Context Inspector (right) */}
        {showContext && (
          <aside className={styles.context}>
            <div className={styles.panelHeader}>Context Inspector</div>
            <div className={styles.panelBody}>
              {Object.keys(state.context.contexts).length === 0 ? (
                <p className={styles.placeholder}>
                  Context snapshots will appear here
                </p>
              ) : (
                <div className={styles.debugLog}>
                  {Object.entries(state.context.contexts).map(
                    ([id, snapshots]) => (
                      <div key={id} className={styles.contextEntry}>
                        <div className={styles.contextId}>{id}</div>
                        <pre className={styles.contextData}>
                          {JSON.stringify(
                            snapshots[snapshots.length - 1].data,
                            null,
                            2
                          )}
                        </pre>
                        {snapshots.length > 1 && (
                          <span className={styles.contextHistory}>
                            {snapshots.length} snapshots
                          </span>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}
