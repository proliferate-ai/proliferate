import { describe, expect, it } from "vitest";
import { type BlockedFlatRow, groupBlockedRows } from "./db";

describe("groupBlockedRows", () => {
	it("returns empty array for empty input", () => {
		expect(groupBlockedRows([])).toEqual([]);
	});

	it("groups rows by block_reason with correct counts", () => {
		const rows: BlockedFlatRow[] = [
			{
				block_reason: "credit_limit",
				count: 5,
				id: "s1",
				title: "Session 1",
				initial_prompt: "Fix the login bug",
				started_at: "2026-02-18T10:00:00Z",
				paused_at: "2026-02-18T11:00:00Z",
			},
			{
				block_reason: "credit_limit",
				count: 5,
				id: "s2",
				title: "Session 2",
				initial_prompt: null,
				started_at: "2026-02-18T09:00:00Z",
				paused_at: null,
			},
			{
				block_reason: "payment_failed",
				count: 2,
				id: "s3",
				title: null,
				initial_prompt: "Deploy the widget",
				started_at: null,
				paused_at: "2026-02-18T12:00:00Z",
			},
		];

		const result = groupBlockedRows(rows);

		expect(result).toHaveLength(2);

		// First group: credit_limit
		expect(result[0].reason).toBe("credit_limit");
		expect(result[0].count).toBe(5);
		expect(result[0].previewSessions).toHaveLength(2);
		expect(result[0].previewSessions[0].id).toBe("s1");
		expect(result[0].previewSessions[0].title).toBe("Session 1");
		expect(result[0].previewSessions[0].initialPrompt).toBe("Fix the login bug");
		expect(result[0].previewSessions[0].startedAt).toEqual(new Date("2026-02-18T10:00:00Z"));
		expect(result[0].previewSessions[0].pausedAt).toEqual(new Date("2026-02-18T11:00:00Z"));

		// Second session in first group
		expect(result[0].previewSessions[1].id).toBe("s2");
		expect(result[0].previewSessions[1].pausedAt).toBeNull();

		// Second group: payment_failed
		expect(result[1].reason).toBe("payment_failed");
		expect(result[1].count).toBe(2);
		expect(result[1].previewSessions).toHaveLength(1);
	});

	it("skips preview sessions with null id (count-only rows)", () => {
		const rows: BlockedFlatRow[] = [
			{
				block_reason: "suspended",
				count: 1,
				id: null,
				title: null,
				initial_prompt: null,
				started_at: null,
				paused_at: null,
			},
		];

		const result = groupBlockedRows(rows);

		expect(result).toHaveLength(1);
		expect(result[0].reason).toBe("suspended");
		expect(result[0].count).toBe(1);
		expect(result[0].previewSessions).toHaveLength(0);
	});

	it("preserves insertion order (matches SQL ORDER BY)", () => {
		const rows: BlockedFlatRow[] = [
			{
				block_reason: "overage_cap",
				count: 10,
				id: "a",
				title: null,
				initial_prompt: null,
				started_at: null,
				paused_at: null,
			},
			{
				block_reason: "overage_cap",
				count: 10,
				id: "b",
				title: null,
				initial_prompt: null,
				started_at: null,
				paused_at: null,
			},
			{
				block_reason: "credit_limit",
				count: 3,
				id: "c",
				title: null,
				initial_prompt: null,
				started_at: null,
				paused_at: null,
			},
		];

		const result = groupBlockedRows(rows);

		expect(result[0].reason).toBe("overage_cap");
		expect(result[1].reason).toBe("credit_limit");
		expect(result[0].previewSessions.map((s) => s.id)).toEqual(["a", "b"]);
	});
});
