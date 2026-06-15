"use client";

// ─────────────────────────────────────────────────────────────
// MessageInput — User input bar with Enter-to-send
//
// Features:
// - Disabled when not connected
// - Shows stream status (streaming, tool pending, etc.)
// - Clears on send
// - Visual feedback for disabled state
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from "react";
import type { ConnectionState } from "@/lib/protocol/ws-client";
import type { StreamStatus } from "@/lib/agent/types";
import styles from "./MessageInput.module.css";

interface MessageInputProps {
  onSend: (content: string) => void;
  connectionState: ConnectionState;
  streamStatus: StreamStatus;
}

export default function MessageInput({
  onSend,
  connectionState,
  streamStatus,
}: MessageInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isConnected = connectionState === "CONNECTED";
  const isStreaming = streamStatus === "streaming" || streamStatus === "tool_pending";
  const canSend = isConnected && !isStreaming && value.trim().length > 0;

  // Auto-focus when connected
  useEffect(() => {
    if (isConnected && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isConnected]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || !canSend) return;

    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Placeholder text based on state
  let placeholder = 'Try "hello" or "summarize the report"...';
  if (!isConnected) placeholder = "Connecting...";
  else if (isStreaming) placeholder = "Agent is responding...";

  return (
    <div className={styles.container}>
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={!isConnected || isStreaming}
        aria-label="Message input"
      />
      <button
        className={styles.sendBtn}
        onClick={handleSubmit}
        disabled={!canSend}
        title="Send message"
        aria-label="Send"
      >
        ↑
      </button>
    </div>
  );
}
