/**
 * Snapshot layering resolution.
 *
 * Pure function that picks the best snapshot for a session using a priority chain:
 * 1. Restore snapshot (from configuration finalize or manual snapshot save)
 * 2. Repo snapshot (Modal only, single-repo, workspacePath ".")
 * 3. No snapshot (base image + live clone)
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
	/** Snapshot already stored on the configuration (from finalize or manual save). */
	configurationSnapshotId: string | null;
	/** Sandbox provider for the configuration (e.g. "modal", "e2b"). */
	sandboxProvider: string | null | undefined;
	/** Repos attached to the configuration via configuration_repos junction. */
	configurationRepos: RepoSnapshotInfo[];
}

/**
 * Resolve the snapshot ID for a session using layering rules.
 *
 * Returns the snapshot ID to use, or null if the session should start
 * from a base image with a live clone.
 */
export function resolveSnapshotId(input: ResolveSnapshotInput): string | null {
	// Restore snapshot (configuration/session) always wins.
	if (input.configurationSnapshotId) {
		return input.configurationSnapshotId;
	}

	// Repo snapshot — only for Modal provider, single-repo, workspacePath ".".
	// Unknown/null provider = no repo snapshot (require explicit "modal").
	if (input.sandboxProvider !== "modal") {
		return null;
	}

	if (input.configurationRepos.length !== 1) {
		return null;
	}

	const singleRepo = input.configurationRepos[0];
	if (
		singleRepo.workspacePath === "." &&
		singleRepo.repo?.repoSnapshotStatus === "ready" &&
		singleRepo.repo.repoSnapshotId &&
		(!singleRepo.repo.repoSnapshotProvider || singleRepo.repo.repoSnapshotProvider === "modal")
	) {
		return singleRepo.repo.repoSnapshotId;
	}

	// No snapshot — start from base image with live clone.
	return null;
}
