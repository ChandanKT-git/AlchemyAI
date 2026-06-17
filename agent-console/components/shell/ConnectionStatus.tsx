"use client";

// ─────────────────────────────────────────────────────────────
// ConnectionStatus — Non-blocking reconnection indicator
//
// Shows a dot + label in the header. NOT a modal or overlay —
// chat stays fully interactive during reconnection.
//
// BACKOFF DISPLAY (Milestone 10):
//   When state = DISCONNECTED, we receive a ReconnectInfo with
//   the delay until the next attempt. We run a 1-second countdown
//   timer locally so the user sees "Reconnecting in 3s…".
//
//   When the retry fires and state moves to RECONNECTING, the
//   parent clears reconnectInfo → countdown stops.
//
// Color mapping:
//   CONNECTED     → green dot
//   CONNECTING    → yellow dot (pulsing)
//   RECONNECTING  → yellow dot (pulsing)
//   DISCONNECTED  → red dot (pulsing)
//   IDLE          → gray dot
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import type { ConnectionState, ReconnectInfo } from "@/lib/protocol/ws-client";
import styles from "./ConnectionStatus.module.css";

interface ConnectionStatusProps {
  state: ConnectionState;
  /**
   * Provided by AgentProvider when a reconnect is scheduled.
   * Null when connected or actively reconnecting.
   */
  reconnectInfo?: ReconnectInfo | null;
}

export default function ConnectionStatus({
  state,
  reconnectInfo,
}: ConnectionStatusProps) {
  // ── Local countdown timer ────────────────────────────────
  // Counts down from reconnectInfo.delayMs (in seconds) to 0.
  // Resets whenever reconnectInfo changes (new retry scheduled).
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (
      state !== "DISCONNECTED" ||
      !reconnectInfo ||
      reconnectInfo.delayMs <= 0
    ) {
      setCountdown(null);
      return;
    }

    // Round up to nearest second for display (e.g. 500ms → "1s")
    const initialSeconds = Math.ceil(reconnectInfo.delayMs / 1000);
    setCountdown(initialSeconds);

    if (initialSeconds === 0) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [reconnectInfo, state]);

  // ── Compute label ────────────────────────────────────────
  let label: string;
  let detail: string | null = null;

  switch (state) {
    case "CONNECTED":
      label = "Connected";
      break;

    case "CONNECTING":
      label = "Connecting\u2026";
      break;

    case "RECONNECTING":
      label = "Reconnecting\u2026";
      if (reconnectInfo && reconnectInfo.attempt > 0) {
        detail = `attempt ${reconnectInfo.attempt}`;
      }
      break;

    case "DISCONNECTED":
      if (countdown !== null && countdown > 0) {
        label = `Reconnecting in ${countdown}s`;
      } else {
        label = "Reconnecting\u2026";
      }
      if (reconnectInfo && reconnectInfo.attempt > 1) {
        detail = `attempt ${reconnectInfo.attempt}`;
      }
      break;

    case "IDLE":
    default:
      label = "Disconnected";
      break;
  }

  // ── Dot CSS class ────────────────────────────────────────
  const dotClass = `${styles.dot} ${styles[state.toLowerCase() as Lowercase<ConnectionState>]}`;

  return (
    <div className={styles.container} title={`Connection: ${state}`}>
      <span className={dotClass} />
      <span className={styles.label}>{label}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
    </div>
  );
}
