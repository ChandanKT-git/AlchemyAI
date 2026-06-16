"use client";

// ─────────────────────────────────────────────────────────────
// StreamMessage — Renders the Block array for one response
//
// The block array from the reducer looks like:
//   [TextBlock("Hello"), ToolCallBlock(pending), TextBlock("")]
//
// This component maps each block to a visual element:
//   - TextBlock → <p> with streamed text
//   - ToolCallBlock → <ToolCard> (dedicated component)
//
// PERFORMANCE: TextBlock content changes on every token (~30ms).
// ToolCards are memoized because they only change once
// (when the result arrives). Completed blocks are fully static.
// ─────────────────────────────────────────────────────────────

import React from "react";
import type { Block, StreamStatus } from "@/lib/agent/types";
import ToolCard from "./ToolCard";
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
          return <ToolCard key={block.callId} block={block} />;
        }

        return null;
      })}
    </div>
  );
}

export default React.memo(StreamMessage);
