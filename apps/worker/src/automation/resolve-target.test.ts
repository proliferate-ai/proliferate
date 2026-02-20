import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelectConfiguration } = vi.hoisted(() => ({
	mockSelectConfiguration: vi.fn(),
}));

vi.mock("./configuration-selector", () => ({
	selectConfiguration: mockSelectConfiguration,
	buildEnrichmentContext: vi.fn((json: unknown) => {
		if (!json || typeof json !== "object") return "No enrichment context available.";
		const e = json as Record<string, unknown>;
		const summary = e.summary as { title?: string } | undefined;
		return summary?.title ? `Title: ${summary.title}` : "No enrichment context available.";
	}),
}));

const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	child: vi.fn().mockReturnThis(),
} as unknown as import("@proliferate/logger").Logger;

import { resolveTarget } from "./resolve-target";

beforeEach(() => {
	vi.clearAllMocks();
});

function makeAutomation(overrides: Record<string, unknown> = {}) {
	return {
		id: "auto-1",
		name: "Bug Fixer",
		defaultConfigurationId: "cfg-default",
		agentInstructions: null,
		modelId: null,
		notificationChannelId: null,
		notificationSlackInstallationId: null,
		enabledTools: null,
		llmFilterPrompt: null,
		llmAnalysisPrompt: null,
		allowAgenticRepoSelection: false,
		configSelectionStrategy: "fixed" as string | null,
		fallbackConfigurationId: null as string | null,
		allowedConfigurationIds: null as string[] | null,
		...overrides,
	};
}

function makeEnrichment(overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		provider: "linear",
		summary: { title: "Fix bug", description: null },
		source: { url: null, externalId: null, eventType: null },
		relatedFiles: [],
		suggestedRepoId: null,
		providerContext: {},
		automationContext: {
			automationId: "auto-1",
			automationName: "Bug Fixer",
			hasLlmFilter: false,
			hasLlmAnalysis: false,
		},
		...overrides,
	};
}

describe("resolveTarget", () => {
	// ============================================
	// Fixed strategy
	// ============================================

	it("returns default when strategy is fixed", async () => {
		const result = await resolveTarget(
			{
				automation: makeAutomation({ configSelectionStrategy: "fixed" }),
				enrichmentJson: makeEnrichment(),
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			type: "default",
			configurationId: "cfg-default",
			reason: "selection_disabled",
		});
		expect(mockSelectConfiguration).not.toHaveBeenCalled();
	});

	it("returns default when allowAgenticRepoSelection is false", async () => {
		const result = await resolveTarget(
			{
				automation: makeAutomation({
					configSelectionStrategy: "agent_decide",
					allowAgenticRepoSelection: false,
				}),
				enrichmentJson: makeEnrichment(),
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			type: "default",
			configurationId: "cfg-default",
			reason: "selection_disabled",
		});
	});

	it("returns default with undefined configurationId when automation is null", async () => {
		const result = await resolveTarget(
			{
				automation: null,
				enrichmentJson: makeEnrichment(),
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			type: "default",
			configurationId: undefined,
			reason: "selection_disabled",
		});
	});

	// ============================================
	// agent_decide strategy — success
	// ============================================

	it("returns selected when LLM selector succeeds", async () => {
		mockSelectConfiguration.mockResolvedValueOnce({
			status: "selected",
			configurationId: "cfg-selected",
			rationale: "Best match for Linear bug fix",
		});

		const result = await resolveTarget(
			{
				automation: makeAutomation({
					configSelectionStrategy: "agent_decide",
					allowAgenticRepoSelection: true,
					allowedConfigurationIds: ["cfg-1", "cfg-2"],
				}),
				enrichmentJson: makeEnrichment({ summary: { title: "Fix auth bug" } }),
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			type: "selected",
			configurationId: "cfg-selected",
			reason: "Best match for Linear bug fix",
		});

		expect(mockSelectConfiguration).toHaveBeenCalledWith(
			{
				allowedConfigurationIds: ["cfg-1", "cfg-2"],
				context: expect.any(String),
				organizationId: "org-1",
			},
			mockLogger,
		);
	});

	// ============================================
	// agent_decide strategy — failures
	// ============================================

	it("fails when allowedConfigurationIds is empty", async () => {
		const result = await resolveTarget(
			{
				automation: makeAutomation({
					configSelectionStrategy: "agent_decide",
					allowAgenticRepoSelection: true,
					allowedConfigurationIds: [],
				}),
				enrichmentJson: makeEnrichment(),
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			type: "failed",
			reason: "configuration_selection_failed",
		});
		expect(mockSelectConfiguration).not.toHaveBeenCalled();
	});

	it("fails when allowedConfigurationIds is null", async () => {
		const result = await resolveTarget(
			{
				automation: makeAutomation({
					configSelectionStrategy: "agent_decide",
					allowAgenticRepoSelection: true,
					allowedConfigurationIds: null,
				}),
				enrichmentJson: makeEnrichment(),
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			type: "failed",
			reason: "configuration_selection_failed",
		});
	});

	it("fails when LLM selector returns failure", async () => {
		mockSelectConfiguration.mockResolvedValueOnce({
			status: "failed",
			reason: "no_eligible_candidates",
		});

		const result = await resolveTarget(
			{
				automation: makeAutomation({
					configSelectionStrategy: "agent_decide",
					allowAgenticRepoSelection: true,
					allowedConfigurationIds: ["cfg-1"],
				}),
				enrichmentJson: makeEnrichment(),
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			type: "failed",
			reason: "configuration_selection_failed",
		});
	});

	it("fails when LLM selector returns invalid response", async () => {
		mockSelectConfiguration.mockResolvedValueOnce({
			status: "failed",
			reason: "invalid_llm_response",
		});

		const result = await resolveTarget(
			{
				automation: makeAutomation({
					configSelectionStrategy: "agent_decide",
					allowAgenticRepoSelection: true,
					allowedConfigurationIds: ["cfg-1"],
				}),
				enrichmentJson: makeEnrichment(),
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			type: "failed",
			reason: "configuration_selection_failed",
		});
	});

	it("fails when LLM selector selects out-of-allowlist ID", async () => {
		mockSelectConfiguration.mockResolvedValueOnce({
			status: "failed",
			reason: "selected_id_not_in_eligible_set",
		});

		const result = await resolveTarget(
			{
				automation: makeAutomation({
					configSelectionStrategy: "agent_decide",
					allowAgenticRepoSelection: true,
					allowedConfigurationIds: ["cfg-1"],
				}),
				enrichmentJson: makeEnrichment(),
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			type: "failed",
			reason: "configuration_selection_failed",
		});
	});
});
