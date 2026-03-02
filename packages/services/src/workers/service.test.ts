import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockFindWorkerById,
	mockTransitionWorkerStatus,
	mockFindWorkerRunById,
	mockTransitionWorkerRunStatus,
	mockAppendWorkerRunEventAtomic,
	mockTransitionWorkerRunWithTerminalEvent,
	mockCreateWakeEvent,
} = vi.hoisted(() => ({
	mockFindWorkerById: vi.fn(),
	mockTransitionWorkerStatus: vi.fn(),
	mockFindWorkerRunById: vi.fn(),
	mockTransitionWorkerRunStatus: vi.fn(),
	mockAppendWorkerRunEventAtomic: vi.fn(),
	mockTransitionWorkerRunWithTerminalEvent: vi.fn(),
	mockCreateWakeEvent: vi.fn(),
}));

vi.mock("./db", () => ({
	findWorkerById: mockFindWorkerById,
	transitionWorkerStatus: mockTransitionWorkerStatus,
	findWorkerRunById: mockFindWorkerRunById,
	transitionWorkerRunStatus: mockTransitionWorkerRunStatus,
	appendWorkerRunEventAtomic: mockAppendWorkerRunEventAtomic,
	transitionWorkerRunWithTerminalEvent: mockTransitionWorkerRunWithTerminalEvent,
	listEventsByRun: vi.fn(),
	withTransaction: vi.fn(),
	findWorkerForClaim: vi.fn(),
	hasActiveWorkerRun: vi.fn(),
	claimNextQueuedWakeEvent: vi.fn(),
	fetchWakeEventRow: vi.fn(),
	findQueuedWakesBySource: vi.fn(),
	bulkCoalesceWakeEvents: vi.fn(),
	updateWakeEventPayload: vi.fn(),
	insertWorkerRun: vi.fn(),
	consumeWakeEvent: vi.fn(),
	touchWorkerLastWake: vi.fn(),
	insertWakeStartedEvent: vi.fn(),
	COALESCEABLE_WAKE_SOURCES: ["tick", "webhook"],
}));

vi.mock("../wakes/mapper", () => ({
	extractWakeDedupeKey: vi.fn(),
	buildMergedWakePayload: vi.fn(),
}));

vi.mock("../wakes/db", () => ({
	createWakeEvent: mockCreateWakeEvent,
}));

const {
	WorkerNotActiveError,
	WorkerResumeRequiredError,
	WorkerRunTransitionError,
	pauseWorker,
	runNow,
	startWorkerRun,
	completeWorkerRun,
	appendWorkerRunEvent,
} = await import("./service");

