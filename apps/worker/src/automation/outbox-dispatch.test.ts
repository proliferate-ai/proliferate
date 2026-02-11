import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockClaimPendingOutbox,
	mockRecoverStuckOutbox,
	mockMarkDispatched,
	mockMarkFailed,
	mockDispatchRunNotification,
	mockQueueAutomationEnrich,
	mockQueueAutomationExecute,
} = vi.hoisted(() => ({
	mockClaimPendingOutbox: vi.fn(),
	mockRecoverStuckOutbox: vi.fn(),
	mockMarkDispatched: vi.fn(),
	mockMarkFailed: vi.fn(),
	mockDispatchRunNotification: vi.fn(),
	mockQueueAutomationEnrich: vi.fn(),
	mockQueueAutomationExecute: vi.fn(),
}));

vi.mock("@proliferate/environment/server", () => ({
	env: {
		NEXT_PUBLIC_GATEWAY_URL: "http://localhost:3001",
		SERVICE_TO_SERVICE_AUTH_TOKEN: "test-token",
	},
}));

vi.mock("@proliferate/gateway-clients", () => ({
	createSyncClient: vi.fn(() => ({})),
}));

vi.mock("@proliferate/queue", () => ({
	createAutomationEnrichQueue: vi.fn(),
	createAutomationExecuteQueue: vi.fn(),
	createAutomationEnrichWorker: vi.fn(),
	createAutomationExecuteWorker: vi.fn(),
	getConnectionOptions: vi.fn(),
	queueAutomationEnrich: mockQueueAutomationEnrich,
	queueAutomationExecute: mockQueueAutomationExecute,
}));

vi.mock("@proliferate/services", () => ({
	outbox: {
		claimPendingOutbox: mockClaimPendingOutbox,
		recoverStuckOutbox: mockRecoverStuckOutbox,
		markDispatched: mockMarkDispatched,
		markFailed: mockMarkFailed,
		listPendingOutbox: vi.fn(),
		enqueueOutbox: vi.fn(),
	},
	runs: {
		claimRun: vi.fn(),
		transitionRunStatus: vi.fn(),
		findRunWithRelations: vi.fn(),
		markRunFailed: vi.fn(),
		updateRun: vi.fn(),
		listStaleRunningRuns: vi.fn().mockResolvedValue([]),
	},
	notifications: {
		enqueueRunNotification: vi.fn(),
	},
	triggers: {
		updateEvent: vi.fn(),
	},
}));

vi.mock("./artifacts", () => ({
	writeCompletionArtifact: vi.fn().mockResolvedValue("s3://key"),
}));

vi.mock("./notifications", () => ({
	dispatchRunNotification: mockDispatchRunNotification,
}));

const { dispatchOutbox, retryDelay } = await import("./index");

function makeOutboxRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "outbox-1",
		organizationId: "org-1",
		kind: "enqueue_enrich",
		payload: { runId: "run-1" },
		status: "processing",
		attempts: 0,
		availableAt: new Date(),
		claimedAt: new Date(),
		lastError: null,
		createdAt: new Date(),
		...overrides,
	};
}

const mockEnrichQueue = {} as ReturnType<
	typeof import("@proliferate/queue").createAutomationEnrichQueue
>;
const mockExecuteQueue = {} as ReturnType<
	typeof import("@proliferate/queue").createAutomationExecuteQueue
>;
const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	child: vi.fn().mockReturnThis(),
} as unknown as import("@proliferate/logger").Logger;

