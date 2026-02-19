/**
 * Snapshot layering resolution.
 *
 * Pure function that picks the best snapshot for a session:
 * 1. Configuration snapshot (from auto-build or finalize)
 * 2. No snapshot (base image + live clone)
 */

export interface RepoSnapshotInfo {
	workspacePath: string;
	repo: {
		repoSnapshotId: string | null;
		repoSnapshotStatus: string | null;
		repoSnapshotProvider: string | null;
	} | null;
}

export interface ResolveSnapshotInput {
	/** Snapshot stored on the configuration (from auto-build or finalize). */
	configurationSnapshotId: string | null;
	/** Sandbox provider for the configuration (e.g. "modal", "e2b"). */
	sandboxProvider: string | null | undefined;
	/** Repos attached to the configuration via configuration_repos junction. */
	configurationRepos: RepoSnapshotInfo[];
}

/**
 * Resolve the snapshot ID for a session.
 *
 * Returns the configuration snapshot ID if available, or null to start
 * from a base image with a live clone.
 */
export function resolveSnapshotId(input: ResolveSnapshotInput): string | null {
	// Configuration snapshot (from auto-build or finalize) if available.
	if (input.configurationSnapshotId) {
		return input.configurationSnapshotId;
	}

	// No snapshot — start from base image with live clone.
	return null;
}
