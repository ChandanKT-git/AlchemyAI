"use client";

// ─────────────────────────────────────────────────────────────
// DiffView — Merged prev/next tree with inline diff highlights
//
// Unlike JsonTree (which renders a single snapshot), DiffView
// takes BOTH the previous and current snapshot and renders a
// "merged" tree showing added, removed, and changed nodes inline.
//
// WHY MERGED RENDERING?
// Removed keys don't exist in the new snapshot's data object.
// If we only render the new data, removed keys are invisible.
// The merged approach visits all keys from both prev and next at
// every level, rendering "ghost" nodes for removed keys.
//
// RENDERING RULES per node:
//   only in next  → green background (added)
//   only in prev  → red strikethrough (removed, grayed out)
//   in both, same → no highlight
//   in both, diff → recurse; leaf changes show old → new inline
//
// BUBBLE-UP:
//   hasChangesPaths (all ancestors of every changed path) drives
//   the orange dot indicator on collapsed parent nodes.
//
// LAZY EXPANSION:
//   Same as JsonTree — only root starts open. Children are not
//   rendered until the user clicks the expand toggle.
// ─────────────────────────────────────────────────────────────

import { useState, useMemo, memo } from "react";
import type { DiffResult } from "@/lib/context-inspector/diff";
import { computeChangedPathSet } from "@/lib/context-inspector/diff";
import { renderValue } from "./JsonTree";
import styles from "./DiffView.module.css";

// ── Public component ──────────────────────────────────────────

interface DiffViewProps {
  /** New snapshot data (the "next" side) */
  data: unknown;
  /** Previous snapshot data (the "prev" side) */
  prevData: unknown;
  /** Pre-computed diff result — used for the summary badge */
  diff: DiffResult;
}

export default function DiffView({ data, prevData, diff }: DiffViewProps) {
  // Build the "has changes anywhere below" path set for bubble-up dots
  const hasChangesPaths = useMemo(
    () => computeChangedPathSet(diff),
    [diff]
  );

  const hasAnyChanges =
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.changed.length > 0;

  return (
    <div className={styles.container}>
      {/* ── Summary badge ───────────────────────────── */}
      <div className={styles.summary}>
        {hasAnyChanges ? (
          <>
            {diff.added.length > 0 && (
              <span className={styles.badgeAdded}>
                +{diff.added.length} added
              </span>
            )}
            {diff.removed.length > 0 && (
              <span className={styles.badgeRemoved}>
                -{diff.removed.length} removed
              </span>
            )}
            {diff.changed.length > 0 && (
              <span className={styles.badgeChanged}>
                ~{diff.changed.length} changed
              </span>
            )}
          </>
        ) : (
          <span className={styles.noChanges}>
            No changes from previous snapshot
          </span>
        )}
      </div>

      {/* ── Merged tree ─────────────────────────────── */}
      <div className={styles.tree}>
        <MergedNode
          prevData={prevData}
          nextData={data}
          path=""
          depth={0}
          hasChangesPaths={hasChangesPaths}
        />
      </div>
    </div>
  );
}

// ── MergedNode ────────────────────────────────────────────────
// Internal recursive component for the merged tree.
// prevData = undefined means "this key doesn't exist in prev"
// nextData = undefined means "this key doesn't exist in next"

interface MergedNodeProps {
  prevData: unknown;
  nextData: unknown;
  path: string;
  depth: number;
  hasChangesPaths: Set<string>;
}