describe("dispatchOutbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRecoverStuckOutbox.mockResolvedValue(0);
		mockClaimPendingOutbox.mockResolvedValue([]);
		mockMarkDispatched.mockResolvedValue(undefined);
		mockMarkFailed.mockResolvedValue(undefined);
		mockQueueAutomationEnrich.mockResolvedValue(undefined);
		mockQueueAutomationExecute.mockResolvedValue(undefined);
		mockDispatchRunNotification.mockResolvedValue(undefined);
	});

	it("calls recoverStuckOutbox before claiming", async () => {
		await dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger);

		expect(mockRecoverStuckOutbox).toHaveBeenCalledTimes(1);
		expect(mockClaimPendingOutbox).toHaveBeenCalledTimes(1);

		const recoverOrder = mockRecoverStuckOutbox.mock.invocationCallOrder[0];
		const claimOrder = mockClaimPendingOutbox.mock.invocationCallOrder[0];
		expect(recoverOrder).toBeLessThan(claimOrder);
	});

	it("logs warning when stuck rows are recovered", async () => {
		mockRecoverStuckOutbox.mockResolvedValue(3);

		await dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger);

		expect(mockLogger.warn).toHaveBeenCalledWith({ recovered: 3 }, "Recovered stuck outbox rows");
	});

	it("does not log when no stuck rows recovered", async () => {
		mockRecoverStuckOutbox.mockResolvedValue(0);

		await dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger);

		expect(mockLogger.warn).not.toHaveBeenCalled();
	});

	it("uses claimPendingOutbox with limit 50", async () => {
		const row = makeOutboxRow();
		mockClaimPendingOutbox.mockResolvedValue([row]);

		await dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger);

		expect(mockClaimPendingOutbox).toHaveBeenCalledWith(50);
		expect(mockMarkDispatched).toHaveBeenCalledWith("outbox-1");
	});

	it("dispatches enqueue_enrich and marks dispatched", async () => {
		const row = makeOutboxRow({ kind: "enqueue_enrich" });
		mockClaimPendingOutbox.mockResolvedValue([row]);

		await dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger);

		expect(mockQueueAutomationEnrich).toHaveBeenCalledWith(mockEnrichQueue, "run-1");
		expect(mockMarkDispatched).toHaveBeenCalledWith("outbox-1");
	});

	it("dispatches notify_run_terminal and marks dispatched", async () => {
		const row = makeOutboxRow({ kind: "notify_run_terminal" });
		mockClaimPendingOutbox.mockResolvedValue([row]);

		await dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger);

		expect(mockDispatchRunNotification).toHaveBeenCalledWith("run-1", mockLogger);
		expect(mockMarkDispatched).toHaveBeenCalledWith("outbox-1");
	});

	it("marks failed with exponential backoff on error", async () => {
		const row = makeOutboxRow({ kind: "notify_run_terminal", attempts: 2 });
		mockClaimPendingOutbox.mockResolvedValue([row]);
		mockDispatchRunNotification.mockRejectedValueOnce(new Error("Slack timeout"));

		await dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger);

		expect(mockMarkFailed).toHaveBeenCalledWith("outbox-1", "Slack timeout", expect.any(Date));
		expect(mockMarkDispatched).not.toHaveBeenCalled();

		// Verify backoff: 30s * 2^2 = 120s
		const failedAt = mockMarkFailed.mock.calls[0][2] as Date;
		const expectedMin = Date.now() + 115_000;
		const expectedMax = Date.now() + 125_000;
		expect(failedAt.getTime()).toBeGreaterThan(expectedMin);
		expect(failedAt.getTime()).toBeLessThan(expectedMax);
	});

	it("marks permanently failed when runId is missing", async () => {
		const row = makeOutboxRow({ payload: {} });
		mockClaimPendingOutbox.mockResolvedValue([row]);

		await dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger);

		expect(mockMarkFailed).toHaveBeenCalledWith("outbox-1", "Missing runId in outbox payload");
		expect(mockMarkDispatched).not.toHaveBeenCalled();
	});

	it("marks permanently failed for unknown kind", async () => {
		const row = makeOutboxRow({ kind: "unknown_kind" });
		mockClaimPendingOutbox.mockResolvedValue([row]);

		await dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger);

		expect(mockMarkFailed).toHaveBeenCalledWith("outbox-1", "Unknown outbox kind: unknown_kind");
	});

	it("concurrent dispatchers: each row dispatched exactly once", async () => {
		const rows = [
			makeOutboxRow({ id: "r1" }),
			makeOutboxRow({ id: "r2" }),
			makeOutboxRow({ id: "r3" }),
		];

		// First dispatcher claims all rows; second gets nothing (atomic claim)
		mockClaimPendingOutbox.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);

		await Promise.all([
			dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger),
			dispatchOutbox(mockEnrichQueue, mockExecuteQueue, mockLogger),
		]);

		// Each row dispatched exactly once
		expect(mockMarkDispatched).toHaveBeenCalledTimes(3);
		expect(mockMarkDispatched).toHaveBeenCalledWith("r1");
		expect(mockMarkDispatched).toHaveBeenCalledWith("r2");
		expect(mockMarkDispatched).toHaveBeenCalledWith("r3");
	});
});

describe("retryDelay", () => {
	it("returns 30s for attempt 0", () => {
		const delay = retryDelay(0);
		const diff = delay.getTime() - Date.now();
		expect(diff).toBeGreaterThan(29_000);
		expect(diff).toBeLessThan(31_000);
	});

	it("returns 60s for attempt 1", () => {
		const delay = retryDelay(1);
		const diff = delay.getTime() - Date.now();
		expect(diff).toBeGreaterThan(59_000);
		expect(diff).toBeLessThan(61_000);
	});

	it("returns 120s for attempt 2", () => {
		const delay = retryDelay(2);
		const diff = delay.getTime() - Date.now();
		expect(diff).toBeGreaterThan(119_000);
		expect(diff).toBeLessThan(121_000);
	});

	it("caps at 5 minutes for high attempt counts", () => {
		const delay = retryDelay(10);
		const diff = delay.getTime() - Date.now();
		expect(diff).toBeGreaterThan(299_000);
		expect(diff).toBeLessThan(301_000);
	});
});
