"use client";

// ─────────────────────────────────────────────────────────────
// StreamMessage — Renders the Block array for one response
//
// The block array from the reducer looks like:
//   [TextBlock("Hello"), ToolCallBlock(pending), TextBlock("")]
//
// This component maps each block to a visual element:
//   - TextBlock → <p> with streamed text
//   - ToolCallBlock → structural card with tool name, args, result
//
// PERFORMANCE: TextBlock content changes on every token (~30ms).
// ToolCallBlocks are memoized because they only change once
// (when the result arrives). Completed blocks are fully static.
// ─────────────────────────────────────────────────────────────

import React from "react";
import type { Block, StreamStatus } from "@/lib/agent/types";
import styles from "./StreamMessage.module.css";

interface StreamMessageProps {
  blocks: Block[];
  status: StreamStatus;
}

function StreamMessage({ blocks, status }: StreamMessageProps) {
  // Filter out empty text blocks (no visual content)
  const visibleBlocks = blocks.filter(
    (b) => !(b.kind === "text" && b.text === "")
  );

  if (visibleBlocks.length === 0 && status === "idle") {
    return null;
  }

  return (
    <div className={styles.message}>
      {visibleBlocks.map((block, index) => {
        if (block.kind === "text") {
          return (
            <div key={`text-${index}`} className={styles.textBlock}>
              {block.text}
              {/* Show cursor on the last text block while streaming */}
              {status === "streaming" && index === visibleBlocks.length - 1 && (
                <span className={styles.cursor} />
              )}
            </div>
          );
        }

        if (block.kind === "tool_call") {
          return <ToolCallCard key={block.callId} block={block} />;
        }

        return null;
      })}
    </div>
  );
}

// ── ToolCallCard (memoized — only re-renders when result arrives) ──

interface ToolCallCardProps {
  block: Extract<Block, { kind: "tool_call" }>;
}

const ToolCallCard = React.memo(function ToolCallCard({
  block,
}: ToolCallCardProps) {
  const isPending = block.status === "pending";

  return (
    <div className={`${styles.toolCard} ${isPending ? styles.pending : styles.complete}`}>
      <div className={styles.toolHeader}>
        <span className={styles.toolIcon}>{isPending ? "⏳" : "✅"}</span>
        <span className={styles.toolName}>{block.toolName}</span>
        <span className={styles.toolStatus}>
          {isPending ? "Executing..." : "Complete"}
        </span>
      </div>

      {/* Arguments */}
      <div className={styles.toolSection}>
        <span className={styles.toolLabel}>Args</span>
        <pre className={styles.toolCode}>
          {JSON.stringify(block.args, null, 2)}
        </pre>
      </div>

      {/* Result (only when complete) */}
      {block.result && (
        <div className={styles.toolSection}>
          <span className={styles.toolLabel}>Result</span>
          <pre className={styles.toolCode}>
            {JSON.stringify(block.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
});

export default React.memo(StreamMessage);
