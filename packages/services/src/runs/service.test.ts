import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mock setup
// ============================================

const { mockFindById, mockUpdateRun, mockInsertRunEvent } = vi.hoisted(() => ({
	mockFindById: vi.fn(),
	mockUpdateRun: vi.fn(),
	mockInsertRunEvent: vi.fn(),
}));

vi.mock("./db", () => ({
	findById: mockFindById,
	updateRun: mockUpdateRun,
	insertRunEvent: mockInsertRunEvent,
	findByIdWithRelations: vi.fn(),
	claimRun: vi.fn(),
	listStaleRunningRuns: vi.fn(),
	listRunsForAutomation: vi.fn(),
	assignRunToUser: vi.fn(),
	unassignRun: vi.fn(),
	listRunsAssignedToUser: vi.fn(),
}));

const mockEnqueueRunNotification = vi.fn();

// Transaction mocks for resolveRun
const mockTxFindFirst = vi.fn();
const mockTxUpdateReturning = vi.fn();
const mockTxInsertValues = vi.fn().mockReturnValue({});

const mockTx = {
	query: {
		automationRuns: {
			findFirst: mockTxFindFirst,
		},
	},
	update: vi.fn().mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				returning: mockTxUpdateReturning,
			}),
		}),
	}),
	insert: vi.fn().mockReturnValue({
		values: mockTxInsertValues,
	}),
};

vi.mock("../db/client", () => ({
	getDb: vi.fn(() => ({
		transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
	})),
	eq: vi.fn(),
	and: vi.fn(),
	inArray: vi.fn(),
	automationRuns: {},
	automationRunEvents: {},
	outbox: {},
	triggerEvents: {},
}));

vi.mock("../notifications/service", () => ({
	enqueueRunNotification: mockEnqueueRunNotification,
}));

const {
	saveEnrichmentResult,
	getEnrichmentResult,
	updateRun,
	transitionRunStatus,
	completeEnrichment,
	completeRun,
	resolveRun,
	RunNotResolvableError,
	DEFAULT_RUN_DEADLINE_MS,
} = await import("./service");
const { InvalidRunStatusTransitionError } = await import("./state-machine");

// ============================================
// Helpers
// ============================================

function makeRun(overrides: Record<string, unknown> = {}) {
	return {
		id: "run-1",
		organizationId: "org-1",
		automationId: "auto-1",
		triggerEventId: "event-1",
		status: "enriching",
		enrichmentJson: null,
		completionJson: null,
		completedAt: null,
		assignedTo: null,
		assignedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

// ============================================
// saveEnrichmentResult
// ============================================

describe("saveEnrichmentResult", () => {
	beforeEach(() => vi.clearAllMocks());

	it("writes enrichmentJson and records audit event", async () => {
		const run = makeRun();
		const payload = { summary: "Bug in auth flow", sources: ["linear-123"] };
		mockFindById.mockResolvedValue(run);
		mockUpdateRun.mockResolvedValue({ ...run, enrichmentJson: payload });
		mockInsertRunEvent.mockResolvedValue({});

		const result = await saveEnrichmentResult({
			runId: "run-1",
			enrichmentPayload: payload,
		});

		expect(mockUpdateRun).toHaveBeenCalledWith("run-1", {
			enrichmentJson: payload,
		});
		expect(mockInsertRunEvent).toHaveBeenCalledWith(
			"run-1",
			"enrichment_saved",
			"enriching",
			"enriching",
			{ payloadSize: expect.any(Number) },
		);
		expect(result).toBeTruthy();
		expect(result?.enrichmentJson).toEqual(payload);
	});

	it("records payload size in event data", async () => {
		const payload = { key: "value" };
		mockFindById.mockResolvedValue(makeRun());
		mockUpdateRun.mockResolvedValue(makeRun({ enrichmentJson: payload }));
		mockInsertRunEvent.mockResolvedValue({});

		await saveEnrichmentResult({ runId: "run-1", enrichmentPayload: payload });

		const eventData = mockInsertRunEvent.mock.calls[0][4] as { payloadSize: number };
		expect(eventData.payloadSize).toBe(JSON.stringify(payload).length);
	});

	it("returns null for nonexistent run", async () => {
		mockFindById.mockResolvedValue(null);

		const result = await saveEnrichmentResult({
			runId: "nonexistent",
			enrichmentPayload: { data: "test" },
		});

		expect(result).toBeNull();
		expect(mockUpdateRun).not.toHaveBeenCalled();
		expect(mockInsertRunEvent).not.toHaveBeenCalled();
	});
});

// ============================================
// getEnrichmentResult
// ============================================

describe("getEnrichmentResult", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns enrichmentJson when present", async () => {
		const payload = { analysis: "result", confidence: 0.95 };
		mockFindById.mockResolvedValue(makeRun({ enrichmentJson: payload }));

		const result = await getEnrichmentResult("run-1");

		expect(result).toEqual(payload);
	});

	it("returns null when enrichmentJson is null", async () => {
		mockFindById.mockResolvedValue(makeRun({ enrichmentJson: null }));

		const result = await getEnrichmentResult("run-1");

		expect(result).toBeNull();
	});

	it("returns null for nonexistent run", async () => {
		mockFindById.mockResolvedValue(null);

		const result = await getEnrichmentResult("nonexistent");

		expect(result).toBeNull();
	});

	it("returns null when enrichmentJson is undefined", async () => {
		mockFindById.mockResolvedValue(makeRun());

		const result = await getEnrichmentResult("run-1");

		expect(result).toBeNull();
	});
});

