import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockFindWorkerById,
	mockTransitionWorkerStatus,
	mockFindWorkerRunById,
	mockTransitionWorkerRunStatus,
	mockAppendWorkerRunEventAtomic,
	mockTransitionWorkerRunWithTerminalEvent,
	mockCreateWakeEvent,
	mockWithTransaction,
	mockCreateWorker,
	mockUpdateWorker,
	mockCreateManagerSessionPlaceholder,
	mockPromoteToManagerSession,
	mockUpsertSessionCapability,
} = vi.hoisted(() => ({
	mockFindWorkerById: vi.fn(),
	mockTransitionWorkerStatus: vi.fn(),
	mockFindWorkerRunById: vi.fn(),
	mockTransitionWorkerRunStatus: vi.fn(),
	mockAppendWorkerRunEventAtomic: vi.fn(),
	mockTransitionWorkerRunWithTerminalEvent: vi.fn(),
	mockCreateWakeEvent: vi.fn(),
	mockWithTransaction: vi.fn(),
	mockCreateWorker: vi.fn(),
	mockUpdateWorker: vi.fn(),
	mockCreateManagerSessionPlaceholder: vi.fn(),
	mockPromoteToManagerSession: vi.fn(),
	mockUpsertSessionCapability: vi.fn(),
}));

vi.mock("./db", () => ({
	findWorkerById: mockFindWorkerById,
	transitionWorkerStatus: mockTransitionWorkerStatus,
	findWorkerRunById: mockFindWorkerRunById,
	transitionWorkerRunStatus: mockTransitionWorkerRunStatus,
	appendWorkerRunEventAtomic: mockAppendWorkerRunEventAtomic,
	transitionWorkerRunWithTerminalEvent: mockTransitionWorkerRunWithTerminalEvent,
	listEventsByRun: vi.fn(),
	withTransaction: mockWithTransaction,
	createWorker: mockCreateWorker,
	updateWorker: mockUpdateWorker,
	findWorkerForClaim: vi.fn(),
	hasActiveWorkerRun: vi.fn(),
	claimNextQueuedWakeEvent: vi.fn(),
	fetchWakeEventRow: vi.fn(),
	findQueuedWakesBySource: vi.fn(),
	bulkCoalesceWakeEvents: vi.fn(),
	updateWakeEventPayload: vi.fn(),
	insertWorkerRun: vi.fn(),
	consumeWakeEvent: vi.fn(),
	insertWakeStartedEvent: vi.fn(),
	COALESCEABLE_WAKE_SOURCES: ["tick", "webhook"],
}));

vi.mock("../sessions/db", () => ({
	createManagerSessionPlaceholder: mockCreateManagerSessionPlaceholder,
	promoteToManagerSession: mockPromoteToManagerSession,
	upsertSessionCapability: mockUpsertSessionCapability,
	updateManagerSessionLinkage: vi.fn(),
	enqueueSessionMessage: vi.fn(),
	listSessionCapabilities: vi.fn(),
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
	pauseWorker,
	runNow,
	createWorkerWithManagerSession,
	updateWorkerForOrg,
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

describe("workers service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWithTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
	});

	it("pauses active workers", async () => {
		mockFindWorkerById.mockResolvedValue(makeWorker({ status: "active" }));
		mockTransitionWorkerStatus.mockResolvedValue(makeWorker({ status: "automations_paused" }));

		const updated = await pauseWorker("worker-1", "org-1", "user-1");

		expect(updated.status).toBe("automations_paused");
		expect(mockTransitionWorkerStatus).toHaveBeenCalledWith(
			"worker-1",
			"org-1",
			["active"],
			"automations_paused",
			expect.objectContaining({
				pausedBy: "user-1",
				pausedAt: expect.any(Date),
			}),
		);
	});

	it("runNow returns resume_required for paused workers", async () => {
		mockFindWorkerById.mockResolvedValue(makeWorker({ status: "automations_paused" }));

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

	it("runNow rejects degraded worker as not active", async () => {
		mockFindWorkerById.mockResolvedValue(makeWorker({ status: "degraded" }));

		await expect(runNow("worker-1", "org-1")).rejects.toBeInstanceOf(WorkerNotActiveError);
		expect(mockCreateWakeEvent).not.toHaveBeenCalled();
	});

	it("createWorkerWithManagerSession persists provided capabilities", async () => {
		mockCreateManagerSessionPlaceholder.mockResolvedValue({ id: "session-manager-1" });
		mockCreateWorker.mockResolvedValue(
			makeWorker({ id: "worker-2", managerSessionId: "session-manager-1" }),
		);
		mockPromoteToManagerSession.mockResolvedValue(undefined);

		await createWorkerWithManagerSession({
			organizationId: "org-1",
			createdBy: "user-1",
			name: "Ops Coworker",
			capabilities: [
				{ capabilityKey: "source.sentry.read", mode: "deny" },
				{ capabilityKey: "source.sentry.read", mode: "allow" },
				{ capabilityKey: "source.github.read", mode: "deny" },
			],
		});

		expect(mockUpsertSessionCapability).toHaveBeenCalledTimes(2);
		expect(mockUpsertSessionCapability).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-manager-1",
				capabilityKey: "source.sentry.read",
				mode: "allow",
			}),
		);
		expect(mockUpsertSessionCapability).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-manager-1",
				capabilityKey: "source.github.read",
				mode: "deny",
			}),
		);
	});

	it("updateWorkerForOrg upserts capabilities on manager session", async () => {
		mockUpdateWorker.mockResolvedValue(
			makeWorker({ id: "worker-3", managerSessionId: "session-manager-3" }),
		);

		await updateWorkerForOrg({
			workerId: "worker-3",
			organizationId: "org-1",
			fields: { systemPrompt: "Handle high priority bugs" },
			capabilities: [{ capabilityKey: "source.linear.read", mode: "deny" }],
		});

		expect(mockUpsertSessionCapability).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-manager-3",
				capabilityKey: "source.linear.read",
				mode: "deny",
			}),
		);
	});
});
