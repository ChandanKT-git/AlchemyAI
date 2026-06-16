"use client";

// ─────────────────────────────────────────────────────────────
// ToolCard — A structural card for one tool call
//
// Shows tool name, args, and result. Pulsing border while pending.
// Memoized — only re-renders when the tool block changes
// (i.e., when the result arrives or status changes).
//
// WHY ITS OWN COMPONENT?
// The ToolCard was initially inline in StreamMessage. But now
// it needs interactivity (collapsible args/result, clickable
// for timeline linking). Extracting it makes testing and
// reuse cleaner.
// ─────────────────────────────────────────────────────────────

import React, { useState } from "react";
import type { ToolCallBlock } from "@/lib/agent/types";
import styles from "./ToolCard.module.css";

interface ToolCardProps {
  block: ToolCallBlock;
}

function ToolCardInner({ block }: ToolCardProps) {
  const isPending = block.status === "pending";
  const [argsOpen, setArgsOpen] = useState(true);
  const [resultOpen, setResultOpen] = useState(true);

  return (
    <div
      className={`${styles.card} ${isPending ? styles.pending : styles.complete}`}
      data-call-id={block.callId}
    >
      {/* ── Header ────────────────────────────────── */}
      <div className={styles.header}>
        <span className={styles.icon}>
          {isPending ? (
            <span className={styles.spinner} />
          ) : (
            "✓"
          )}
        </span>
        <span className={styles.toolName}>{block.toolName}</span>
        <span className={styles.callId}>{block.callId}</span>
        <span className={styles.status}>
          {isPending ? "Executing..." : "Complete"}
        </span>
      </div>

      {/* ── Args (collapsible) ────────────────────── */}
      <div className={styles.section}>
        <button
          className={styles.sectionToggle}
          onClick={() => setArgsOpen((v) => !v)}
        >
          <span className={styles.arrow}>{argsOpen ? "▾" : "▸"}</span>
          Args
        </button>
        {argsOpen && (
          <pre className={styles.code}>
            {JSON.stringify(block.args, null, 2)}
          </pre>
        )}
      </div>

      {/* ── Result (collapsible, only when complete) ─ */}
      {block.result && (
        <div className={styles.section}>
          <button
            className={styles.sectionToggle}
            onClick={() => setResultOpen((v) => !v)}
          >
            <span className={styles.arrow}>{resultOpen ? "▾" : "▸"}</span>
            Result
          </button>
          {resultOpen && (
            <pre className={styles.code}>
              {JSON.stringify(block.result, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* ── Pending shimmer when waiting ──────────── */}
      {isPending && (
        <div className={styles.pendingBar}>
          <div className={styles.shimmer} />
        </div>
      )}
    </div>
  );
}

const ToolCard = React.memo(ToolCardInner);
export default ToolCard;