// ============================================
// transitionRunStatus
// ============================================

describe("transitionRunStatus", () => {
	beforeEach(() => vi.clearAllMocks());

	it("updates status and writes transition event for legal transitions", async () => {
		const run = makeRun({ status: "ready" });
		const updated = { ...run, status: "running" };
		mockFindById.mockResolvedValue(run);
		mockUpdateRun.mockResolvedValue(updated);
		mockInsertRunEvent.mockResolvedValue({});

		const result = await transitionRunStatus("run-1", "running", {
			executionStartedAt: new Date(),
		});

		expect(result?.status).toBe("running");
		expect(mockUpdateRun).toHaveBeenCalledWith(
			"run-1",
			expect.objectContaining({ status: "running" }),
		);
		expect(mockInsertRunEvent).toHaveBeenCalledWith(
			"run-1",
			"status_transition",
			"ready",
			"running",
			null,
		);
	});

	it("throws on invalid transitions", async () => {
		mockFindById.mockResolvedValue(makeRun({ status: "queued" }));

		await expect(transitionRunStatus("run-1", "running")).rejects.toThrow(
			InvalidRunStatusTransitionError,
		);
		expect(mockUpdateRun).not.toHaveBeenCalled();
		expect(mockInsertRunEvent).not.toHaveBeenCalled();
	});
});

// ============================================
// updateRun
// ============================================

describe("updateRun", () => {
	beforeEach(() => vi.clearAllMocks());

	it("rejects direct status writes", async () => {
		await expect(
			updateRun("run-1", { status: "running" } as Parameters<typeof updateRun>[1]),
		).rejects.toThrow("Direct run status updates are not allowed");
		expect(mockUpdateRun).not.toHaveBeenCalled();
	});
});

// ============================================
// completeEnrichment
// ============================================

describe("completeEnrichment", () => {
	beforeEach(() => vi.clearAllMocks());

	it("throws when run status changes before enrichment update", async () => {
		mockTxFindFirst.mockResolvedValue(makeRun({ status: "enriching" }));
		mockTxUpdateReturning.mockResolvedValue([]);

		await expect(
			completeEnrichment({
				runId: "run-1",
				organizationId: "org-1",
				enrichmentPayload: { title: "Demo" },
			}),
		).rejects.toThrow("Run status changed during enrichment completion");

		expect(mockTxInsertValues).not.toHaveBeenCalled();
	});
});

// ============================================
// completeRun
// ============================================