function makeWorker(overrides: Record<string, unknown> = {}) {
	return {
		id: "worker-1",
		organizationId: "org-1",
		name: "Worker One",
		status: "active",
		managerSessionId: "session-manager-1",
		objective: null,
		modelId: null,
		computeProfile: null,
		lastWakeAt: null,
		lastCompletedRunAt: null,
		lastErrorCode: null,
		pausedAt: null,
		pausedBy: null,
		createdBy: "user-1",
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

function makeWorkerRun(overrides: Record<string, unknown> = {}) {
	return {
		id: "run-1",
		workerId: "worker-1",
		organizationId: "org-1",
		managerSessionId: "session-manager-1",
		wakeEventId: "wake-1",
		status: "queued",
		summary: null,
		createdAt: new Date(),
		startedAt: null,
		completedAt: null,
		...overrides,
	};
}

describe("workers service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("pauses active workers", async () => {
		mockFindWorkerById.mockResolvedValue(makeWorker({ status: "active" }));
		mockTransitionWorkerStatus.mockResolvedValue(makeWorker({ status: "paused" }));

		const updated = await pauseWorker("worker-1", "org-1", "user-1");

		expect(updated.status).toBe("paused");
		expect(mockTransitionWorkerStatus).toHaveBeenCalledWith(
			"worker-1",
			"org-1",
			["active"],
			"paused",
			expect.objectContaining({
				pausedBy: "user-1",
				pausedAt: expect.any(Date),
			}),
		);
	});

	it("runNow returns resume_required for paused workers", async () => {
		mockFindWorkerById.mockResolvedValue(makeWorker({ status: "paused" }));

		await expect(runNow("worker-1", "org-1")).rejects.toBeInstanceOf(WorkerResumeRequiredError);
		expect(mockCreateWakeEvent).not.toHaveBeenCalled();
	});

	it("runNow queues manual wake for active workers", async () => {
		mockFindWorkerById.mockResolvedValue(makeWorker({ status: "active" }));
		mockCreateWakeEvent.mockResolvedValue({
			id: "wake-1",
			workerId: "worker-1",
			organizationId: "org-1",
			source: "manual",
			status: "queued",
			payloadJson: { note: "run now" },
			coalescedIntoWakeEventId: null,
			createdAt: new Date(),
			claimedAt: null,
			consumedAt: null,
			failedAt: null,
		});

		const result = await runNow("worker-1", "org-1", { note: "run now" });

		expect(result.status).toBe("queued");
		expect(result.wakeEvent.source).toBe("manual");
		expect(mockCreateWakeEvent).toHaveBeenCalledWith({
			workerId: "worker-1",
			organizationId: "org-1",
			source: "manual",
			payloadJson: { note: "run now" },
		});
	});

	it("rejects invalid run transition completed -> running", async () => {
		mockFindWorkerRunById.mockResolvedValue(makeWorkerRun({ status: "completed" }));

		await expect(startWorkerRun("run-1", "org-1")).rejects.toBeInstanceOf(WorkerRunTransitionError);
		expect(mockTransitionWorkerRunStatus).not.toHaveBeenCalled();
	});

	it("completes running worker run and writes wake_completed event", async () => {
		mockFindWorkerRunById.mockResolvedValue(makeWorkerRun({ status: "running" }));
		mockTransitionWorkerRunWithTerminalEvent.mockResolvedValue({
			workerRun: makeWorkerRun({ status: "completed" }),
			event: {
				id: "event-1",
				workerRunId: "run-1",
				workerId: "worker-1",
				eventIndex: 1,
				eventType: "wake_completed",
				summaryText: "done",
				payloadJson: { result: "completed" },
				payloadVersion: 1,
				sessionId: null,
				actionInvocationId: null,
				dedupeKey: null,
				createdAt: new Date(),
			},
		});

		const result = await completeWorkerRun({
			workerRunId: "run-1",
			organizationId: "org-1",
			summary: "done",
			result: "completed",
		});

		expect(result.status).toBe("completed");
		expect(mockTransitionWorkerRunWithTerminalEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				workerRunId: "run-1",
				toStatus: "completed",
				eventType: "wake_completed",
			}),
		);
	});

	it("appendWorkerRunEvent reuses deduped event when dedupeKey exists", async () => {
		const existing = {
			id: "event-existing",
			workerRunId: "run-1",
			workerId: "worker-1",
			eventIndex: 2,
			eventType: "manager_note",
			summaryText: null,
			payloadJson: null,
			payloadVersion: 1,
			sessionId: null,
			actionInvocationId: null,
			dedupeKey: "note-1",
			createdAt: new Date(),
		};
		mockAppendWorkerRunEventAtomic.mockResolvedValue(existing);

		const row = await appendWorkerRunEvent({
			workerRunId: "run-1",
			workerId: "worker-1",
			eventType: "manager_note",
			dedupeKey: "note-1",
		});

		expect(row.id).toBe("event-existing");
		expect(mockAppendWorkerRunEventAtomic).toHaveBeenCalledWith(
			expect.objectContaining({
				workerRunId: "run-1",
				dedupeKey: "note-1",
			}),
		);
	});

	it("runNow rejects degraded worker as not active", async () => {
		mockFindWorkerById.mockResolvedValue(makeWorker({ status: "degraded" }));

		await expect(runNow("worker-1", "org-1")).rejects.toBeInstanceOf(WorkerNotActiveError);
		expect(mockCreateWakeEvent).not.toHaveBeenCalled();
	});
});
