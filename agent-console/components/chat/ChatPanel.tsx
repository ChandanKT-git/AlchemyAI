"use client";

// ─────────────────────────────────────────────────────────────
// ChatPanel — Message list + auto-scroll + input
//
// Renders:
// - User message (what was sent)
// - Stream response (blocks from the reducer)
// - Auto-scrolls to bottom on new tokens
//
// PERFORMANCE:
// Auto-scroll uses a ref at the bottom of the scroll container.
// We scroll into view only when new tokens arrive, not on
// every re-render (which would fight user scrolling).
// ─────────────────────────────────────────────────────────────

import { useRef, useEffect, useState } from "react";
import { useAgent } from "@/lib/agent/context";
import StreamMessage from "./StreamMessage";
import MessageInput from "./MessageInput";
import styles from "./ChatPanel.module.css";

export default function ChatPanel() {
  const { state, connectionState, sendMessage } = useAgent();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userMessage, setUserMessage] = useState<string | null>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [state.stream.blocks]);

  // Handle send — capture what the user typed
  const handleSend = (content: string) => {
    setUserMessage(content);
    sendMessage(content);
  };

  const hasContent = state.stream.blocks.length > 0;

  return (
    <section className={styles.panel}>
      <div className={styles.messages}>
        {!hasContent && !userMessage && (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Agent Console</p>
            <p className={styles.emptyHint}>
              Send a message to start a conversation with the AI agent.
            </p>
          </div>
        )}

        {/* User message bubble */}
        {userMessage && (
          <div className={styles.userBubble}>
            <span className={styles.userLabel}>You</span>
            <p className={styles.userText}>{userMessage}</p>
          </div>
        )}

        {/* Agent response (block stream) */}
        {hasContent && (
          <div className={styles.agentResponse}>
            <span className={styles.agentLabel}>Agent</span>
            <StreamMessage
              blocks={state.stream.blocks}
              status={state.stream.status}
            />
          </div>
        )}

        {/* Error display */}
        {state.lastError && (
          <div className={styles.errorCard}>
            <span className={styles.errorCode}>{state.lastError.code}</span>
            <span className={styles.errorMessage}>{state.lastError.message}</span>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={scrollRef} />
      </div>

      <MessageInput
        onSend={handleSend}
        connectionState={connectionState}
        streamStatus={state.stream.status}
      />
    </section>
  );
}