describe("completeRun", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns latest row for idempotent completion when CAS update misses", async () => {
		const payload = { outcome: "succeeded", summary: "ok" };
		const run = makeRun({ status: "running", completionId: null, completionJson: null });
		const completed = makeRun({
			status: "succeeded",
			completionId: "cmp-1",
			completionJson: payload,
		});

		mockTxFindFirst.mockResolvedValueOnce(run).mockResolvedValueOnce(completed);
		mockTxUpdateReturning.mockResolvedValue([]);

		const result = await completeRun({
			runId: "run-1",
			completionId: "cmp-1",
			outcome: "succeeded",
			completionJson: payload,
		});

		expect(result).toEqual(completed);
		expect(mockTxInsertValues).not.toHaveBeenCalled();
	});

	it("throws when run status changes before completion update", async () => {
		const payload = { outcome: "failed" };
		const run = makeRun({ status: "running", completionId: null, completionJson: null });
		const changed = makeRun({
			status: "failed",
			completionId: "cmp-2",
			completionJson: payload,
		});

		mockTxFindFirst.mockResolvedValueOnce(run).mockResolvedValueOnce(changed);
		mockTxUpdateReturning.mockResolvedValue([]);

		await expect(
			completeRun({
				runId: "run-1",
				completionId: "cmp-1",
				outcome: "failed",
				completionJson: payload,
			}),
		).rejects.toThrow("Run status changed during completion");
	});
});

// ============================================
// resolveRun
// ============================================

