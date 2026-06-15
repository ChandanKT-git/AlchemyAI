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
 * - Manages WebSocket connection (browser API)
 * - Holds interactive state (panel toggles, connection status)
 * - Server components can't use hooks
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { WSClient, type ConnectionState } from "@/lib/protocol/ws-client";
import type { ServerMessage } from "@/lib/protocol/types";
import ConnectionStatus from "./ConnectionStatus";
import styles from "./AppShell.module.css";

/** The agent server WebSocket URL */
const WS_URL = "ws://localhost:4747/ws";

export default function AppShell() {
  const [showTimeline, setShowTimeline] = useState(true);
  const [showContext, setShowContext] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>("IDLE");
  const [messages, setMessages] = useState<ServerMessage[]>([]);

  // useRef to hold the WSClient instance across renders.
  // We don't want React to recreate it on every render.
  const clientRef = useRef<WSClient | null>(null);

  // ── Message handler (useCallback so ref is stable) ────
  const handleMessage = useCallback((msg: ServerMessage) => {
    // For now, just collect all messages for debugging.
    // Milestone 5 will replace this with a proper reducer.
    setMessages((prev) => [...prev, msg]);
  }, []);

  // ── Initialize WSClient on mount ──────────────────────
  useEffect(() => {
    const client = new WSClient({
      url: WS_URL,
      onMessage: handleMessage,
      onStateChange: setConnectionState,
    });

    clientRef.current = client;
    client.connect();

    // Cleanup on unmount
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [handleMessage]);

  // ── Send message handler ──────────────────────────────
  const handleSendMessage = (content: string) => {
    if (!clientRef.current) return;
    clientRef.current.sendUserMessage(content);
    setMessages([]); // Clear previous messages for new turn
  };

  // ── Input submit handler ──────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const input = e.currentTarget;
      const content = input.value.trim();
      if (content) {
        handleSendMessage(content);
        input.value = "";
      }
    }
  };

  const isConnected = connectionState === "CONNECTED";

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
              {messages.length === 0 ? (
                <p className={styles.placeholder}>Events will appear here during streaming</p>
              ) : (
                <div className={styles.debugLog}>
                  {messages.map((msg, i) => (
                    <div key={i} className={styles.debugEntry}>
                      <span className={styles.debugSeq}>#{msg.seq}</span>
                      <span className={styles.debugType}>{msg.type}</span>
                      {msg.type === "TOKEN" && (
                        <span className={styles.debugText}>{msg.text}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Chat (center) */}
        <section className={styles.chat}>
          <div className={styles.panelBody}>
            {messages.length === 0 ? (
              <p className={styles.placeholder}>Send a message to start</p>
            ) : (
              <div className={styles.chatMessages}>
                {/* Temporary: show concatenated token text */}
                <p className={styles.streamText}>
                  {messages
                    .filter((m) => m.type === "TOKEN")
                    .map((m) => (m.type === "TOKEN" ? m.text : ""))
                    .join("")}
                </p>
              </div>
            )}
          </div>
          <div className={styles.inputArea}>
            <input
              type="text"
              className={styles.input}
              placeholder='Try "hello" or "summarize the report"...'
              onKeyDown={handleKeyDown}
              disabled={!isConnected}
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
