import { describe, expect, it, vi } from "vitest";

const { mockRepoExists, mockFindManagedConfigurations } = vi.hoisted(() => ({
	mockRepoExists: vi.fn(),
	mockFindManagedConfigurations: vi.fn(),
}));

vi.mock("@proliferate/services", () => ({
	repos: {
		repoExists: mockRepoExists,
	},
	configurations: {
		findManagedConfigurations: mockFindManagedConfigurations,
	},
}));

import { beforeEach } from "vitest";
import { resolveTarget } from "./resolve-target";

beforeEach(() => {
	vi.clearAllMocks();
	mockFindManagedConfigurations.mockResolvedValue([]);
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
	it("returns default when selection is disabled", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: false }),
			enrichmentJson: makeEnrichment({ suggestedRepoId: "repo-1" }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			configurationId: "cfg-default",
			reason: "selection_disabled",
		});
		expect(mockRepoExists).not.toHaveBeenCalled();
		expect(mockFindManagedConfigurations).not.toHaveBeenCalled();
	});

	it("returns default when allowAgenticRepoSelection is null", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: null }),
			enrichmentJson: makeEnrichment({ suggestedRepoId: "repo-1" }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			configurationId: "cfg-default",
			reason: "selection_disabled",
		});
	});

	it("returns default when enrichmentJson is null", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: true }),
			enrichmentJson: null,
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			configurationId: "cfg-default",
			reason: "no_suggestion",
		});
	});

	it("returns default when enrichment has no suggestedRepoId", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: true }),
			enrichmentJson: makeEnrichment({ suggestedRepoId: null }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			configurationId: "cfg-default",
			reason: "no_suggestion",
		});
	});

	it("reuses existing managed configuration when one covers the repo", async () => {
		mockRepoExists.mockResolvedValueOnce(true);
		mockFindManagedConfigurations.mockResolvedValueOnce([
			{
				id: "cfg-managed-1",
				configurationRepos: [
					{ repo: { id: "repo-1", organizationId: "org-1", githubRepoName: "org/repo" } },
				],
			},
		]);

		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: true }),
			enrichmentJson: makeEnrichment({ suggestedRepoId: "repo-1" }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "selected",
			configurationId: "cfg-managed-1",
			reason: "enrichment_suggestion_reused",
			suggestedRepoId: "repo-1",
		});
		expect(mockRepoExists).toHaveBeenCalledWith("repo-1", "org-1");
	});

	it("creates new managed configuration when no existing one covers the repo", async () => {
		mockRepoExists.mockResolvedValueOnce(true);
		mockFindManagedConfigurations.mockResolvedValueOnce([]);

		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: true }),
			enrichmentJson: makeEnrichment({ suggestedRepoId: "repo-1" }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "selected",
			repoIds: ["repo-1"],
			reason: "enrichment_suggestion_new",
			suggestedRepoId: "repo-1",
		});
	});

	it("ignores managed configurations from a different org", async () => {
		mockRepoExists.mockResolvedValueOnce(true);
		mockFindManagedConfigurations.mockResolvedValueOnce([
			{
				id: "cfg-other-org",
				configurationRepos: [
					{ repo: { id: "repo-1", organizationId: "org-other", githubRepoName: "org/repo" } },
				],
			},
		]);

		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: true }),
			enrichmentJson: makeEnrichment({ suggestedRepoId: "repo-1" }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "selected",
			repoIds: ["repo-1"],
			reason: "enrichment_suggestion_new",
			suggestedRepoId: "repo-1",
		});
	});

	it("returns fallback when repo does not exist in org", async () => {
		mockRepoExists.mockResolvedValueOnce(false);

		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: true }),
			enrichmentJson: makeEnrichment({ suggestedRepoId: "repo-bad" }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "fallback",
			configurationId: "cfg-default",
			reason: "repo_not_found_or_wrong_org",
			suggestedRepoId: "repo-bad",
		});
		expect(mockFindManagedConfigurations).not.toHaveBeenCalled();
	});

	it("returns default when enrichment has wrong version", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: true }),
			enrichmentJson: { version: 99, suggestedRepoId: "repo-1" },
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			configurationId: "cfg-default",
			reason: "no_suggestion",
		});
	});

	it("returns default with undefined configurationId when automation is null", async () => {
		const result = await resolveTarget({
			automation: null,
			enrichmentJson: makeEnrichment({ suggestedRepoId: "repo-1" }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			configurationId: undefined,
			reason: "selection_disabled",
		});
	});

	it("returns default with undefined configurationId when defaultConfigurationId is null", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({
				allowAgenticRepoSelection: false,
				defaultConfigurationId: null,
			}),
			enrichmentJson: null,
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			configurationId: undefined,
			reason: "selection_disabled",
		});
	});

	it("handles non-object enrichmentJson gracefully", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: true }),
			enrichmentJson: "not-an-object",
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			configurationId: "cfg-default",
			reason: "no_suggestion",
		});
	});
});