describe("resolveRun", () => {
	beforeEach(() => vi.clearAllMocks());

	it("resolves a needs_human run to succeeded", async () => {
		const run = makeRun({ status: "needs_human" });
		const updated = { ...run, status: "succeeded" };
		mockTxFindFirst.mockResolvedValue(run);
		mockTxUpdateReturning.mockResolvedValue([updated]);
		mockEnqueueRunNotification.mockResolvedValue(undefined);

		const result = await resolveRun({
			runId: "run-1",
			automationId: "auto-1",
			orgId: "org-1",
			userId: "user-1",
			outcome: "succeeded",
			reason: "manually verified",
			comment: "Looks good after review",
		});

		expect(result).toBeTruthy();
		expect(result?.status).toBe("succeeded");

		// Verify conditional update was called
		const setArg = mockTx.update.mock.results[0].value.set.mock.calls[0][0];
		expect(setArg.status).toBe("succeeded");
		expect(setArg.statusReason).toBe("manual_resolution:manually verified");

		// Verify event was inserted
		const insertArg = mockTxInsertValues.mock.calls[0][0];
		expect(insertArg.runId).toBe("run-1");
		expect(insertArg.type).toBe("manual_resolution");
		expect(insertArg.fromStatus).toBe("needs_human");
		expect(insertArg.toStatus).toBe("succeeded");
		expect(insertArg.data.userId).toBe("user-1");
		expect(insertArg.data.reason).toBe("manually verified");
		expect(insertArg.data.comment).toBe("Looks good after review");
	});

	it("resolves a failed run to succeeded", async () => {
		const run = makeRun({ status: "failed" });
		const updated = { ...run, status: "succeeded" };
		mockTxFindFirst.mockResolvedValue(run);
		mockTxUpdateReturning.mockResolvedValue([updated]);
		mockEnqueueRunNotification.mockResolvedValue(undefined);

		const result = await resolveRun({
			runId: "run-1",
			automationId: "auto-1",
			orgId: "org-1",
			userId: "user-1",
			outcome: "succeeded",
		});

		expect(result).toBeTruthy();
	});

	it("resolves a timed_out run to failed", async () => {
		const run = makeRun({ status: "timed_out" });
		const updated = { ...run, status: "failed" };
		mockTxFindFirst.mockResolvedValue(run);
		mockTxUpdateReturning.mockResolvedValue([updated]);
		mockEnqueueRunNotification.mockResolvedValue(undefined);

		const result = await resolveRun({
			runId: "run-1",
			automationId: "auto-1",
			orgId: "org-1",
			userId: "user-1",
			outcome: "failed",
			reason: "confirmed broken",
		});

		expect(result).toBeTruthy();
		const setArg = mockTx.update.mock.results[0].value.set.mock.calls[0][0];
		expect(setArg.status).toBe("failed");
		expect(setArg.statusReason).toBe("manual_resolution:confirmed broken");
	});

	it("throws RunNotResolvableError for running status", async () => {
		const run = makeRun({ status: "running" });
		mockTxFindFirst.mockResolvedValue(run);

		await expect(
			resolveRun({
				runId: "run-1",
				automationId: "auto-1",
				orgId: "org-1",
				userId: "user-1",
				outcome: "succeeded",
			}),
		).rejects.toThrow(RunNotResolvableError);
	});

	it("throws RunNotResolvableError for queued status", async () => {
		const run = makeRun({ status: "queued" });
		mockTxFindFirst.mockResolvedValue(run);

		await expect(
			resolveRun({
				runId: "run-1",
				automationId: "auto-1",
				orgId: "org-1",
				userId: "user-1",
				outcome: "succeeded",
			}),
		).rejects.toThrow(RunNotResolvableError);
	});

	it("throws for invalid outcome", async () => {
		await expect(
			resolveRun({
				runId: "run-1",
				automationId: "auto-1",
				orgId: "org-1",
				userId: "user-1",
				outcome: "needs_human",
			}),
		).rejects.toThrow("Invalid resolution outcome");
	});

	it("returns null for nonexistent run", async () => {
		mockTxFindFirst.mockResolvedValue(null);

		const result = await resolveRun({
			runId: "nonexistent",
			automationId: "auto-1",
			orgId: "org-1",
			userId: "user-1",
			outcome: "succeeded",
		});

		expect(result).toBeNull();
	});

	it("returns null when org does not match", async () => {
		const run = makeRun({ organizationId: "org-other" });
		mockTxFindFirst.mockResolvedValue(run);

		const result = await resolveRun({
			runId: "run-1",
			automationId: "auto-1",
			orgId: "org-1",
			userId: "user-1",
			outcome: "succeeded",
		});

		expect(result).toBeNull();
		expect(mockTx.update).not.toHaveBeenCalled();
	});

	it("returns null when automationId does not match", async () => {
		const run = makeRun({ automationId: "auto-other" });
		mockTxFindFirst.mockResolvedValue(run);

		const result = await resolveRun({
			runId: "run-1",
			automationId: "auto-1",
			orgId: "org-1",
			userId: "user-1",
			outcome: "succeeded",
		});

		expect(result).toBeNull();
		expect(mockTx.update).not.toHaveBeenCalled();
	});

	it("preserves existing completedAt if already set", async () => {
		const existingDate = new Date("2025-01-01");
		const run = makeRun({ status: "needs_human", completedAt: existingDate });
		const updated = { ...run, status: "succeeded" };
		mockTxFindFirst.mockResolvedValue(run);
		mockTxUpdateReturning.mockResolvedValue([updated]);
		mockEnqueueRunNotification.mockResolvedValue(undefined);

		await resolveRun({
			runId: "run-1",
			automationId: "auto-1",
			orgId: "org-1",
			userId: "user-1",
			outcome: "succeeded",
		});

		const setArg = mockTx.update.mock.results[0].value.set.mock.calls[0][0];
		expect(setArg.completedAt).toBe(existingDate);
	});

	it("uses default reason when none provided", async () => {
		const run = makeRun({ status: "needs_human" });
		const updated = { ...run, status: "succeeded" };
		mockTxFindFirst.mockResolvedValue(run);
		mockTxUpdateReturning.mockResolvedValue([updated]);
		mockEnqueueRunNotification.mockResolvedValue(undefined);

		await resolveRun({
			runId: "run-1",
			automationId: "auto-1",
			orgId: "org-1",
			userId: "user-1",
			outcome: "succeeded",
		});

		const insertArg = mockTxInsertValues.mock.calls[0][0];
		expect(insertArg.data.reason).toBeNull();
		expect(insertArg.data.comment).toBeNull();
	});

	it("throws RunNotResolvableError on concurrent status change (empty update)", async () => {
		const run = makeRun({ status: "needs_human" });
		mockTxFindFirst.mockResolvedValue(run);
		// Conditional update returns empty — status changed between read and write
		mockTxUpdateReturning.mockResolvedValue([]);

		await expect(
			resolveRun({
				runId: "run-1",
				automationId: "auto-1",
				orgId: "org-1",
				userId: "user-1",
				outcome: "succeeded",
			}),
		).rejects.toThrow(RunNotResolvableError);
	});
});

// ============================================
// DEFAULT_RUN_DEADLINE_MS
// ============================================

describe("DEFAULT_RUN_DEADLINE_MS", () => {
	it("is 2 hours in milliseconds", () => {
		expect(DEFAULT_RUN_DEADLINE_MS).toBe(2 * 60 * 60 * 1000);
	});
});
