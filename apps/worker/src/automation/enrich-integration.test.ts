import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockClaimRun,
	mockTransitionRunStatus,
	mockFindRunWithRelations,
	mockMarkRunFailed,
	mockCompleteEnrichment,
} = vi.hoisted(() => ({
	mockClaimRun: vi.fn(),
	mockTransitionRunStatus: vi.fn(),
	mockFindRunWithRelations: vi.fn(),
	mockMarkRunFailed: vi.fn(),
	mockCompleteEnrichment: vi.fn(),
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
	queueAutomationEnrich: vi.fn(),
	queueAutomationExecute: vi.fn(),
}));

vi.mock("@proliferate/services", () => ({
	outbox: {
		claimPendingOutbox: vi.fn(),
		recoverStuckOutbox: vi.fn(),
		markDispatched: vi.fn(),
		markFailed: vi.fn(),
		listPendingOutbox: vi.fn(),
		enqueueOutbox: vi.fn(),
	},
	runs: {
		claimRun: mockClaimRun,
		transitionRunStatus: mockTransitionRunStatus,
		findRunWithRelations: mockFindRunWithRelations,
		markRunFailed: mockMarkRunFailed,
		completeEnrichment: mockCompleteEnrichment,
		saveEnrichmentResult: vi.fn(),
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
	writeEnrichmentArtifact: vi.fn().mockResolvedValue("s3://enrichment-key"),
}));

vi.mock("./notifications", () => ({
	dispatchRunNotification: vi.fn(),
}));

function makeRun(overrides: Record<string, unknown> = {}) {
	return {
		id: "run-1",
		organizationId: "org-1",
		automationId: "auto-1",
		status: "queued",
		leaseVersion: 1,
		...overrides,
	};
}

function makeContext(overrides: Record<string, unknown> = {}) {
	return {
		id: "run-1",
		organizationId: "org-1",
		automationId: "auto-1",
		status: "enriching",
		automation: {
			id: "auto-1",
			name: "Bug Fixer",
			defaultConfigurationId: "pb-1",
			agentInstructions: null,
			modelId: null,
			notificationChannelId: null,
			notificationSlackInstallationId: null,
			enabledTools: null,
			llmFilterPrompt: null,
			llmAnalysisPrompt: null,
		},
		triggerEvent: {
			id: "evt-1",
			parsedContext: {
				title: "Fix login bug",
				description: "Users cannot log in",
				linear: {
					issueId: "abc",
					issueNumber: 42,
					title: "Fix login bug",
					state: "In Progress",
					priority: 1,
					issueUrl: "https://linear.app/team/LIN-42",
				},
			},
			rawPayload: {},
			providerEventType: "Issue:create",
			externalEventId: "LIN-42",
			dedupKey: null,
		},
		trigger: {
			id: "trig-1",
			provider: "linear",
			name: "Linear Issues",
		},
		...overrides,
	};
}

describe("handleEnrich (integration)", () => {
	let handleEnrich: (runId: string, logger?: unknown) => Promise<void>;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockClaimRun.mockResolvedValue(null);
		mockTransitionRunStatus.mockResolvedValue({});
		mockFindRunWithRelations.mockResolvedValue(null);
		mockMarkRunFailed.mockResolvedValue({});
		mockCompleteEnrichment.mockResolvedValue({});

		const mod = await import("./index");
		handleEnrich = (mod as { handleEnrich: (runId: string, logger?: unknown) => Promise<void> })
			.handleEnrich;
	});

	it("success flow: claim → enrich → atomic complete (save + ready + outbox)", async () => {
		const run = makeRun();
		const context = makeContext();

		mockClaimRun.mockResolvedValueOnce(run);
		mockFindRunWithRelations.mockResolvedValueOnce(context);

		await handleEnrich("run-1");

		// 1. Claimed run (accepts both queued and enriching for retry safety)
		expect(mockClaimRun).toHaveBeenCalledWith(
			"run-1",
			["queued", "enriching"],
			expect.stringContaining("automation-enrich:"),
			expect.any(Number),
		);

		// 2. Transitioned to enriching
		expect(mockTransitionRunStatus).toHaveBeenCalledWith(
			"run-1",
			"enriching",
			expect.objectContaining({
				enrichmentStartedAt: expect.any(Date),
			}),
		);

		// 3. Loaded context
		expect(mockFindRunWithRelations).toHaveBeenCalledWith("run-1");

		// 4. Atomic enrichment completion (replaces sequential writes)
		expect(mockCompleteEnrichment).toHaveBeenCalledWith({
			runId: "run-1",
			organizationId: "org-1",
			enrichmentPayload: expect.objectContaining({
				version: 1,
				provider: "linear",
				summary: { title: "Fix login bug", description: "Users cannot log in" },
			}),
		});
	});

	it("does nothing when claim fails", async () => {
		mockClaimRun.mockResolvedValueOnce(null);

		await handleEnrich("run-1");

		expect(mockTransitionRunStatus).not.toHaveBeenCalled();
		expect(mockFindRunWithRelations).not.toHaveBeenCalled();
	});

	it("marks failed when context is missing", async () => {
		mockClaimRun.mockResolvedValueOnce(makeRun());
		mockFindRunWithRelations.mockResolvedValueOnce({
			...makeContext(),
			triggerEvent: null,
		});

		await handleEnrich("run-1");

		expect(mockMarkRunFailed).toHaveBeenCalledWith({
			runId: "run-1",
			reason: "missing_context",
			stage: "enrichment",
			errorMessage: "Missing automation, trigger, or trigger event context",
		});
		expect(mockCompleteEnrichment).not.toHaveBeenCalled();
	});

	it("marks failed when parsedContext has no title (EnrichmentError)", async () => {
		mockClaimRun.mockResolvedValueOnce(makeRun());
		mockFindRunWithRelations.mockResolvedValueOnce(
			makeContext({
				triggerEvent: {
					id: "evt-1",
					parsedContext: { description: "no title" },
					rawPayload: {},
					providerEventType: null,
					externalEventId: null,
					dedupKey: null,
				},
			}),
		);

		await handleEnrich("run-1");

		expect(mockMarkRunFailed).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				reason: "enrichment_failed",
				stage: "enrichment",
			}),
		);
		expect(mockCompleteEnrichment).not.toHaveBeenCalled();
	});

	it("propagates transient errors for BullMQ retry", async () => {
		mockClaimRun.mockResolvedValueOnce(makeRun());
		mockFindRunWithRelations.mockResolvedValueOnce(makeContext());
		mockCompleteEnrichment.mockRejectedValueOnce(new Error("DB connection lost"));

		await expect(handleEnrich("run-1")).rejects.toThrow("DB connection lost");

		expect(mockMarkRunFailed).not.toHaveBeenCalled();
	});

	it("retry reclaims run already in enriching status without re-transitioning", async () => {
		const run = makeRun({ status: "enriching" });
		const context = makeContext();

		mockClaimRun.mockResolvedValueOnce(run);
		mockFindRunWithRelations.mockResolvedValueOnce(context);

		await handleEnrich("run-1");

		// Should NOT call transitionRunStatus to "enriching" (already there)
		const enrichingCalls = mockTransitionRunStatus.mock.calls.filter(
			(call: unknown[]) => call[1] === "enriching",
		);
		expect(enrichingCalls).toHaveLength(0);

		// Should still use atomic completeEnrichment
		expect(mockCompleteEnrichment).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				organizationId: "org-1",
			}),
		);
	});
});
