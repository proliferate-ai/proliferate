import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mocks (vi.hoisted ensures availability before vi.mock factories)
// ============================================

const {
	mockMessagesCreate,
	mockFindActiveRunByWorker,
	mockFindWorkerById,
	mockStartWorkerRun,
	mockCompleteWorkerRun,
	mockFailWorkerRun,
	mockAppendWorkerRunEvent,
	mockListWorkerRunEvents,
	mockFindWakeEventById,
	mockFindSessionById,
	mockCreateUnifiedTaskSession,
	mockListChildSessionsByRun,
	mockLogger,
	mockFetch,
} = vi.hoisted(() => {
	const logger: Record<string, unknown> = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	};
	logger.child = () => logger;
	return {
		mockMessagesCreate: vi.fn(),
		mockFindActiveRunByWorker: vi.fn(),
		mockFindWorkerById: vi.fn(),
		mockStartWorkerRun: vi.fn(),
		mockCompleteWorkerRun: vi.fn(),
		mockFailWorkerRun: vi.fn(),
		mockAppendWorkerRunEvent: vi.fn(),
		mockListWorkerRunEvents: vi.fn(),
		mockFindWakeEventById: vi.fn(),
		mockFindSessionById: vi.fn(),
		mockCreateUnifiedTaskSession: vi.fn(),
		mockListChildSessionsByRun: vi.fn(),
		mockLogger: logger,
		mockFetch: vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({}),
			text: async () => "",
		}),
	};
});

vi.mock("@anthropic-ai/sdk", () => {
	const RateLimitError = class extends Error {
		status = 429;
	};
	const InternalServerError = class extends Error {
		status = 500;
	};
	const APIError = class extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	};

	return {
		default: class MockAnthropic {
			static RateLimitError = RateLimitError;
			static InternalServerError = InternalServerError;
			static APIError = APIError;
			messages = { create: mockMessagesCreate };
		},
		RateLimitError,
		InternalServerError,
		APIError,
	};
});

vi.mock("@proliferate/services", () => ({
	workers: {
		findActiveRunByWorker: mockFindActiveRunByWorker,
		findWorkerById: mockFindWorkerById,
		startWorkerRun: mockStartWorkerRun,
		completeWorkerRun: mockCompleteWorkerRun,
		failWorkerRun: mockFailWorkerRun,
		appendWorkerRunEvent: mockAppendWorkerRunEvent,
		listWorkerRunEvents: mockListWorkerRunEvents,
	},
	wakes: {
		findWakeEventById: mockFindWakeEventById,
	},
	sessions: {
		findSessionById: mockFindSessionById,
		createUnifiedTaskSession: mockCreateUnifiedTaskSession,
		listChildSessionsByRun: mockListChildSessionsByRun,
	},
}));

