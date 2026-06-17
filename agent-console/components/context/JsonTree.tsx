"use client";

// ─────────────────────────────────────────────────────────────
// JsonTree — Recursive, lazy-expanding JSON tree viewer
//
// Key design decisions:
//
// LAZY EXPANSION:
//   Only the root node is auto-expanded. All child objects/arrays
//   start collapsed. Clicking the ▸ toggle renders the children.
//   This means a 500KB object with 5000 top-level keys renders
//   only the key names initially — no deep subtrees, no jank.
//
// DIFF INTEGRATION:
//   Optional Sets of paths (added, removed, changed, hasChanges)
//   drive per-node highlighting. Each node checks its own path
//   against these Sets in O(1). The `hasChangesPaths` set is the
//   union of all changed paths AND their ancestors — this lets
//   us show a "has nested changes" dot even when a node is collapsed.
//
//   NOTE: removedPaths are NOT rendered here because the data only
//   contains the NEW snapshot's keys. Removed keys are rendered by
//   DiffView's MergedNode instead.
//
// SYNTAX HIGHLIGHTING:
//   string → teal, number → blue, boolean → orange, null → gray
// ─────────────────────────────────────────────────────────────

import { useState, memo } from "react";
import styles from "./JsonTree.module.css";

// ── Props ─────────────────────────────────────────────────────

export interface JsonTreeProps {
  data: unknown;
  /** JSON path for this node (e.g. "tables[0].name") — empty for root */
  path?: string;
  /** Depth level — root = 0 */
  depth?: number;
  /** Paths added in the current diff */
  addedPaths?: Set<string>;
  /** Paths where the value changed in the current diff */
  changedPaths?: Set<string>;
  /**
   * All paths that have any change, including ancestors.
   * Used to show a "has nested changes" bubble-up indicator
   * on collapsed parent nodes.
   */
  hasChangesPaths?: Set<string>;
}

// ── Core node ─────────────────────────────────────────────────

function JsonTreeNodeInner({
  data,
  path = "",
  depth = 0,
  addedPaths,
  changedPaths,
  hasChangesPaths,
}: JsonTreeProps) {
  // Only root starts expanded; deeper nodes require a click to open.
  const [isOpen, setIsOpen] = useState(depth === 0);

  const isExpandable = data !== null && typeof data === "object";
  const isArray = Array.isArray(data);

  // ── Diff status for this exact path ──────────────────────
  const isAdded = path ? (addedPaths?.has(path) ?? false) : false;
  const isChanged = path ? (changedPaths?.has(path) ?? false) : false;
  // A collapsed node has nested changes (but is not itself added/changed)
  const hasNestedChanges =
    !isOpen &&
    path &&
    !isAdded &&
    !isChanged &&
    (hasChangesPaths?.has(path) ?? false);

  // ── CSS classes ──────────────────────────────────────────
  const nodeClass = [
    styles.node,
    isAdded ? styles.added : "",
    isChanged ? styles.changed : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ── Scalar value ─────────────────────────────────────────
  if (!isExpandable) {
    return <span className={nodeClass}>{renderValue(data)}</span>;
  }

  // ── Build entry list ─────────────────────────────────────
  const entries = isArray
    ? (data as unknown[]).map((v, i) => ({
        displayKey: String(i),
        childPath: path ? `${path}[${i}]` : `[${i}]`,
        value: v,
      }))
    : Object.entries(data as Record<string, unknown>).map(([k, v]) => ({
        displayKey: k,
        childPath: path ? `${path}.${k}` : k,
        value: v,
      }));

  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const count = entries.length;

  return (
    <span className={nodeClass}>
      {/* ── Expand/collapse toggle ──────────────────── */}
      <button
        className={styles.toggle}
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Collapse" : "Expand"}
      >
        <span className={styles.arrow}>{isOpen ? "▾" : "▸"}</span>
      </button>

      {/* ── Bubble-up change indicator (collapsed only) ─ */}
      {hasNestedChanges && (
        <span className={styles.changeDot} title="Has nested changes" />
      )}

      {isOpen ? (
        <span className={styles.subtree}>
          <span className={styles.bracket}>{openBracket}</span>
          <span className={styles.children}>
            {entries.map(({ displayKey, childPath, value }, i) => {
              const childIsAdded = addedPaths?.has(childPath) ?? false;
              const childIsChanged = changedPaths?.has(childPath) ?? false;

              return (
                <span key={displayKey} className={styles.entry}>
                  {/* Key label (omit index for arrays) */}
                  {!isArray && (
                    <span
                      className={[
                        styles.key,
                        childIsAdded ? styles.added : "",
                        childIsChanged ? styles.changed : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className={styles.keyName}>
                        &quot;{displayKey}&quot;
                      </span>
                      <span className={styles.colon}>: </span>
                    </span>
                  )}

                  {/* Value (lazy: only rendered because parent is open) */}
                  <JsonTreeNode
                    data={value}
                    path={childPath}
                    depth={depth + 1}
                    addedPaths={addedPaths}
                    changedPaths={changedPaths}
                    hasChangesPaths={hasChangesPaths}
                  />

                  {i < entries.length - 1 && (
                    <span className={styles.comma}>,</span>
                  )}
                </span>
              );
            })}
          </span>
          <span className={styles.bracket}>{closeBracket}</span>
        </span>
      ) : (
        /* Collapsed inline summary */
        <span className={styles.collapsed}>
          {openBracket}
          <span className={styles.ellipsis}>
            {count} {count === 1 ? "item" : "items"}
          </span>
          {closeBracket}
        </span>
      )}
    </span>
  );
}

// ── Value renderer (syntax highlighting) ─────────────────────

export function renderValue(value: unknown): React.ReactNode {
  if (value === null) return <span className={styles.null}>null</span>;
  if (value === undefined)
    return <span className={styles.null}>undefined</span>;
  if (typeof value === "boolean")
    return <span className={styles.boolean}>{String(value)}</span>;
  if (typeof value === "number")
    return <span className={styles.number}>{String(value)}</span>;
  if (typeof value === "string")
    return <span className={styles.string}>&quot;{value}&quot;</span>;
  return <span className={styles.null}>{String(value)}</span>;
}

// ── Memoized export ───────────────────────────────────────────

const JsonTreeNode = memo(JsonTreeNodeInner);
export default JsonTreeNode;
