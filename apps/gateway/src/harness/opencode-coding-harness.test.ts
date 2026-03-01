import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockAbortOpenCodeSession,
	mockCreateOpenCodeSession,
	mockFetchOpenCodeMessages,
	mockGetOpenCodeSession,
	mockListOpenCodeSessions,
} = vi.hoisted(() => ({
	mockAbortOpenCodeSession: vi.fn(),
	mockCreateOpenCodeSession: vi.fn(),
	mockFetchOpenCodeMessages: vi.fn(),
	mockGetOpenCodeSession: vi.fn(),
	mockListOpenCodeSessions: vi.fn(),
}));

vi.mock("../lib/opencode", () => ({
	abortOpenCodeSession: mockAbortOpenCodeSession,
	createOpenCodeSession: mockCreateOpenCodeSession,
	fetchOpenCodeMessages: mockFetchOpenCodeMessages,
	getOpenCodeSession: mockGetOpenCodeSession,
	listOpenCodeSessions: mockListOpenCodeSessions,
}));

const { OpenCodeCodingHarnessAdapter } = await import("./opencode-coding-harness");

describe("OpenCodeCodingHarnessAdapter resume", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateOpenCodeSession.mockResolvedValue("new-session-id");
		mockListOpenCodeSessions.mockResolvedValue([]);
	});

	it("reuses current session when lookup confirms it exists", async () => {
		mockGetOpenCodeSession.mockResolvedValue(true);
		const adapter = new OpenCodeCodingHarnessAdapter();

		const result = await adapter.resume({
			baseUrl: "http://sandbox:4096",
			sessionId: "session-1",
			title: "Task",
		});

		expect(result).toEqual({ sessionId: "session-1", mode: "reused" });
		expect(mockListOpenCodeSessions).not.toHaveBeenCalled();
	});

	it("reuses current session on transient lookup failures", async () => {
		mockGetOpenCodeSession.mockRejectedValue(new Error("fetch failed"));
		const adapter = new OpenCodeCodingHarnessAdapter();

		const result = await adapter.resume({
			baseUrl: "http://sandbox:4096",
			sessionId: "session-1",
			title: "Task",
		});

		expect(result).toEqual({ sessionId: "session-1", mode: "reused" });
		expect(mockListOpenCodeSessions).not.toHaveBeenCalled();
	});

	it("throws non-transient lookup failures", async () => {
		mockGetOpenCodeSession.mockRejectedValue(new Error("lookup failed: 401 unauthorized"));
		const adapter = new OpenCodeCodingHarnessAdapter();

		await expect(
			adapter.resume({
				baseUrl: "http://sandbox:4096",
				sessionId: "session-1",
				title: "Task",
			}),
		).rejects.toThrow("lookup failed: 401 unauthorized");
		expect(mockListOpenCodeSessions).not.toHaveBeenCalled();
	});
});
