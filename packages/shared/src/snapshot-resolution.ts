/**
 * Snapshot layering resolution.
 *
 * Pure function that picks the best snapshot for a session using a priority chain:
 * 1. Prebuild snapshot (from setup finalize or manual snapshot)
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
	/** Snapshot already stored on the prebuild (from finalize or manual save). */
	prebuildSnapshotId: string | null;
	/** Sandbox provider for the prebuild (e.g. "modal", "e2b"). */
	sandboxProvider: string | null | undefined;
	/** Repos attached to the prebuild via prebuild_repos junction. */
	prebuildRepos: RepoSnapshotInfo[];
}

/**
 * Resolve the snapshot ID for a session using layering rules.
 *
 * Returns the snapshot ID to use, or null if the session should start
 * from a base image with a live clone.
 */
export function resolveSnapshotId(input: ResolveSnapshotInput): string | null {
	// Layer 1: prebuild snapshot always wins
	if (input.prebuildSnapshotId) {
		return input.prebuildSnapshotId;
	}

	// Layer 2: repo snapshot — only for Modal provider, single-repo, workspacePath "."
	if (input.sandboxProvider && input.sandboxProvider !== "modal") {
		return null;
	}

	if (input.prebuildRepos.length !== 1) {
		return null;
	}

	const singleRepo = input.prebuildRepos[0];
	if (
		singleRepo.workspacePath === "." &&
		singleRepo.repo?.repoSnapshotStatus === "ready" &&
		singleRepo.repo.repoSnapshotId &&
		(!singleRepo.repo.repoSnapshotProvider || singleRepo.repo.repoSnapshotProvider === "modal")
	) {
		return singleRepo.repo.repoSnapshotId;
	}

	// Layer 3: no snapshot
	return null;
}
