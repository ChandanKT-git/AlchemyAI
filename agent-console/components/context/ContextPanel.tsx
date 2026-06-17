"use client";

// ─────────────────────────────────────────────────────────────
// ContextPanel — Context Inspector with tabs + snapshot scrubber
//
// Milestone 9 full feature set:
//   1. TAB BAR — one tab per context_id (when > 1 exist)
//   2. SNAPSHOT SCRUBBER — prev/next to walk through history
//   3. TREE VIEW — JsonTree for snapshot[0], DiffView for [n>0]
//
// DESIGN DECISIONS:
//
// - Split into ContextPanel (outer shell) + ContextPanelContent
//   (inner with hooks). This respects React's rule that hooks
//   cannot appear after conditional returns.
//
// - Diff is computed on-the-fly (not stored in reducer) so the
//   reducer stays pure. deepDiff is O(n), well under 100ms for
//   500KB payloads.
//
// - Snapshot index is local React state with a "pinned / unpinned"
//   model: null = "always show latest" (auto-advances when new
//   snapshots arrive), a number = user-pinned to a past snapshot.
//   Navigating back to the last snapshot re-unpins.
// ─────────────────────────────────────────────────────────────

import { useState, useMemo } from "react";
import type { ContextState, ContextSnapshot } from "@/lib/agent/types";
import { deepDiff } from "@/lib/context-inspector/diff";
import JsonTree from "./JsonTree";
import DiffView from "./DiffView";
import SnapshotHistory from "./SnapshotHistory";
import styles from "./ContextPanel.module.css";

interface ContextPanelProps {
  context: ContextState;
}

// ── Outer shell: renders panel frame, delegates content ───────

export default function ContextPanel({ context }: ContextPanelProps) {
  const contextIds = Object.keys(context.contexts);

  return (
    <div className={styles.panel}>
      {contextIds.length === 0 ? (
        <>
          <div className={styles.panelHeader}>
            <span className={styles.title}>Context Inspector</span>
          </div>
          <p className={styles.empty}>Context snapshots will appear here</p>
        </>
      ) : (
        // Inner component handles all hooks — only mounted when there IS data
        <ContextPanelContent context={context} contextIds={contextIds} />
      )}
    </div>
  );
}

// ── Inner content: all hooks live here ───────────────────────

interface ContextPanelContentProps {
  context: ContextState;
  contextIds: string[];
}

function ContextPanelContent({
  context,
  contextIds,
}: ContextPanelContentProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  /**
   * Per-context-id snapshot index, stored as:
   *   null   → "pinned to latest" — auto-follows new snapshots
   *   number → user manually navigated to that index
   */
  const [pinnedIndices, setPinnedIndices] = useState<
    Record<string, number | null>
  >({});

  // ── Resolve active context_id ─────────────────────────────
  // Fall back to first if activeId is stale (e.g., context cleared)
  const currentId =
    activeId && context.contexts[activeId] ? activeId : contextIds[0];

  const snapshots: ContextSnapshot[] = context.contexts[currentId];
  const maxIndex = snapshots.length - 1;

  // Pinned to null → show latest (maxIndex). Explicit pin → clamped.
  const pinnedIndex = pinnedIndices[currentId] ?? null;
  const snapshotIndex =
    pinnedIndex === null ? maxIndex : Math.min(pinnedIndex, maxIndex);

  const currentSnapshot = snapshots[snapshotIndex];
  const prevSnapshot = snapshotIndex > 0 ? snapshots[snapshotIndex - 1] : null;

  // ── Diff (memoized; recomputes only when snapshots change) ─
  const diff = useMemo(() => {
    if (!prevSnapshot) return null;
    return deepDiff(prevSnapshot.data, currentSnapshot.data);
  }, [prevSnapshot, currentSnapshot]);

  // ── Handlers ──────────────────────────────────────────────

  function handleSnapshotChange(index: number) {
    // Stepping to the latest snapshot unpins (resumes auto-follow)
    const newPin = index === maxIndex ? null : index;
    setPinnedIndices((prev) => ({ ...prev, [currentId]: newPin }));
  }

  function handleTabChange(id: string) {
    setActiveId(id);
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <>
      {/* ── Panel header ──────────────────────────── */}
      <div className={styles.panelHeader}>
        <span className={styles.title}>Context Inspector</span>
        <span className={styles.contextId} title={currentId}>
          {currentId}
        </span>
      </div>

      {/* ── Tab bar (only when multiple contexts exist) ─ */}
      {contextIds.length > 1 && (
        <div className={styles.tabs}>
          {contextIds.map((id) => (
            <button
              key={id}
              className={`${styles.tab} ${id === currentId ? styles.tabActive : ""}`}
              onClick={() => handleTabChange(id)}
              title={id}
            >
              {id.length > 16 ? `\u2026${id.slice(-14)}` : id}
            </button>
          ))}
        </div>
      )}

      {/* ── Snapshot history scrubber ──────────────── */}
      <SnapshotHistory
        total={snapshots.length}
        current={snapshotIndex}
        onChange={handleSnapshotChange}
      />

      {/* ── Tree / diff view ─────────────────────────── */}
      <div className={styles.treeArea}>
        {diff ? (
          // Show merged diff view for all snapshots after the first
          <DiffView
            data={currentSnapshot.data}
            prevData={prevSnapshot!.data}
            diff={diff}
          />
        ) : (
          // Pure tree view for the first snapshot
          <div className={styles.treeWrapper}>
            <JsonTree data={currentSnapshot.data} />
          </div>
        )}
      </div>
    </>
  );
}
