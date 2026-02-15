import { describe, expect, it } from "vitest";
import { EnrichmentError, buildEnrichmentPayload, extractSourceUrl } from "./enrich";

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
			parsedContext: { title: "Fix login bug" },
			rawPayload: {},
			providerEventType: "Issue:create",
			externalEventId: "LIN-123",
			dedupKey: null,
		},
		trigger: {
			id: "trig-1",
			provider: "linear",
			name: "Linear Issues",
		},
		...overrides,
	} as Parameters<typeof buildEnrichmentPayload>[0];
}

describe("buildEnrichmentPayload", () => {
	it("builds payload from Linear context", () => {
		const ctx = makeContext({
			triggerEvent: {
				id: "evt-1",
				parsedContext: {
					title: "Fix login bug",
					description: "Users can't log in",
					relatedFiles: ["src/auth/login.ts"],
					suggestedRepoId: "repo-1",
					linear: {
						issueId: "abc",
						issueNumber: 42,
						title: "Fix login bug",
						state: "In Progress",
						priority: 1,
						labels: ["bug"],
						issueUrl: "https://linear.app/team/LIN-42",
						teamKey: "ENG",
					},
				},
				rawPayload: {},
				providerEventType: "Issue:create",
				externalEventId: "LIN-42",
				dedupKey: null,
			},
		});

		const result = buildEnrichmentPayload(ctx);

		expect(result.version).toBe(1);
		expect(result.provider).toBe("linear");
		expect(result.summary).toEqual({
			title: "Fix login bug",
			description: "Users can't log in",
		});
		expect(result.source).toEqual({
			url: "https://linear.app/team/LIN-42",
			externalId: "LIN-42",
			eventType: "Issue:create",
		});
		expect(result.relatedFiles).toEqual(["src/auth/login.ts"]);
		expect(result.suggestedRepoId).toBe("repo-1");
		expect(result.providerContext).toMatchObject({
			issueId: "abc",
			priority: 1,
			state: "In Progress",
		});
		expect(result.automationContext).toEqual({
			automationId: "auto-1",
			automationName: "Bug Fixer",
			hasLlmFilter: false,
			hasLlmAnalysis: false,
		});
	});

	it("builds payload from Sentry context", () => {
		const ctx = makeContext({
			trigger: { id: "trig-1", provider: "sentry", name: "Sentry Errors" },
			triggerEvent: {
				id: "evt-1",
				parsedContext: {
					title: "TypeError in handler",
					sentry: {
						errorType: "TypeError",
						errorMessage: "Cannot read property 'id'",
						issueUrl: "https://sentry.io/issues/123",
						environment: "production",
					},
				},
				rawPayload: {},
				providerEventType: "error",
				externalEventId: "SENTRY-123",
				dedupKey: null,
			},
		});

		const result = buildEnrichmentPayload(ctx);

		expect(result.provider).toBe("sentry");
		expect(result.source.url).toBe("https://sentry.io/issues/123");
		expect(result.providerContext).toMatchObject({
			errorType: "TypeError",
			errorMessage: "Cannot read property 'id'",
		});
	});

	it("builds payload from GitHub PR context", () => {
		const ctx = makeContext({
			trigger: { id: "trig-1", provider: "github", name: "GitHub PRs" },
			triggerEvent: {
				id: "evt-1",
				parsedContext: {
					title: "Add auth middleware",
					github: {
						eventType: "pull_request",
						action: "opened",
						repoFullName: "org/repo",
						repoUrl: "https://github.com/org/repo",
						prNumber: 99,
						prTitle: "Add auth middleware",
						prUrl: "https://github.com/org/repo/pull/99",
						prState: "open",
					},
				},
				rawPayload: {},
				providerEventType: "pull_request:opened",
				externalEventId: "GH-99",
				dedupKey: null,
			},
		});

		const result = buildEnrichmentPayload(ctx);

		expect(result.provider).toBe("github");
		expect(result.source.url).toBe("https://github.com/org/repo/pull/99");
	});

	it("builds payload from GitHub push context", () => {
		const ctx = makeContext({
			trigger: { id: "trig-1", provider: "github", name: "GitHub Push" },
			triggerEvent: {
				id: "evt-1",
				parsedContext: {
					title: "Push to main",
					github: {
						eventType: "push",
						repoFullName: "org/repo",
						repoUrl: "https://github.com/org/repo",
						branch: "main",
						compareUrl: "https://github.com/org/repo/compare/abc...def",
					},
				},
				rawPayload: {},
				providerEventType: "push",
				externalEventId: "push-abc",
				dedupKey: null,
			},
		});

		const result = buildEnrichmentPayload(ctx);

		expect(result.source.url).toBe("https://github.com/org/repo/compare/abc...def");
	});

	it("builds payload with minimal context (title only)", () => {
		const result = buildEnrichmentPayload(makeContext());

		expect(result.version).toBe(1);
		expect(result.summary.title).toBe("Fix login bug");
		expect(result.summary.description).toBeNull();
		expect(result.source.url).toBeNull();
		expect(result.relatedFiles).toEqual([]);
		expect(result.suggestedRepoId).toBeNull();
		expect(result.providerContext).toEqual({});
	});

	it("builds payload with no provider-specific block", () => {
		const ctx = makeContext({
			trigger: { id: "trig-1", provider: "custom", name: "Custom" },
			triggerEvent: {
				id: "evt-1",
				parsedContext: { title: "Custom event" },
				rawPayload: {},
				providerEventType: null,
				externalEventId: null,
				dedupKey: null,
			},
		});

		const result = buildEnrichmentPayload(ctx);

		expect(result.providerContext).toEqual({});
		expect(result.source.url).toBeNull();
		expect(result.source.externalId).toBeNull();
	});

	it("sets hasLlmFilter and hasLlmAnalysis from automation config", () => {
		const ctx = makeContext({
			automation: {
				id: "auto-1",
				name: "Smart Fixer",
				defaultConfigurationId: "pb-1",
				agentInstructions: null,
				modelId: null,
				notificationChannelId: null,
				notificationSlackInstallationId: null,
				enabledTools: null,
				llmFilterPrompt: "Only process bugs",
				llmAnalysisPrompt: "Analyze root cause",
			},
		});

		const result = buildEnrichmentPayload(ctx);

		expect(result.automationContext.hasLlmFilter).toBe(true);
		expect(result.automationContext.hasLlmAnalysis).toBe(true);
	});

	it("passes relatedFiles through", () => {
		const ctx = makeContext({
			triggerEvent: {
				id: "evt-1",
				parsedContext: {
					title: "Fix bug",
					relatedFiles: ["src/a.ts", "src/b.ts"],
				},
				rawPayload: {},
				providerEventType: null,
				externalEventId: null,
				dedupKey: null,
			},
		});

		const result = buildEnrichmentPayload(ctx);

		expect(result.relatedFiles).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("throws EnrichmentError for null parsedContext", () => {
		const ctx = makeContext({
			triggerEvent: {
				id: "evt-1",
				parsedContext: null,
				rawPayload: {},
				providerEventType: null,
				externalEventId: null,
				dedupKey: null,
			},
		});

		expect(() => buildEnrichmentPayload(ctx)).toThrow(EnrichmentError);
		expect(() => buildEnrichmentPayload(ctx)).toThrow("parsedContext is missing");
	});

	it("throws EnrichmentError for missing title", () => {
		const ctx = makeContext({
			triggerEvent: {
				id: "evt-1",
				parsedContext: { description: "no title here" },
				rawPayload: {},
				providerEventType: null,
				externalEventId: null,
				dedupKey: null,
			},
		});

		expect(() => buildEnrichmentPayload(ctx)).toThrow(EnrichmentError);
		expect(() => buildEnrichmentPayload(ctx)).toThrow("title is required");
	});
});

describe("extractSourceUrl", () => {
	it("returns linear issueUrl", () => {
		expect(
			extractSourceUrl({
				title: "t",
				linear: {
					issueId: "a",
					issueNumber: 1,
					title: "t",
					state: "s",
					priority: 1,
					issueUrl: "https://linear.app/x",
				},
			}),
		).toBe("https://linear.app/x");
	});

	it("returns sentry issueUrl", () => {
		expect(
			extractSourceUrl({
				title: "t",
				sentry: { errorType: "e", errorMessage: "m", issueUrl: "https://sentry.io/x" },
			}),
		).toBe("https://sentry.io/x");
	});

	it("prefers github issueUrl over prUrl", () => {
		expect(
			extractSourceUrl({
				title: "t",
				github: {
					eventType: "issues",
					repoFullName: "o/r",
					repoUrl: "u",
					issueUrl: "https://github.com/issue",
					prUrl: "https://github.com/pr",
				},
			}),
		).toBe("https://github.com/issue");
	});

	it("falls back to github prUrl when no issueUrl", () => {
		expect(
			extractSourceUrl({
				title: "t",
				github: {
					eventType: "pull_request",
					repoFullName: "o/r",
					repoUrl: "u",
					prUrl: "https://github.com/pr",
				},
			}),
		).toBe("https://github.com/pr");
	});

	it("returns posthog eventUrl", () => {
		expect(
			extractSourceUrl({ title: "t", posthog: { event: "e", eventUrl: "https://posthog.com/x" } }),
		).toBe("https://posthog.com/x");
	});

	it("returns null when no provider context", () => {
		expect(extractSourceUrl({ title: "t" })).toBeNull();
	});
});
