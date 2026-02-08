import { describe, expect, it } from "vitest";
import { type ResolveSnapshotInput, resolveSnapshotId } from "./snapshot-resolution";

function makeRepo(
	overrides: {
		workspacePath?: string;
		repoSnapshotId?: string | null;
		repoSnapshotStatus?: string | null;
		repoSnapshotProvider?: string | null;
	} = {},
): ResolveSnapshotInput["prebuildRepos"][number] {
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
			prebuildSnapshotId: "prebuild-snap-1",
			sandboxProvider: "modal",
			prebuildRepos: [makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "ready" })],
		});
		expect(result).toBe("prebuild-snap-1");
	});

	it("returns repo snapshot for Modal single-repo with workspacePath '.'", () => {
		const result = resolveSnapshotId({
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "ready" })],
		});
		expect(result).toBe("repo-snap-1");
	});

	it("returns null when sandboxProvider is null (unknown provider = no repo snapshot)", () => {
		const result = resolveSnapshotId({
			prebuildSnapshotId: null,
			sandboxProvider: null,
			prebuildRepos: [makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "ready" })],
		});
		expect(result).toBeNull();
	});

	it("returns null for E2B provider even with ready repo snapshot", () => {
		const result = resolveSnapshotId({
			prebuildSnapshotId: null,
			sandboxProvider: "e2b",
			prebuildRepos: [makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "ready" })],
		});
		expect(result).toBeNull();
	});

	it("returns null for multi-repo prebuilds", () => {
		const result = resolveSnapshotId({
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [
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
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [
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
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: "building" })],
		});
		expect(result).toBeNull();
	});

	it("returns null when repo snapshot status is null", () => {
		const result = resolveSnapshotId({
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [makeRepo({ repoSnapshotId: "repo-snap-1", repoSnapshotStatus: null })],
		});
		expect(result).toBeNull();
	});

	it("returns null when repo has no repoSnapshotId", () => {
		const result = resolveSnapshotId({
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [makeRepo({ repoSnapshotId: null, repoSnapshotStatus: "ready" })],
		});
		expect(result).toBeNull();
	});

	it("returns null when repo snapshot provider is non-Modal", () => {
		const result = resolveSnapshotId({
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [
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
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [
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
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [
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
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [{ workspacePath: ".", repo: null }],
		});
		expect(result).toBeNull();
	});

	it("returns null when prebuildRepos is empty", () => {
		const result = resolveSnapshotId({
			prebuildSnapshotId: null,
			sandboxProvider: "modal",
			prebuildRepos: [],
		});
		expect(result).toBeNull();
	});

	it("prebuild snapshot takes priority over repo snapshot", () => {
		const result = resolveSnapshotId({
			prebuildSnapshotId: "prebuild-snap",
			sandboxProvider: "e2b",
			prebuildRepos: [makeRepo({ repoSnapshotId: "repo-snap", repoSnapshotStatus: "ready" })],
		});
		expect(result).toBe("prebuild-snap");
	});
});
