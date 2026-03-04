import { sessions } from "@proliferate/services";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	persistTerminalOutcome,
	projectOperatorStatus,
	recordLifecycleEvent,
	touchLastVisibleUpdate,
} from "./session/session-lifecycle";

vi.mock("@proliferate/services", () => ({
	sessions: {
		findByIdInternal: vi.fn(async () => null),
		persistTerminalTaskOutcome: vi.fn(async () => ({
			outcomeJson: {},
			outcomeVersion: 1,
			outcomePersistedAt: new Date(),
		})),
		recordSessionEvent: vi.fn(async () => undefined),
		updateLastVisibleUpdateAt: vi.fn(async () => undefined),
		updateSessionOperatorStatus: vi.fn(async () => undefined),
	},
}));

const mockLogger: Record<string, ReturnType<typeof vi.fn>> = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	child: vi.fn(() => mockLogger),
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("projectOperatorStatus", () => {
	it("maps completed runtime to ready_for_review", async () => {
		const result = await projectOperatorStatus({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "completed",
			hasPendingApproval: false,
			logger: mockLogger as never,
		});
		expect(result).toBe("ready_for_review");
	});

	it("maps cancelled runtime to ready_for_review", async () => {
		const result = await projectOperatorStatus({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "cancelled",
			hasPendingApproval: false,
			logger: mockLogger as never,
		});
		expect(result).toBe("ready_for_review");
	});

	it("maps failed runtime to errored", async () => {
		const result = await projectOperatorStatus({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "failed",
			hasPendingApproval: false,
			logger: mockLogger as never,
		});
		expect(result).toBe("errored");
	});

	it("maps pending approval to waiting_for_approval", async () => {
		const result = await projectOperatorStatus({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "running",
			hasPendingApproval: true,
			logger: mockLogger as never,
		});
		expect(result).toBe("waiting_for_approval");
	});

	it("maps agent idle to needs_input", async () => {
		const result = await projectOperatorStatus({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "running",
			hasPendingApproval: false,
			isAgentIdle: true,
			logger: mockLogger as never,
		});
		expect(result).toBe("needs_input");
	});

	it("maps running non-idle to active", async () => {
		const result = await projectOperatorStatus({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "running",
			hasPendingApproval: false,
			isAgentIdle: false,
			logger: mockLogger as never,
		});
		expect(result).toBe("active");
	});

	it("pending approval takes priority over agent idle", async () => {
		const result = await projectOperatorStatus({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "running",
			hasPendingApproval: true,
			isAgentIdle: true,
			logger: mockLogger as never,
		});
		expect(result).toBe("waiting_for_approval");
	});

	it("persists operator status to DB", async () => {
		await projectOperatorStatus({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "running",
			hasPendingApproval: false,
			logger: mockLogger as never,
		});

		expect(sessions.updateSessionOperatorStatus).toHaveBeenCalledWith({
			sessionId: "s-1",
			organizationId: "org-1",
			operatorStatus: "active",
		});
	});

	it("swallows DB errors (best-effort)", async () => {
		vi.mocked(sessions.updateSessionOperatorStatus).mockRejectedValueOnce(new Error("DB down"));

		const result = await projectOperatorStatus({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "running",
			hasPendingApproval: false,
			logger: mockLogger as never,
		});

		expect(result).toBe("active");
	});
});

describe("persistTerminalOutcome", () => {
	it("enriches from session telemetry when no explicit prUrls/summary", async () => {
		vi.mocked(sessions.findByIdInternal).mockResolvedValueOnce({
			prUrls: ["https://github.com/org/repo/pull/42"],
			summary: "Added feature X",
		} as never);

		await persistTerminalOutcome({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "completed",
			logger: mockLogger as never,
		});

		expect(sessions.persistTerminalTaskOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "s-1",
				outcomeJson: expect.objectContaining({
					summary: "Added feature X",
					pullRequest: expect.objectContaining({
						url: "https://github.com/org/repo/pull/42",
					}),
				}),
			}),
		);
	});

	it("uses explicit prUrls over session telemetry", async () => {
		vi.mocked(sessions.findByIdInternal).mockResolvedValueOnce({
			prUrls: ["https://github.com/org/repo/pull/old"],
			summary: "Old summary",
		} as never);

		await persistTerminalOutcome({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "completed",
			prUrls: ["https://github.com/org/repo/pull/new"],
			summary: "New summary",
			logger: mockLogger as never,
		});

		expect(sessions.persistTerminalTaskOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				outcomeJson: expect.objectContaining({
					summary: "New summary",
					pullRequest: expect.objectContaining({
						url: "https://github.com/org/repo/pull/new",
					}),
				}),
			}),
		);
	});

	it("records lifecycle events on completion", async () => {
		vi.mocked(sessions.findByIdInternal).mockResolvedValueOnce({} as never);

		await persistTerminalOutcome({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "completed",
			logger: mockLogger as never,
		});

		expect(sessions.recordSessionEvent).toHaveBeenCalledWith({
			sessionId: "s-1",
			eventType: "session_completed",
		});
		expect(sessions.recordSessionEvent).toHaveBeenCalledWith({
			sessionId: "s-1",
			eventType: "session_outcome_persisted",
		});
	});

	it("records session_failed for failed runtime", async () => {
		vi.mocked(sessions.findByIdInternal).mockResolvedValueOnce({} as never);

		await persistTerminalOutcome({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "failed",
			errorMessage: "OOM",
			logger: mockLogger as never,
		});

		expect(sessions.recordSessionEvent).toHaveBeenCalledWith({
			sessionId: "s-1",
			eventType: "session_failed",
		});
	});

	it("swallows errors (best-effort persistence)", async () => {
		vi.mocked(sessions.findByIdInternal).mockRejectedValueOnce(new Error("DB down"));

		await persistTerminalOutcome({
			sessionId: "s-1",
			organizationId: "org-1",
			runtimeStatus: "completed",
			logger: mockLogger as never,
		});

		// Should not throw
		expect(mockLogger.warn).toHaveBeenCalled();
	});
});

describe("touchLastVisibleUpdate", () => {
	it("delegates to sessions.updateLastVisibleUpdateAt", async () => {
		await touchLastVisibleUpdate("s-1", mockLogger as never);
		expect(sessions.updateLastVisibleUpdateAt).toHaveBeenCalledWith("s-1");
	});

	it("swallows errors", async () => {
		vi.mocked(sessions.updateLastVisibleUpdateAt).mockRejectedValueOnce(new Error("fail"));
		await touchLastVisibleUpdate("s-1", mockLogger as never);
		expect(mockLogger.warn).toHaveBeenCalled();
	});
});

describe("recordLifecycleEvent", () => {
	it("delegates to sessions.recordSessionEvent", async () => {
		await recordLifecycleEvent("s-1", "session_started", mockLogger as never);
		expect(sessions.recordSessionEvent).toHaveBeenCalledWith({
			sessionId: "s-1",
			eventType: "session_started",
		});
	});

	it("swallows errors", async () => {
		vi.mocked(sessions.recordSessionEvent).mockRejectedValueOnce(new Error("fail"));
		await recordLifecycleEvent("s-1", "session_started", mockLogger as never);
		expect(mockLogger.warn).toHaveBeenCalled();
	});
});
