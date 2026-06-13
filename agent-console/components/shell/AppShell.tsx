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
 * Why "use client"?
 * - Panel visibility is interactive state (toggle buttons)
 * - Child components will use hooks for WebSocket, state, etc.
 * - Server components can't hold useState
 */

import { useState } from "react";
import styles from "./AppShell.module.css";

export default function AppShell() {
  const [showTimeline, setShowTimeline] = useState(true);
  const [showContext, setShowContext] = useState(true);

  return (
    <div className={styles.shell}>
      {/* ── Top bar ─────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Agent Console</h1>
          <span className={styles.statusDot} title="Disconnected" />
          <span className={styles.statusText}>Disconnected</span>
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
              <p className={styles.placeholder}>Events will appear here during streaming</p>
            </div>
          </aside>
        )}

        {/* Chat (center) */}
        <section className={styles.chat}>
          <div className={styles.panelBody}>
            <p className={styles.placeholder}>Send a message to start</p>
          </div>
          <div className={styles.inputArea}>
            <input
              type="text"
              className={styles.input}
              placeholder='Try "hello" or "summarize the report"...'
              disabled
            />
          </div>
        </section>

        {/* Context Inspector (right) */}
        {showContext && (
          <aside className={styles.context}>
            <div className={styles.panelHeader}>Context Inspector</div>
            <div className={styles.panelBody}>
              <p className={styles.placeholder}>Context snapshots will appear here</p>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}
