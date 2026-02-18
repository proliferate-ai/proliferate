import { describe, expect, it } from "vitest";
import { type ResolveSnapshotInput, resolveSnapshotId } from "./snapshot-resolution";

function makeRepo(
	overrides: {
		workspacePath?: string;
		repoSnapshotId?: string | null;
		repoSnapshotStatus?: string | null;
		repoSnapshotProvider?: string | null;
	} = {},
): ResolveSnapshotInput["configurationRepos"][number] {
	return {
		workspacePath: overrides.workspacePath ?? ".",
		repo: {
			repoSnapshotId: overrides.repoSnapshotId ?? null,
			repoSnapshotStatus: overrides.repoSnapshotStatus ?? null,
			repoSnapshotProvider: overrides.repoSnapshotProvider ?? null,
		},
	};
}

describe("resolveSnapshotId", () => {
	it("returns restore snapshot when present", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: "config-snap-1",
			sandboxProvider: "modal",
			configurationRepos: [
				makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "ready" }),
			],
		});
		expect(result).toBe("config-snap-1");
	});

	it("returns repo snapshot for Modal single-repo with workspacePath '.'", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [
				makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "ready" }),
			],
		});
		expect(result).toBe("repo-snap-1");
	});

	it("returns null when sandboxProvider is null (unknown provider = no repo snapshot)", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: null,
			configurationRepos: [
				makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "ready" }),
			],
		});
		expect(result).toBeNull();
	});

	it("returns null for E2B provider even with ready repo snapshot", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "e2b",
			configurationRepos: [
				makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "ready" }),
			],
		});
		expect(result).toBeNull();
	});

	it("returns null for multi-repo configurations", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [
				makeRepo({ repoSnapshotId: "snap-a", repoSnapshotStatus: "ready" }),
				makeRepo({
					workspacePath: "backend",
					repoSnapshotId: "snap-b",
					repoSnapshotStatus: "ready",
				}),
			],
		});
		expect(result).toBeNull();
	});

	it("returns null when workspacePath is not '.'", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [
				makeRepo({
					workspacePath: "frontend",
					repoSnapshotId: "repo-snap-1",
					repoSnapshotStatus: "ready",
				}),
			],
		});
		expect(result).toBeNull();
	});

	it("returns null when repo snapshot status is not 'ready'", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [
				makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "building" }),
			],
		});
		expect(result).toBeNull();
	});

	it("returns null when repo snapshot status is null", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: null })],
		});
		expect(result).toBeNull();
	});

	it("returns null when repo has no repoSnapshotId", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [makeRepo({ repoSnapshotId: null, repoSnapshotStatus: "ready" })],
		});
		expect(result).toBeNull();
	});

	it("returns null when repo snapshot provider is non-Modal", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [
				makeRepo({
					repoSnapshotId: "repo-snap-1",
					repoSnapshotStatus: "ready",
					repoSnapshotProvider: "e2b",
				}),
			],
		});
		expect(result).toBeNull();
	});

	it("accepts repo snapshot when repoSnapshotProvider is 'modal'", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [
				makeRepo({
					repoSnapshotId: "repo-snap-1",
					repoSnapshotStatus: "ready",
					repoSnapshotProvider: "modal",
				}),
			],
		});
		expect(result).toBe("repo-snap-1");
	});

	it("accepts repo snapshot when repoSnapshotProvider is null", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [
				makeRepo({
					repoSnapshotId: "repo-snap-1",
					repoSnapshotStatus: "ready",
					repoSnapshotProvider: null,
				}),
			],
		});
		expect(result).toBe("repo-snap-1");
	});

	it("returns null when repo is null", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [{ workspacePath: ".", repo: null }],
		});
		expect(result).toBeNull();
	});

	it("returns null when configurationRepos is empty", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [],
		});
		expect(result).toBeNull();
	});

	it("configuration snapshot takes priority over repo snapshot", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: "config-snap",
			sandboxProvider: "e2b",
			configurationRepos: [makeRepo({ repoSnapshotId: "repo-snap", repoSnapshotStatus: "ready" })],
		});
		expect(result).toBe("config-snap");
	});
});

describe("full layering precedence", () => {
	// The complete 4-layer resolution chain:
	// 1. Configuration snapshot (resolveSnapshotId returns configurationSnapshotId)
	// 2. Repo snapshot (resolveSnapshotId returns repoSnapshotId for Modal)
	// 3. Base snapshot (gateway resolves from DB → opts.baseSnapshotId → env var)
	// 4. Base image (provider fallback via ensureBaseImageInitialized)
	//
	// This function handles layers 1-2. Layers 3-4 are resolved by
	// session-creator.ts (DB lookup) and modal-libmodal.ts (provider fallback).

	it("configuration snapshot wins over all other layers", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: "config-snap",
			sandboxProvider: "modal",
			configurationRepos: [makeRepo({ repoSnapshotId: "repo-snap", repoSnapshotStatus: "ready" })],
		});
		expect(result).toBe("config-snap");
	});

	it("repo snapshot wins when no configuration snapshot exists", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [makeRepo({ repoSnapshotId: "repo-snap", repoSnapshotStatus: "ready" })],
		});
		expect(result).toBe("repo-snap");
	});

	it("returns null when no configuration or repo snapshot — base snapshot/image handled by gateway and provider", () => {
		// When resolveSnapshotId returns null, the gateway checks the DB for
		// a ready base snapshot (baseSnapshots.getReadySnapshotId) and passes
		// it as baseSnapshotId. The Modal provider then falls through:
		//   opts.baseSnapshotId → MODAL_BASE_SNAPSHOT_ID env → base image
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [makeRepo({ repoSnapshotId: null })],
		});
		expect(result).toBeNull();
	});

	it("returns null for non-Modal providers — only configuration snapshots apply", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "e2b",
			configurationRepos: [makeRepo({ repoSnapshotId: "repo-snap", repoSnapshotStatus: "ready" })],
		});
		expect(result).toBeNull();
	});
});