vi.mock("@proliferate/logger", () => ({
	createLogger: () => ({
		child: () => mockLogger,
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

vi.stubGlobal("fetch", mockFetch);

import { ClaudeManagerHarnessAdapter } from "./manager-claude-harness";

// ============================================
// Helpers
// ============================================

const baseInput = {
	managerSessionId: "mgr-session-1",
	organizationId: "org-1",
	workerId: "worker-1",
	gatewayUrl: "http://localhost:3100",
	serviceToken: "test-token",
	anthropicApiKey: "test-key",
};

const baseRun = {
	id: "run-1",
	workerId: "worker-1",
	organizationId: "org-1",
	managerSessionId: "mgr-session-1",
	wakeEventId: "wake-1",
	status: "queued" as const,
	summary: null,
	createdAt: new Date(),
	startedAt: null,
	completedAt: null,
};

const baseWakeEvent = {
	id: "wake-1",
	workerId: "worker-1",
	organizationId: "org-1",
	source: "tick" as const,
	status: "consumed" as const,
	coalescedIntoWakeEventId: null,
	payloadJson: { type: "scheduled_tick" },
	createdAt: new Date(),
	claimedAt: new Date(),
	consumedAt: new Date(),
	failedAt: null,
};

const baseWorker = {
	id: "worker-1",
	organizationId: "org-1",
	name: "Test Coworker",
	objective: "Monitor and fix Sentry issues",
	managerSessionId: "mgr-session-1",
	status: "active" as const,
	modelId: null,
	computeProfile: null,
	createdBy: null,
	lastWakeAt: null,
	lastCompletedRunAt: null,
	lastErrorCode: null,
	pausedAt: null,
	pausedBy: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

function makeClaudeResponse(content: Array<{ type: string; [key: string]: unknown }>): {
	id: string;
	content: typeof content;
	stop_reason: string;
	model: string;
	role: string;
	type: string;
	usage: { input_tokens: number; output_tokens: number };
} {
	return {
		id: "msg-1",
		content,
		stop_reason: "end_turn",
		model: "claude-sonnet-4-5-20250929",
		role: "assistant",
		type: "message",
		usage: { input_tokens: 100, output_tokens: 50 },
	};
}

function setupCommonMocks(): void {
	mockFindActiveRunByWorker.mockResolvedValue(baseRun);
	mockFindWakeEventById.mockResolvedValue(baseWakeEvent);
	mockFindWorkerById.mockResolvedValue(baseWorker);
	mockStartWorkerRun.mockResolvedValue({ ...baseRun, status: "running" });
	mockCompleteWorkerRun.mockResolvedValue({ ...baseRun, status: "completed" });
	mockFailWorkerRun.mockResolvedValue({ ...baseRun, status: "failed" });
	mockAppendWorkerRunEvent.mockResolvedValue({ id: "event-1" });
	mockListWorkerRunEvents.mockResolvedValue([]);
	mockListChildSessionsByRun.mockResolvedValue([]);
}

/** Wait for async wake cycle to complete (background promise). */
async function waitForCycle(): Promise<void> {
	// The wake cycle runs asynchronously after start().
	// Give it time to execute all phases.
	await new Promise((resolve) => setTimeout(resolve, 100));
}

// ============================================
// Tests
// ============================================

describe("ClaudeManagerHarnessAdapter", () => {
	let harness: ClaudeManagerHarnessAdapter;

	beforeEach(() => {
		vi.clearAllMocks();
		harness = new ClaudeManagerHarnessAdapter(mockLogger as never);
	});

	describe("start()", () => {
		it("returns running state immediately", async () => {
			setupCommonMocks();
			mockMessagesCreate.mockResolvedValue(
				makeClaudeResponse([{ type: "text", text: "No action needed" }]),
			);

			const state = await harness.start(baseInput);
			expect(state.status).toBe("running");
			expect(state.managerSessionId).toBe("mgr-session-1");
		});

		it("does nothing when no worker ID", async () => {
			const state = await harness.start({ ...baseInput, workerId: null });
			expect(state.status).toBe("running");
			await waitForCycle();
			expect(mockFindActiveRunByWorker).not.toHaveBeenCalled();
		});

		it("does nothing when no active run", async () => {
			mockFindActiveRunByWorker.mockResolvedValue(undefined);
			await harness.start(baseInput);
			await waitForCycle();
			expect(mockStartWorkerRun).not.toHaveBeenCalled();
		});
	});

	describe("Flow 1: Wake → Triage (skip) → Finalize", () => {
		it("skips run when Claude calls skip_run", async () => {
			setupCommonMocks();

			// Claude decides to skip
			mockMessagesCreate.mockResolvedValue(
				makeClaudeResponse([
					{
						type: "tool_use",
						id: "tool-1",
						name: "skip_run",
						input: { reason: "No new issues to triage" },
					},
				]),
			);

			await harness.start(baseInput);
			await waitForCycle();

			// Verify run was started and completed
			expect(mockStartWorkerRun).toHaveBeenCalledWith("run-1", "org-1");
			expect(mockCompleteWorkerRun).toHaveBeenCalledWith(
				expect.objectContaining({
					workerRunId: "run-1",
					organizationId: "org-1",
					result: "skipped",
				}),
			);

			// Verify triage event was emitted
			expect(mockAppendWorkerRunEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: "triage_summary",
					payloadJson: expect.objectContaining({ decision: "skip" }),
				}),
			);
		});
	});

	describe("Flow 2: Wake → Triage (act) → Orchestrate → Finalize", () => {
		it("spawns child task and completes", async () => {
			setupCommonMocks();

			const childSession = {
				id: "child-1",
				title: "Fix issue #42",
				status: "starting",
				runtimeStatus: "starting",
				operatorStatus: "active",
				outcome: null,
				summary: null,
			};
			mockCreateUnifiedTaskSession.mockResolvedValue(childSession);
			mockFindSessionById.mockImplementation(async (id: string) => {
				if (id === "mgr-session-1") {
					return {
						id: "mgr-session-1",
						repoId: "repo-1",
						repoBaselineId: "baseline-1",
						repoBaselineTargetId: "target-1",
						configurationId: "config-1",
						visibility: "private",
						createdBy: "user-1",
					};
				}
				if (id === "child-1") {
					return { ...childSession, outcome: "completed", status: "stopped" };
				}
				return undefined;
			});

			let callCount = 0;
			mockMessagesCreate.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					// Triage: decide to act (no tool calls = proceed to orchestrate)
					return makeClaudeResponse([
						{ type: "text", text: "I need to fix the Sentry issue. Let me spawn a task." },
					]);
				}
				if (callCount === 2) {
					// Orchestrate: spawn child
					return makeClaudeResponse([
						{
							type: "tool_use",
							id: "tool-spawn",
							name: "spawn_child_task",
							input: { title: "Fix issue #42", instructions: "Fix the NPE in auth module" },
						},
					]);
				}
				if (callCount === 3) {
					// Orchestrate: complete
					return makeClaudeResponse([
						{
							type: "tool_use",
							id: "tool-complete",
							name: "complete_run",
							input: { summary: "Spawned task to fix issue #42" },
						},
					]);
				}
				return makeClaudeResponse([{ type: "text", text: "Done" }]);
			});

			await harness.start(baseInput);
			await waitForCycle();

			// Verify task was spawned
			expect(mockCreateUnifiedTaskSession).toHaveBeenCalledWith(
				expect.objectContaining({
					title: "Fix issue #42",
					parentSessionId: "mgr-session-1",
					workerId: "worker-1",
				}),
			);

			// Verify task_spawned event
			expect(mockAppendWorkerRunEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: "task_spawned",
					summaryText: "Fix issue #42",
				}),
			);

			// Verify run completed
			expect(mockCompleteWorkerRun).toHaveBeenCalledWith(
				expect.objectContaining({
					workerRunId: "run-1",
					result: "completed",
				}),
			);
		});
	});

	describe("Flow 3: Wake → Triage (escalate) → Finalize", () => {
		it("escalates via send_notification", async () => {
			setupCommonMocks();

			mockMessagesCreate.mockResolvedValue(
				makeClaudeResponse([
					{
						type: "tool_use",
						id: "tool-notify",
						name: "send_notification",
						input: { message: "Critical issue needs human review", severity: "error" },
					},
				]),
			);

			await harness.start(baseInput);
			await waitForCycle();

			// Verify notification event emitted
			expect(mockAppendWorkerRunEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: "manager_note",
					payloadJson: expect.objectContaining({ severity: "error", type: "notification" }),
				}),
			);

			// Verify run completed as escalated
			expect(mockCompleteWorkerRun).toHaveBeenCalledWith(
				expect.objectContaining({
					result: "escalated",
				}),
			);
		});
	});

	describe("Flow 4: Interruption mid-orchestrate", () => {
		it("fails run when interrupted", async () => {
			setupCommonMocks();

			let callCount = 0;
			mockMessagesCreate.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					// Triage: act
					return makeClaudeResponse([{ type: "text", text: "I will spawn tasks." }]);
				}
				// Orchestrate: simulate delay then interrupt
				await harness.interrupt();
				throw new Error("Wake cycle aborted");
			});

			await harness.start(baseInput);
			await waitForCycle();

			// Verify run failed as interrupted
			expect(mockFailWorkerRun).toHaveBeenCalledWith(
				expect.objectContaining({
					workerRunId: "run-1",
					errorCode: expect.any(String),
				}),
			);
		});
	});

	describe("Flow 5: Budget exhaustion", () => {
		it("fails run with budget_exhausted when API returns 402", async () => {
			setupCommonMocks();

			const Anthropic = (await import("@anthropic-ai/sdk")).default;
			mockMessagesCreate.mockRejectedValue(
				new (
					Anthropic as unknown as { APIError: new (status: number, message: string) => Error }
				).APIError(402, "Budget exceeded"),
			);

			await harness.start(baseInput);
			await waitForCycle();

			expect(mockFailWorkerRun).toHaveBeenCalledWith(
				expect.objectContaining({
					workerRunId: "run-1",
					errorCode: "BUDGET_EXHAUSTED",
				}),
			);
		});
	});

	describe("interrupt()", () => {
		it("returns interrupted state", async () => {
			setupCommonMocks();
			mockMessagesCreate.mockResolvedValue(makeClaudeResponse([{ type: "text", text: "test" }]));
			await harness.start(baseInput);
			const state = await harness.interrupt();
			expect(state.status).toBe("interrupted");
		});
	});

	describe("shutdown()", () => {
		it("returns stopped state and cleans up", async () => {
			const state = await harness.shutdown();
			expect(state.status).toBe("stopped");
		});
	});
});
