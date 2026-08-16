/**
 * UX-latency R14: listeners notified when a replaced-session tombstone durably
 * commits, so warm-kept session-directory query entries can be invalidated and
 * refreshed. Before R14 the sessions query was garbage-collected on navigate
 * away, so a stale warm entry could never outlive a replacement; now that the
 * last N visited entries are pinned (workspace-session-directory-keepalive.ts),
 * a committed replacement must invalidate the pinned entry so it can never keep
 * showing a retired session.
 *
 * Kept in its own module so session-replacement-tombstones.ts stays under the
 * frontend-structure line threshold.
 */
type ReplacedSessionTombstoneCommitListener = (workspaceId: string) => void;

const tombstoneCommitListeners = new Set<ReplacedSessionTombstoneCommitListener>();

export function addReplacedSessionTombstoneCommitListener(
  listener: ReplacedSessionTombstoneCommitListener,
): () => void {
  tombstoneCommitListeners.add(listener);
  return () => {
    tombstoneCommitListeners.delete(listener);
  };
}

export function notifyReplacedSessionTombstoneCommitted(workspaceId: string): void {
  for (const listener of tombstoneCommitListeners) {
    listener(workspaceId);
  }
}

export function clearReplacedSessionTombstoneCommitListeners(): void {
  tombstoneCommitListeners.clear();
}
