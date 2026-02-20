import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetConfigurationCandidates, mockFetch } = vi.hoisted(() => ({
	mockGetConfigurationCandidates: vi.fn(),
	mockFetch: vi.fn(),
}));

vi.mock("@proliferate/services", () => ({
	configurations: {
		getConfigurationCandidates: mockGetConfigurationCandidates,
	},
}));

vi.mock("@proliferate/environment/server", () => ({
	env: {
		LLM_PROXY_URL: "http://localhost:4000",
		LLM_PROXY_ADMIN_URL: null,
		LLM_PROXY_MASTER_KEY: "test-master-key",
	},
}));

// Mock global fetch
vi.stubGlobal("fetch", mockFetch);

const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	child: vi.fn().mockReturnThis(),
} as unknown as import("@proliferate/logger").Logger;

import {
	buildEnrichmentContext,
	buildSlackMessageContext,
	selectConfiguration,
} from "./configuration-selector";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("selectConfiguration", () => {
	const defaultCandidates = [
		{
			id: "cfg-1",
			name: "Frontend App",
			routingDescription: "React frontend application for the main website",
			repoNames: ["org/frontend"],
		},
		{
			id: "cfg-2",
			name: "Backend API",
			routingDescription: "Node.js API server",
			repoNames: ["org/backend"],
		},
	];

	function mockLLMResponse(content: string) {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					choices: [{ message: { content } }],
				}),
		});
	}

	it("selects configuration when LLM returns valid response", async () => {
		mockGetConfigurationCandidates.mockResolvedValueOnce(defaultCandidates);
		mockLLMResponse(
			JSON.stringify({
				configurationId: "cfg-1",
				rationale: "Frontend bug based on React component reference",
			}),
		);

		const result = await selectConfiguration(
			{
				allowedConfigurationIds: ["cfg-1", "cfg-2"],
				context: "Fix the React component rendering issue",
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			status: "selected",
			configurationId: "cfg-1",
			rationale: "Frontend bug based on React component reference",
		});
	});

	it("fails when no candidates have routing descriptions", async () => {
		mockGetConfigurationCandidates.mockResolvedValueOnce([
			{ id: "cfg-1", name: "App", routingDescription: null, repoNames: [] },
			{ id: "cfg-2", name: "API", routingDescription: "", repoNames: [] },
		]);

		const result = await selectConfiguration(
			{
				allowedConfigurationIds: ["cfg-1", "cfg-2"],
				context: "Some task",
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			status: "failed",
			reason: "no_eligible_candidates",
		});
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("fails when LLM returns invalid JSON", async () => {
		mockGetConfigurationCandidates.mockResolvedValueOnce(defaultCandidates);
		mockLLMResponse("I think you should use cfg-1");

		const result = await selectConfiguration(
			{
				allowedConfigurationIds: ["cfg-1", "cfg-2"],
				context: "Some task",
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			status: "failed",
			reason: "invalid_llm_response",
		});
	});

	it("fails when LLM selects a configuration not in eligible set", async () => {
		mockGetConfigurationCandidates.mockResolvedValueOnce(defaultCandidates);
		mockLLMResponse(
			JSON.stringify({
				configurationId: "cfg-unknown",
				rationale: "Selected unknown config",
			}),
		);

		const result = await selectConfiguration(
			{
				allowedConfigurationIds: ["cfg-1", "cfg-2"],
				context: "Some task",
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			status: "failed",
			reason: "selected_id_not_in_eligible_set",
		});
	});

	it("fails when LLM proxy returns error", async () => {
		mockGetConfigurationCandidates.mockResolvedValueOnce(defaultCandidates);
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			text: () => Promise.resolve("Internal Server Error"),
		});

		const result = await selectConfiguration(
			{
				allowedConfigurationIds: ["cfg-1", "cfg-2"],
				context: "Some task",
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result.status).toBe("failed");
		expect((result as { reason: string }).reason).toContain("llm_call_failed");
	});

	it("fails when LLM returns empty response", async () => {
		mockGetConfigurationCandidates.mockResolvedValueOnce(defaultCandidates);
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ choices: [{ message: { content: "" } }] }),
		});

		const result = await selectConfiguration(
			{
				allowedConfigurationIds: ["cfg-1", "cfg-2"],
				context: "Some task",
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			status: "failed",
			reason: "empty_llm_response",
		});
	});

	it("handles LLM response wrapped in markdown code fences", async () => {
		mockGetConfigurationCandidates.mockResolvedValueOnce(defaultCandidates);
		mockLLMResponse('```json\n{"configurationId": "cfg-2", "rationale": "API server match"}\n```');

		const result = await selectConfiguration(
			{
				allowedConfigurationIds: ["cfg-1", "cfg-2"],
				context: "Fix the REST endpoint",
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result).toEqual({
			status: "selected",
			configurationId: "cfg-2",
			rationale: "API server match",
		});
	});

	it("filters out candidates without routing descriptions", async () => {
		mockGetConfigurationCandidates.mockResolvedValueOnce([
			{
				id: "cfg-1",
				name: "Frontend",
				routingDescription: "React frontend",
				repoNames: ["org/frontend"],
			},
			{
				id: "cfg-2",
				name: "Backend",
				routingDescription: null,
				repoNames: ["org/backend"],
			},
		]);
		mockLLMResponse(
			JSON.stringify({
				configurationId: "cfg-1",
				rationale: "Only eligible candidate",
			}),
		);

		const result = await selectConfiguration(
			{
				allowedConfigurationIds: ["cfg-1", "cfg-2"],
				context: "Some task",
				organizationId: "org-1",
			},
			mockLogger,
		);

		expect(result.status).toBe("selected");
		// Verify the LLM was called — cfg-2 excluded from prompt
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});

describe("buildEnrichmentContext", () => {
	it("builds context from enrichment payload", () => {
		const context = buildEnrichmentContext({
			summary: { title: "Fix auth bug", description: "Login fails on mobile" },
			source: { eventType: "issue.created", url: "https://linear.app/issue/1" },
			provider: "linear",
			relatedFiles: ["src/auth.ts", "src/login.tsx"],
		});

		expect(context).toContain("Title: Fix auth bug");
		expect(context).toContain("Description: Login fails on mobile");
		expect(context).toContain("Event type: issue.created");
		expect(context).toContain("Provider: linear");
		expect(context).toContain("src/auth.ts");
	});

	it("handles null/undefined enrichment", () => {
		expect(buildEnrichmentContext(null)).toBe("No enrichment context available.");
		expect(buildEnrichmentContext(undefined)).toBe("No enrichment context available.");
	});

	it("handles empty enrichment", () => {
		expect(buildEnrichmentContext({})).toBe("No enrichment context available.");
	});
});

describe("buildSlackMessageContext", () => {
	it("builds context from Slack message", () => {
		const context = buildSlackMessageContext("Fix the login page", "#engineering");

		expect(context).toContain("Slack channel: #engineering");
		expect(context).toContain("Message: Fix the login page");
	});

	it("handles missing channel name", () => {
		const context = buildSlackMessageContext("Hello");
		expect(context).toBe("Message: Hello");
	});
});
