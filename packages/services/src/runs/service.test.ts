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

vi.mock("../db/client", () => ({
	getDb: vi.fn(),
	eq: vi.fn(),
	automationRuns: {},
	automationRunEvents: {},
	outbox: {},
	triggerEvents: {},
}));

vi.mock("../notifications/service", () => ({
	enqueueRunNotification: vi.fn(),
}));

const { saveEnrichmentResult, getEnrichmentResult } = await import("./service");

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
