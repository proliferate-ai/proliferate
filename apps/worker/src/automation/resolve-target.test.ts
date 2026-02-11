import { describe, expect, it, vi } from "vitest";

const { mockRepoExists, mockFindManagedPrebuilds } = vi.hoisted(() => ({
	mockRepoExists: vi.fn(),
	mockFindManagedPrebuilds: vi.fn(),
}));

vi.mock("@proliferate/services", () => ({
	repos: {
		repoExists: mockRepoExists,
	},
	prebuilds: {
		findManagedPrebuilds: mockFindManagedPrebuilds,
	},
}));

import { beforeEach } from "vitest";
import { resolveTarget } from "./resolve-target";

beforeEach(() => {
	vi.clearAllMocks();
	mockFindManagedPrebuilds.mockResolvedValue([]);
});

function makeAutomation(overrides: Record<string, unknown> = {}) {
	return {
		id: "auto-1",
		name: "Bug Fixer",
		defaultPrebuildId: "pb-default",
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
			prebuildId: "pb-default",
			reason: "selection_disabled",
		});
		expect(mockRepoExists).not.toHaveBeenCalled();
		expect(mockFindManagedPrebuilds).not.toHaveBeenCalled();
	});

	it("returns default when allowAgenticRepoSelection is null", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: null }),
			enrichmentJson: makeEnrichment({ suggestedRepoId: "repo-1" }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			prebuildId: "pb-default",
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
			prebuildId: "pb-default",
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
			prebuildId: "pb-default",
			reason: "no_suggestion",
		});
	});

	it("reuses existing managed prebuild when one covers the repo", async () => {
		mockRepoExists.mockResolvedValueOnce(true);
		mockFindManagedPrebuilds.mockResolvedValueOnce([
			{
				id: "pb-managed-1",
				snapshotId: "snap-1",
				prebuildRepos: [
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
			prebuildId: "pb-managed-1",
			reason: "enrichment_suggestion_reused",
			suggestedRepoId: "repo-1",
		});
		expect(mockRepoExists).toHaveBeenCalledWith("repo-1", "org-1");
	});

	it("creates new managed prebuild when no existing one covers the repo", async () => {
		mockRepoExists.mockResolvedValueOnce(true);
		mockFindManagedPrebuilds.mockResolvedValueOnce([]);

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

	it("ignores managed prebuilds from a different org", async () => {
		mockRepoExists.mockResolvedValueOnce(true);
		mockFindManagedPrebuilds.mockResolvedValueOnce([
			{
				id: "pb-other-org",
				snapshotId: "snap-1",
				prebuildRepos: [
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
			prebuildId: "pb-default",
			reason: "repo_not_found_or_wrong_org",
			suggestedRepoId: "repo-bad",
		});
		expect(mockFindManagedPrebuilds).not.toHaveBeenCalled();
	});

	it("returns default when enrichment has wrong version", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({ allowAgenticRepoSelection: true }),
			enrichmentJson: { version: 99, suggestedRepoId: "repo-1" },
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			prebuildId: "pb-default",
			reason: "no_suggestion",
		});
	});

	it("returns default with undefined prebuildId when automation is null", async () => {
		const result = await resolveTarget({
			automation: null,
			enrichmentJson: makeEnrichment({ suggestedRepoId: "repo-1" }),
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			prebuildId: undefined,
			reason: "selection_disabled",
		});
	});

	it("returns default with undefined prebuildId when defaultPrebuildId is null", async () => {
		const result = await resolveTarget({
			automation: makeAutomation({
				allowAgenticRepoSelection: false,
				defaultPrebuildId: null,
			}),
			enrichmentJson: null,
			organizationId: "org-1",
		});

		expect(result).toEqual({
			type: "default",
			prebuildId: undefined,
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
			prebuildId: "pb-default",
			reason: "no_suggestion",
		});
	});
});
