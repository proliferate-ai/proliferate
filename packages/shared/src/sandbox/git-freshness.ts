/**
 * Git Freshness — shared logic for pull-on-restore across providers.
 *
 * Both Modal and E2B call `shouldPullOnRestore` to decide whether to
 * run `git pull --ff-only` when a snapshot is restored.
 */

export interface ShouldPullOpts {
	/** SANDBOX_GIT_PULL_ON_RESTORE env flag. */
	enabled: boolean;
	/** True when restoring from a snapshot (not a fresh clone). */
	hasSnapshot: boolean;
	/** Number of repos attached to the session. */
	repoCount: number;
	/** SANDBOX_GIT_PULL_CADENCE_SECONDS — 0 means "always pull when enabled". */
	cadenceSeconds: number;
	/** SessionMetadata.lastGitFetchAt (may be undefined for legacy snapshots). */
	lastGitFetchAt?: number;
	/** Override for deterministic tests. */
	now?: number;
}

/**
 * Determine whether a git pull should be performed on snapshot restore.
 *
 * Returns `false` when:
 * - The feature is disabled (`enabled = false`)
 * - There is no snapshot to restore (`hasSnapshot = false`)
 * - There are no repos (`repoCount = 0`)
 * - The cadence window has not elapsed since the last fetch
 *
 * Returns `true` when the cadence is 0 (always), when there is no
 * `lastGitFetchAt` timestamp (legacy snapshots), or when enough time
 * has elapsed.
 */
export function shouldPullOnRestore(opts: ShouldPullOpts): boolean {
	if (!opts.enabled || !opts.hasSnapshot || opts.repoCount === 0) return false;
	if (opts.cadenceSeconds <= 0) return true;
	if (opts.lastGitFetchAt == null) return true;
	const now = opts.now ?? Date.now();
	return now - opts.lastGitFetchAt > opts.cadenceSeconds * 1000;
}
