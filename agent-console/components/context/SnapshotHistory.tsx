"use client";

// ─────────────────────────────────────────────────────────────
// SnapshotHistory — Scrubber for stepping through context snapshots
//
// Renders a compact prev/next control:
//   ◀  2 / 5  ▶  (latest)
//
// When only one snapshot exists, shows a minimal "1 / 1 (only)" label.
// The "(latest)" badge appears when the user is viewing the newest
// snapshot — important so they know they're not missing updates.
// ─────────────────────────────────────────────────────────────

import styles from "./SnapshotHistory.module.css";

interface SnapshotHistoryProps {
  /** Total number of snapshots stored for this context_id */
  total: number;
  /** Currently viewed snapshot index (0-based) */
  current: number;
  /** Called when the user navigates to a different snapshot */
  onChange: (index: number) => void;
}

export default function SnapshotHistory({
  total,
  current,
  onChange,
}: SnapshotHistoryProps) {
  if (total <= 1) {
    return (
      <div className={styles.bar}>
        <span className={styles.label}>Snapshot 1 / 1</span>
        <span className={styles.badge}>(only)</span>
      </div>
    );
  }

  const isFirst = current === 0;
  const isLast = current === total - 1;

  return (
    <div className={styles.bar}>
      <button
        className={styles.btn}
        onClick={() => onChange(current - 1)}
        disabled={isFirst}
        title="Previous snapshot"
        aria-label="Previous snapshot"
      >
        ◀
      </button>

      <span className={styles.label}>
        {current + 1} / {total}
      </span>

      <button
        className={styles.btn}
        onClick={() => onChange(current + 1)}
        disabled={isLast}
        title="Next snapshot (latest)"
        aria-label="Next snapshot"
      >
        ▶
      </button>

      {isLast && <span className={styles.badge}>(latest)</span>}
      {!isLast && (
        <span className={styles.outdated}>(viewing older snapshot)</span>
      )}
    </div>
  );
}
