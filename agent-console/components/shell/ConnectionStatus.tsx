"use client";

/**
 * ConnectionStatus — Non-blocking reconnection indicator.
 *
 * Shows a small dot + text in the header. NOT a modal or overlay.
 * Chat remains fully interactive during reconnection.
 *
 * Color mapping:
 *   CONNECTED     → green dot
 *   CONNECTING    → yellow dot (pulsing)
 *   RECONNECTING  → yellow dot (pulsing)
 *   DISCONNECTED  → red dot
 *   IDLE          → gray dot
 */

import type { ConnectionState } from "@/lib/protocol/ws-client";
import styles from "./ConnectionStatus.module.css";

interface ConnectionStatusProps {
  state: ConnectionState;
}

const STATE_LABELS: Record<ConnectionState, string> = {
  IDLE: "Disconnected",
  CONNECTING: "Connecting...",
  CONNECTED: "Connected",
  DISCONNECTED: "Reconnecting...",
  RECONNECTING: "Reconnecting...",
};

export default function ConnectionStatus({ state }: ConnectionStatusProps) {
  const label = STATE_LABELS[state];

  // CSS class for the dot color
  const dotClass = `${styles.dot} ${styles[state.toLowerCase()]}`;

  return (
    <div className={styles.container} title={`Connection: ${state}`}>
      <span className={dotClass} />
      <span className={styles.label}>{label}</span>
    </div>
  );
}
