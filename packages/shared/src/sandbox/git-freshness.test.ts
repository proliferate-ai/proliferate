import { describe, expect, it } from "vitest";
import { type ShouldPullOpts, shouldPullOnRestore } from "./git-freshness";

const base: ShouldPullOpts = {
	enabled: true,
	hasSnapshot: true,
	repoCount: 1,
	cadenceSeconds: 0,
	lastGitFetchAt: undefined,
	now: 1_000_000,
};

describe("shouldPullOnRestore", () => {
	// ── Run cases ──────────────────────────────────────────────────────
	it("returns true when enabled, has snapshot, repos > 0, cadence 0 (always)", () => {
		expect(shouldPullOnRestore(base)).toBe(true);
	});

	it("returns true when cadence is 0 regardless of lastGitFetchAt", () => {
		expect(shouldPullOnRestore({ ...base, lastGitFetchAt: base.now })).toBe(true);
	});

	it("returns true when cadence elapsed", () => {
		expect(
			shouldPullOnRestore({
				...base,
				cadenceSeconds: 60,
				lastGitFetchAt: base.now! - 61_000, // 61 seconds ago
			}),
		).toBe(true);
	});

	it("returns true when lastGitFetchAt is missing (legacy snapshot)", () => {
		expect(
			shouldPullOnRestore({
				...base,
				cadenceSeconds: 3600,
				lastGitFetchAt: undefined,
			}),
		).toBe(true);
	});

	it("returns true with multiple repos", () => {
		expect(shouldPullOnRestore({ ...base, repoCount: 3 })).toBe(true);
	});

	// ── Skip cases ─────────────────────────────────────────────────────
	it("returns false when disabled", () => {
		expect(shouldPullOnRestore({ ...base, enabled: false })).toBe(false);
	});

	it("returns false when no snapshot", () => {
		expect(shouldPullOnRestore({ ...base, hasSnapshot: false })).toBe(false);
	});

	it("returns false when no repos", () => {
		expect(shouldPullOnRestore({ ...base, repoCount: 0 })).toBe(false);
	});

	it("returns false when cadence has not elapsed", () => {
		expect(
			shouldPullOnRestore({
				...base,
				cadenceSeconds: 3600,
				lastGitFetchAt: base.now! - 1800_000, // 30 min ago, cadence is 1h
			}),
		).toBe(false);
	});

	it("returns false at exact cadence boundary", () => {
		expect(
			shouldPullOnRestore({
				...base,
				cadenceSeconds: 60,
				lastGitFetchAt: base.now! - 60_000, // exactly 60s ago
			}),
		).toBe(false);
	});

	// ── Edge cases ─────────────────────────────────────────────────────
	it("returns false when all preconditions fail", () => {
		expect(
			shouldPullOnRestore({
				enabled: false,
				hasSnapshot: false,
				repoCount: 0,
				cadenceSeconds: 0,
			}),
		).toBe(false);
	});

	it("uses Date.now() when now is not provided", () => {
		// With cadenceSeconds > 0 and a very old lastGitFetchAt, should pull
		const result = shouldPullOnRestore({
			enabled: true,
			hasSnapshot: true,
			repoCount: 1,
			cadenceSeconds: 1,
			lastGitFetchAt: 0, // epoch — definitely older than 1 second
		});
		expect(result).toBe(true);
	});
});