function MergedNodeInner({
  prevData,
  nextData,
  path,
  depth,
  hasChangesPaths,
}: MergedNodeProps) {
  const [isOpen, setIsOpen] = useState(depth === 0);

  const prevMissing = prevData === undefined;
  const nextMissing = nextData === undefined;

  // ── Purely added node (exists in next, not in prev) ───────
  if (prevMissing && !nextMissing) {
    return (
      <span className={styles.added}>
        <InlineValue data={nextData} />
      </span>
    );
  }

  // ── Purely removed node (exists in prev, not in next) ─────
  if (!prevMissing && nextMissing) {
    return (
      <span className={styles.removed}>
        <del>
          <InlineValue data={prevData} />
        </del>
      </span>
    );
  }

  // ── Both present ──────────────────────────────────────────

  const prevIsExpandable = prevData !== null && typeof prevData === "object";
  const nextIsExpandable = nextData !== null && typeof nextData === "object";
  const prevIsArray = Array.isArray(prevData);
  const nextIsArray = Array.isArray(nextData);

  // If neither is expandable, or types are incompatible, render inline
  if (
    !prevIsExpandable ||
    !nextIsExpandable ||
    prevIsArray !== nextIsArray
  ) {
    if (prevData === nextData) {
      // Identical scalar — no highlight
      return <span>{renderValue(nextData)}</span>;
    }
    // Changed scalar — show old → new
    return (
      <span className={styles.changed}>
        <span className={styles.oldVal}>
          <del>{renderValue(prevData)}</del>
        </span>
        <span className={styles.arrow}> → </span>
        {renderValue(nextData)}
      </span>
    );
  }

  // ── Both are objects or both are arrays ───────────────────
  const isArray = nextIsArray;
  const prevObj = prevData as Record<string, unknown>;
  const nextObj = nextData as Record<string, unknown>;

  // Merge keys from both sides (preserving insertion order from next)
  let keys: Array<string | number>;
  if (isArray) {
    const maxLen = Math.max(
      (prevData as unknown[]).length,
      (nextData as unknown[]).length
    );
    keys = Array.from({ length: maxLen }, (_, i) => i);
  } else {
    // next keys first (preserves order), then any extra prev-only keys
    const seen = new Set(Object.keys(nextObj));
    const prevOnly = Object.keys(prevObj).filter((k) => !seen.has(k));
    keys = [...Object.keys(nextObj), ...prevOnly];
  }

  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const hasNestedChanges =
    !isOpen && path !== "" && hasChangesPaths.has(path);

  return (
    <span>
      {/* Expand/collapse toggle */}
      <button
        className={styles.toggle}
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Collapse" : "Expand"}
      >
        <span className={styles.arrow}>{isOpen ? "▾" : "▸"}</span>
      </button>

      {/* Bubble-up change indicator */}
      {hasNestedChanges && (
        <span className={styles.changeDot} title="Has nested changes" />
      )}

      {isOpen ? (
        <span className={styles.subtree}>
          <span className={styles.bracket}>{openBracket}</span>
          <span className={styles.children}>
            {keys.map((key, i) => {
              const keyStr = String(key);
              const childPath = isArray
                ? path ? `${path}[${key}]` : `[${key}]`
                : path ? `${path}.${keyStr}` : keyStr;

              // Determine presence in prev/next
              let prevHas: boolean;
              let nextHas: boolean;
              let prevChild: unknown;
              let nextChild: unknown;

              if (isArray) {
                const idx = key as number;
                prevHas = idx < (prevData as unknown[]).length;
                nextHas = idx < (nextData as unknown[]).length;
                prevChild = prevHas ? (prevData as unknown[])[idx] : undefined;
                nextChild = nextHas ? (nextData as unknown[])[idx] : undefined;
              } else {
                prevHas = Object.prototype.hasOwnProperty.call(prevObj, keyStr);
                nextHas = Object.prototype.hasOwnProperty.call(nextObj, keyStr);
                prevChild = prevHas ? prevObj[keyStr] : undefined;
                nextChild = nextHas ? nextObj[keyStr] : undefined;
              }

              const childIsAdded = !prevHas && nextHas;
              const childIsRemoved = prevHas && !nextHas;

              return (
                <span key={keyStr} className={styles.entry}>
                  {/* Key label */}
                  {!isArray && (
                    <span
                      className={[
                        styles.key,
                        childIsAdded ? styles.keyAdded : "",
                        childIsRemoved ? styles.keyRemoved : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className={styles.keyName}>
                        &quot;{keyStr}&quot;
                      </span>
                      <span className={styles.colon}>: </span>
                    </span>
                  )}

                  {/* Value (lazy: only rendered because parent is open) */}
                  <MergedNode
                    prevData={prevHas ? prevChild : undefined}
                    nextData={nextHas ? nextChild : undefined}
                    path={childPath}
                    depth={depth + 1}
                    hasChangesPaths={hasChangesPaths}
                  />

                  {i < keys.length - 1 && (
                    <span className={styles.comma}>,</span>
                  )}
                </span>
              );
            })}
          </span>
          <span className={styles.bracket}>{closeBracket}</span>
        </span>
      ) : (
        /* Collapsed summary */
        <span className={styles.collapsed}>
          {openBracket}
          <span className={styles.ellipsis}>{keys.length} items</span>
          {closeBracket}
        </span>
      )}
    </span>
  );
}

// ── InlineValue ───────────────────────────────────────────────
// For added/removed nodes: render a compact representation.
// For expandable values, show them as collapsed summaries inline.

function InlineValue({ data }: { data: unknown }) {
  if (data === null || typeof data !== "object") {
    return <span>{renderValue(data)}</span>;
  }
  const isArray = Array.isArray(data);
  const count = isArray
    ? (data as unknown[]).length
    : Object.keys(data as object).length;
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  return (
    <span>
      {open}
      <span className={styles.ellipsis}>{count} items</span>
      {close}
    </span>
  );
}

const MergedNode = memo(MergedNodeInner);
