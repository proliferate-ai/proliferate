import { describe, expect, it } from "vitest";
import { resolveSnapshotId } from "./snapshot-resolution";

describe("resolveSnapshotId", () => {
	it("returns configuration snapshot when present", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: "config-snap-1",
			sandboxProvider: "modal",
			configurationRepos: [],
		});
		expect(result).toBe("config-snap-1");
	});

	it("returns null when no configuration snapshot exists", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "modal",
			configurationRepos: [],
		});
		expect(result).toBeNull();
	});

	it("returns null for E2B provider without configuration snapshot", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: null,
			sandboxProvider: "e2b",
			configurationRepos: [],
		});
		expect(result).toBeNull();
	});

	it("configuration snapshot applies regardless of provider", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: "config-snap",
			sandboxProvider: "e2b",
			configurationRepos: [],
		});
		expect(result).toBe("config-snap");
	});

	it("configuration snapshot applies when sandboxProvider is null", () => {
		const result = resolveSnapshotId({
			configurationSnapshotId: "config-snap",
			sandboxProvider: null,
			configurationRepos: [],
		});
		expect(result).toBe("config-snap");
	});
});
