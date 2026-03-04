import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockAbortOpenCodeSession,
	mockCreateOpenCodeSession,
	mockFetchOpenCodeMessages,
	mockGetOpenCodeSession,
	mockListOpenCodeSessions,
	mockMapOpenCodeMessages,
	mockSendPromptAsync,
} = vi.hoisted(() => ({
	mockAbortOpenCodeSession: vi.fn(),
	mockCreateOpenCodeSession: vi.fn(),
	mockFetchOpenCodeMessages: vi.fn(),
	mockGetOpenCodeSession: vi.fn(),
	mockListOpenCodeSessions: vi.fn(),
	mockMapOpenCodeMessages: vi.fn(),
	mockSendPromptAsync: vi.fn(),
}));

vi.mock("./coding/opencode/client", () => ({
	abortOpenCodeSession: mockAbortOpenCodeSession,
	createOpenCodeSession: mockCreateOpenCodeSession,
	fetchOpenCodeMessages: mockFetchOpenCodeMessages,
	getOpenCodeSession: mockGetOpenCodeSession,
	listOpenCodeSessions: mockListOpenCodeSessions,
	mapOpenCodeMessages: mockMapOpenCodeMessages,
	sendPromptAsync: mockSendPromptAsync,
}));

const { OpenCodeCodingHarnessAdapter } = await import("./coding/opencode/adapter");

describe("OpenCodeCodingHarnessAdapter resume", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateOpenCodeSession.mockResolvedValue("new-session-id");
		mockListOpenCodeSessions.mockResolvedValue([]);
		mockMapOpenCodeMessages.mockReturnValue([]);
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

	it("sends prompts through the adapter boundary", async () => {
		const adapter = new OpenCodeCodingHarnessAdapter();

		await adapter.sendPrompt({
			baseUrl: "http://sandbox:4096",
			sessionId: "session-1",
			content: "ship it",
			images: [{ data: "abc", mediaType: "image/png" }],
		});

		expect(mockSendPromptAsync).toHaveBeenCalledWith(
			"http://sandbox:4096",
			"session-1",
			"ship it",
			[{ data: "abc", mediaType: "image/png" }],
		);
	});

	it("collects and maps harness outputs", async () => {
		const rawMessages = [{ info: { id: "m1" }, parts: [] }];
		mockFetchOpenCodeMessages.mockResolvedValue(rawMessages);
		mockMapOpenCodeMessages.mockReturnValue([
			{
				id: "m1",
				role: "assistant",
				content: "done",
				isComplete: true,
				createdAt: Date.now(),
				parts: [{ type: "text", text: "done" }],
			},
		]);

		const adapter = new OpenCodeCodingHarnessAdapter();
		const result = await adapter.collectOutputs({
			baseUrl: "http://sandbox:4096",
			sessionId: "session-1",
		});

		expect(mockFetchOpenCodeMessages).toHaveBeenCalledWith("http://sandbox:4096", "session-1");
		expect(mockMapOpenCodeMessages).toHaveBeenCalledWith(rawMessages);
		expect(result.messages).toHaveLength(1);
	});
});
