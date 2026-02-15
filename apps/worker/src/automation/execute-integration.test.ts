import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockClaimRun,
	mockTransitionRunStatus,
	mockFindRunWithRelations,
	mockMarkRunFailed,
	mockInsertRunEvent,
	mockUpdateRun,
	mockUpdateEvent,
	mockCreateSession,
	mockPostMessage,
	mockRepoExists,
	mockFindManagedConfigurations,
} = vi.hoisted(() => ({
	mockClaimRun: vi.fn(),
	mockTransitionRunStatus: vi.fn(),
	mockFindRunWithRelations: vi.fn(),
	mockMarkRunFailed: vi.fn(),
	mockInsertRunEvent: vi.fn(),
	mockUpdateRun: vi.fn(),
	mockUpdateEvent: vi.fn(),
	mockCreateSession: vi.fn(),
	mockPostMessage: vi.fn(),
	mockRepoExists: vi.fn(),
	mockFindManagedConfigurations: vi.fn(),
}));

vi.mock("@proliferate/environment/server", () => ({
	env: {
		NEXT_PUBLIC_GATEWAY_URL: "http://localhost:3001",
		SERVICE_TO_SERVICE_AUTH_TOKEN: "test-token",
	},
}));

vi.mock("@proliferate/gateway-clients", () => ({
	createSyncClient: vi.fn(() => ({
		createSession: mockCreateSession,
		postMessage: mockPostMessage,
	})),
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
		enqueueOutbox: vi.fn(),
	},
	runs: {
		claimRun: mockClaimRun,
		transitionRunStatus: mockTransitionRunStatus,
		findRunWithRelations: mockFindRunWithRelations,
		markRunFailed: mockMarkRunFailed,
		insertRunEvent: mockInsertRunEvent,
		saveEnrichmentResult: vi.fn(),
		updateRun: mockUpdateRun,
		listStaleRunningRuns: vi.fn().mockResolvedValue([]),
	},
	notifications: {
		enqueueRunNotification: vi.fn(),
	},
	triggers: {
		updateEvent: mockUpdateEvent,
	},
	repos: {
		repoExists: mockRepoExists,
	},
	configurations: {
		findManagedConfigurations: mockFindManagedConfigurations,
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
		status: "ready",
		sessionId: null,
		promptSentAt: null,
		...overrides,
	};
}

function makeContext(overrides: Record<string, unknown> = {}) {
	return {
		id: "run-1",
		organizationId: "org-1",
		automationId: "auto-1",
		status: "ready",
		enrichmentJson: null,
		automation: {
			id: "auto-1",
			name: "Bug Fixer",
			defaultConfigurationId: "pb-default",
			agentInstructions: "Fix the bug",
			modelId: null,
			notificationChannelId: null,
			notificationSlackInstallationId: null,
			enabledTools: null,
			llmFilterPrompt: null,
			llmAnalysisPrompt: null,
			allowAgenticRepoSelection: false,
		},
		triggerEvent: {
			id: "evt-1",
			parsedContext: { title: "Fix login bug" },
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

describe("handleExecute (target resolution integration)", () => {
	let handleExecute: (runId: string, syncClient: unknown) => Promise<void>;
	let syncClient: { createSession: typeof mockCreateSession; postMessage: typeof mockPostMessage };

	beforeEach(async () => {
		vi.clearAllMocks();
		mockClaimRun.mockResolvedValue(null);
		mockTransitionRunStatus.mockResolvedValue({});
		mockFindRunWithRelations.mockResolvedValue(null);
		mockMarkRunFailed.mockResolvedValue({});
		mockInsertRunEvent.mockResolvedValue({});
		mockUpdateRun.mockResolvedValue({});
		mockUpdateEvent.mockResolvedValue({});
		mockCreateSession.mockResolvedValue({ sessionId: "sess-1" });
		mockPostMessage.mockResolvedValue({});
		mockRepoExists.mockResolvedValue(false);
		mockFindManagedConfigurations.mockResolvedValue([]);

		const { createSyncClient } = await import("@proliferate/gateway-clients");
		syncClient = (createSyncClient as ReturnType<typeof vi.fn>)() as typeof syncClient;

		// handleExecute is not exported, so we access it through the module's startAutomationWorkers
		// Instead, we'll test the flow via a re-exported helper or by extracting.
		// Since handleExecute is private, we need to invoke it through the worker callback.
		// But in the test pattern, the createAutomationExecuteWorker mock captures the callback.
		const { createAutomationExecuteWorker } = await import("@proliferate/queue");
		const mockWorkerFactory = createAutomationExecuteWorker as ReturnType<typeof vi.fn>;

		// We need to trigger startAutomationWorkers to capture the execute callback
		const mod = await import("./index");
		mod.startAutomationWorkers({
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
			trace: vi.fn(),
			fatal: vi.fn(),
			child: vi.fn(),
		} as unknown as import("@proliferate/logger").Logger);

		const executeCallback = mockWorkerFactory.mock.calls[0]?.[0];
		if (!executeCallback) throw new Error("Execute worker callback not captured");

		handleExecute = async (runId: string) => {
			await executeCallback({ data: { runId } });
		};
	});

	it("default path: uses configurationId when selection disabled", async () => {
		mockClaimRun.mockResolvedValueOnce(makeRun());
		mockFindRunWithRelations.mockResolvedValueOnce(
			makeContext({
				automation: {
					id: "auto-1",
					name: "Bug Fixer",
					defaultConfigurationId: "pb-default",
					agentInstructions: "Fix the bug",
					modelId: null,
					notificationChannelId: null,
					notificationSlackInstallationId: null,
					enabledTools: null,
					llmFilterPrompt: null,
					llmAnalysisPrompt: null,
					allowAgenticRepoSelection: false,
				},
			}),
		);

		await handleExecute("run-1");

		// target_resolved event recorded
		expect(mockInsertRunEvent).toHaveBeenCalledWith(
			"run-1",
			"target_resolved",
			"ready",
			"ready",
			expect.objectContaining({
				type: "default",
				reason: "selection_disabled",
			}),
		);

		// Session created with configurationId (not managedConfiguration)
		expect(mockCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({
				configurationId: "pb-default",
			}),
			expect.any(Object),
		);
		expect(mockCreateSession).toHaveBeenCalledWith(
			expect.not.objectContaining({
				managedConfiguration: expect.anything(),
			}),
			expect.any(Object),
		);
	});

	it("selected path (new): uses managedConfiguration when no existing configuration covers repo", async () => {
		mockClaimRun.mockResolvedValueOnce(makeRun());
		mockRepoExists.mockResolvedValueOnce(true);
		mockFindManagedConfigurations.mockResolvedValueOnce([]);
		mockFindRunWithRelations.mockResolvedValueOnce(
			makeContext({
				enrichmentJson: {
					version: 1,
					suggestedRepoId: "repo-1",
				},
				automation: {
					id: "auto-1",
					name: "Bug Fixer",
					defaultConfigurationId: "pb-default",
					agentInstructions: "Fix the bug",
					modelId: null,
					notificationChannelId: null,
					notificationSlackInstallationId: null,
					enabledTools: null,
					llmFilterPrompt: null,
					llmAnalysisPrompt: null,
					allowAgenticRepoSelection: true,
				},
			}),
		);

		await handleExecute("run-1");

		// target_resolved event
		expect(mockInsertRunEvent).toHaveBeenCalledWith(
			"run-1",
			"target_resolved",
			"ready",
			"ready",
			expect.objectContaining({
				type: "selected",
				reason: "enrichment_suggestion_new",
				repoIds: ["repo-1"],
			}),
		);

		// Session created with managedConfiguration (not configurationId)
		expect(mockCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({
				managedConfiguration: { repoIds: ["repo-1"] },
			}),
			expect.any(Object),
		);
	});

	it("selected path (reuse): uses configurationId when existing managed configuration covers repo", async () => {
		mockClaimRun.mockResolvedValueOnce(makeRun());
		mockRepoExists.mockResolvedValueOnce(true);
		mockFindManagedConfigurations.mockResolvedValueOnce([
			{
				id: "pb-managed-existing",
				snapshotId: "snap-1",
				configurationRepos: [
					{ repo: { id: "repo-1", organizationId: "org-1", githubRepoName: "org/repo" } },
				],
			},
		]);
		mockFindRunWithRelations.mockResolvedValueOnce(
			makeContext({
				enrichmentJson: {
					version: 1,
					suggestedRepoId: "repo-1",
				},
				automation: {
					id: "auto-1",
					name: "Bug Fixer",
					defaultConfigurationId: "pb-default",
					agentInstructions: "Fix the bug",
					modelId: null,
					notificationChannelId: null,
					notificationSlackInstallationId: null,
					enabledTools: null,
					llmFilterPrompt: null,
					llmAnalysisPrompt: null,
					allowAgenticRepoSelection: true,
				},
			}),
		);

		await handleExecute("run-1");

		// target_resolved event shows reuse
		expect(mockInsertRunEvent).toHaveBeenCalledWith(
			"run-1",
			"target_resolved",
			"ready",
			"ready",
			expect.objectContaining({
				type: "selected",
				reason: "enrichment_suggestion_reused",
			}),
		);

		// Session created with configurationId (reusing existing, NOT managedConfiguration)
		expect(mockCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({
				configurationId: "pb-managed-existing",
			}),
			expect.any(Object),
		);
		expect(mockCreateSession).toHaveBeenCalledWith(
			expect.not.objectContaining({
				managedConfiguration: expect.anything(),
			}),
			expect.any(Object),
		);
	});

	it("fallback path: uses configurationId when repo is invalid", async () => {
		mockClaimRun.mockResolvedValueOnce(makeRun());
		mockRepoExists.mockResolvedValueOnce(false);
		mockFindRunWithRelations.mockResolvedValueOnce(
			makeContext({
				enrichmentJson: {
					version: 1,
					suggestedRepoId: "repo-bad",
				},
				automation: {
					id: "auto-1",
					name: "Bug Fixer",
					defaultConfigurationId: "pb-default",
					agentInstructions: "Fix the bug",
					modelId: null,
					notificationChannelId: null,
					notificationSlackInstallationId: null,
					enabledTools: null,
					llmFilterPrompt: null,
					llmAnalysisPrompt: null,
					allowAgenticRepoSelection: true,
				},
			}),
		);

		await handleExecute("run-1");

		// target_resolved event shows fallback
		expect(mockInsertRunEvent).toHaveBeenCalledWith(
			"run-1",
			"target_resolved",
			"ready",
			"ready",
			expect.objectContaining({
				type: "fallback",
				reason: "repo_not_found_or_wrong_org",
				suggestedRepoId: "repo-bad",
			}),
		);

		// Session created with configurationId fallback
		expect(mockCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({
				configurationId: "pb-default",
			}),
			expect.any(Object),
		);
	});

	it("fails run when no default configuration and selection disabled", async () => {
		mockClaimRun.mockResolvedValueOnce(makeRun());
		mockFindRunWithRelations.mockResolvedValueOnce(
			makeContext({
				automation: {
					id: "auto-1",
					name: "Bug Fixer",
					defaultConfigurationId: null,
					agentInstructions: "Fix the bug",
					modelId: null,
					notificationChannelId: null,
					notificationSlackInstallationId: null,
					enabledTools: null,
					llmFilterPrompt: null,
					llmAnalysisPrompt: null,
					allowAgenticRepoSelection: false,
				},
			}),
		);

		await handleExecute("run-1");

		expect(mockMarkRunFailed).toHaveBeenCalledWith({
			runId: "run-1",
			reason: "missing_configuration",
			stage: "execution",
			errorMessage: "Automation missing default configuration and no valid selection",
		});

		// Session should NOT be created
		expect(mockCreateSession).not.toHaveBeenCalled();
	});

	it("does nothing when claim fails", async () => {
		mockClaimRun.mockResolvedValueOnce(null);

		await handleExecute("run-1");

		expect(mockFindRunWithRelations).not.toHaveBeenCalled();
		expect(mockInsertRunEvent).not.toHaveBeenCalled();
	});

	it("marks failed when context is missing", async () => {
		mockClaimRun.mockResolvedValueOnce(makeRun());
		mockFindRunWithRelations.mockResolvedValueOnce(null);

		await handleExecute("run-1");

		expect(mockMarkRunFailed).toHaveBeenCalledWith({
			runId: "run-1",
			reason: "missing_context",
			stage: "execution",
			errorMessage: "Missing automation or trigger event context",
		});
	});
});
