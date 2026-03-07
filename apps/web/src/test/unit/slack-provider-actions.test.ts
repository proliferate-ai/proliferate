import { getProviderActions } from "@proliferate/providers";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("slack provider actions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers list_channels and post_message actions", () => {
		const module = getProviderActions("slack");
		expect(module).toBeDefined();

		const actionIds = module?.actions.map((action) => action.id) ?? [];
		expect(actionIds).toContain("list_channels");
		expect(actionIds).toContain("post_message");
	});

	it("returns channel summaries for list_channels", async () => {
		const module = getProviderActions("slack");
		if (!module) {
			throw new Error("Slack provider module not found");
		}

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			json: async () => ({
				ok: true,
				channels: [
					{
						id: "C123",
						name: "engineering",
						is_private: false,
						is_archived: false,
					},
				],
				response_metadata: {
					next_cursor: "cursor-2",
				},
			}),
		} as Response);

		const result = await module.execute(
			"list_channels",
			{ limit: 50 },
			{
				token: "xoxb-test-token",
				orgId: "org_test",
				sessionId: "session_test",
			},
		);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0]?.[0]).toContain("conversations.list");
		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			channels: [
				{
					id: "C123",
					name: "engineering",
					is_private: false,
					is_archived: false,
				},
			],
			next_cursor: "cursor-2",
		});
	});

	it("returns structured error when Slack list_channels fails", async () => {
		const module = getProviderActions("slack");
		if (!module) {
			throw new Error("Slack provider module not found");
		}

		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			json: async () => ({
				ok: false,
				error: "missing_scope",
			}),
		} as Response);

		const result = await module.execute(
			"list_channels",
			{},
			{
				token: "xoxb-test-token",
				orgId: "org_test",
				sessionId: "session_test",
			},
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("missing_scope");
	});
});
