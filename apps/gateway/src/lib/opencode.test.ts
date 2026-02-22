import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenCodeMessages } from "./opencode";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("fetchOpenCodeMessages", () => {
	it("uses a bounded timeout signal", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => [],
		});
		vi.stubGlobal("fetch", fetchMock);

		await fetchOpenCodeMessages("https://example.test", "session-1");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://example.test/session/session-1/message",
			expect.objectContaining({
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("throws on non-OK response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 503,
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchOpenCodeMessages("https://example.test", "session-1")).rejects.toThrow(
			"OpenCode messages fetch failed: 503",
		);
	});
});
