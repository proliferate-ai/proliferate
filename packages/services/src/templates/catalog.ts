/**
 * Automation template catalog.
 *
 * Hardcoded V1 templates served via API.
 * Each template encodes a complete, opinionated automation configuration.
 */

import type { AutomationTemplate } from "./types";

export const TEMPLATE_CATALOG: AutomationTemplate[] = [
	{
		id: "sentry-auto-fixer",
		name: "Sentry Auto-Fixer",
		description: "Auto-fix Sentry issues when they occur",
		longDescription:
			"Automatically analyzes Sentry error events, traces the root cause through your codebase, and creates a pull request with a fix. Filters to error-level and above by default.",
		icon: "bug",
		category: "bug-fixing",
		agentInstructions: [
			"You are an automated bug-fixing agent. A Sentry error event has been received.",
			"",
			"Your task:",
			"1. Analyze the error stacktrace and any related context from the Sentry event.",
			"2. Locate the relevant source files in the repository.",
			"3. Identify the root cause of the error.",
			"4. Implement a fix that addresses the root cause without breaking existing functionality.",
			"5. Create a pull request with your fix and a clear description of the change.",
			"",
			"Guidelines:",
			"- Focus on the root cause, not symptoms.",
			"- Keep changes minimal and focused on the fix.",
			"- Include relevant context from the Sentry event in the PR description.",
			"- If the fix requires changes across multiple files, explain why in the PR.",
			"- If you cannot determine a fix with confidence, describe the issue and your analysis instead.",
		].join("\n"),
		modelId: "claude-sonnet-4-20250514",
		triggers: [
			{
				provider: "sentry",
				triggerType: "webhook",
				config: {
					minLevel: "error",
				},
			},
		],
		enabledTools: {
			create_session: { enabled: true },
			slack_notify: { enabled: true },
		},
		requiredIntegrations: [
			{ provider: "sentry", reason: "Trigger source", required: true },
			{ provider: "github", reason: "Repository access and PR creation", required: true },
			{ provider: "slack", reason: "Run notifications", required: false },
		],
		requiresRepo: true,
	},

	{
		id: "linear-pr-drafter",
		name: "Linear PR Drafter",
		description: "Draft PRs when Linear issues move to In Progress",
		longDescription:
			"Watches for Linear issues that move to an In Progress state and automatically drafts a pull request with an implementation plan and initial code changes based on the issue description.",
		icon: "git-pull-request",
		category: "project-management",
		agentInstructions: [
			"You are an automated PR drafting agent. A Linear issue has moved to In Progress.",
			"",
			"Your task:",
			"1. Read the Linear issue title, description, and acceptance criteria carefully.",
			"2. Analyze the codebase to understand the relevant areas that need changes.",
			"3. Draft an implementation plan.",
			"4. Create an initial pull request with code changes that address the issue.",
			"5. Link the PR back to the Linear issue in the description.",
			"",
			"Guidelines:",
			"- Follow the existing code patterns and conventions in the repository.",
			"- Break large changes into clear, reviewable commits.",
			"- Include tests where appropriate.",
			"- The PR description should explain the approach and any decisions made.",
			"- If the issue is too large or ambiguous, draft the PR with a plan and partial implementation.",
		].join("\n"),
		modelId: "claude-sonnet-4-20250514",
		triggers: [
			{
				provider: "linear",
				triggerType: "webhook",
				config: {
					triggerOn: ["updated"],
					stateFilters: ["In Progress"],
				},
			},
		],
		enabledTools: {
			create_session: { enabled: true },
			create_linear_issue: { enabled: true },
			slack_notify: { enabled: true },
		},
		requiredIntegrations: [
			{ provider: "linear", reason: "Trigger source and issue tracking", required: true },
			{ provider: "github", reason: "Repository access and PR creation", required: true },
			{ provider: "slack", reason: "Run notifications", required: false },
		],
		requiresRepo: true,
	},

	{
		id: "github-issue-solver",
		name: "GitHub Issue Solver",
		description: "Automatically solve GitHub issues when they're opened",
		longDescription:
			"Listens for new GitHub issues (or issues with a specific label) and automatically investigates, implements a fix or feature, and opens a pull request.",
		icon: "circle-dot",
		category: "bug-fixing",
		agentInstructions: [
			"You are an automated issue-solving agent. A new GitHub issue has been created.",
			"",
			"Your task:",
			"1. Read the issue title, description, and any labels or comments.",
			"2. Investigate the codebase to understand the problem or requested feature.",
			"3. Implement a solution that addresses the issue.",
			"4. Create a pull request that closes the issue.",
			"",
			"Guidelines:",
			"- Reference the issue number in your PR (e.g., 'Closes #123').",
			"- Keep changes focused and minimal.",
			"- Add tests for bug fixes to prevent regressions.",
			"- If the issue is unclear, add a comment explaining what you found and your approach.",
			"- Follow existing code patterns and conventions.",
		].join("\n"),
		modelId: "claude-sonnet-4-20250514",
		triggers: [
			{
				provider: "github",
				triggerType: "webhook",
				config: {
					eventTypes: ["issues"],
					actions: ["opened", "labeled"],
				},
			},
		],
		enabledTools: {
			create_session: { enabled: true },
			slack_notify: { enabled: true },
		},
		requiredIntegrations: [
			{ provider: "github", reason: "Trigger source and PR creation", required: true },
			{ provider: "slack", reason: "Run notifications", required: false },
			{ provider: "linear", reason: "Issue tracking", required: false },
		],
		requiresRepo: true,
	},

	{
		id: "ci-failure-fixer",
		name: "CI Failure Fixer",
		description: "Auto-fix CI failures when checks fail",
		longDescription:
			"Monitors GitHub check runs and automatically investigates failures. Analyzes build logs, identifies the root cause, and creates a fix PR to get CI green again.",
		icon: "alert-triangle",
		category: "devops",
		agentInstructions: [
			"You are an automated CI failure fixing agent. A GitHub check run has failed.",
			"",
			"Your task:",
			"1. Examine the failed check run details and any available build logs.",
			"2. Identify what caused the failure (test failure, build error, lint issue, etc.).",
			"3. Locate the relevant source code and understand the failure.",
			"4. Implement a fix that resolves the CI failure.",
			"5. Create a pull request with the fix.",
			"",
			"Guidelines:",
			"- Prioritize getting CI green with minimal changes.",
			"- If a test is failing, fix the code, not the test (unless the test itself is wrong).",
			"- For lint failures, apply the required formatting/style fixes.",
			"- For build errors, fix type errors or missing imports.",
			"- Include the original error output in the PR description for context.",
		].join("\n"),
		modelId: "claude-sonnet-4-20250514",
		triggers: [
			{
				provider: "github",
				triggerType: "webhook",
				config: {
					eventTypes: ["check_run"],
					conclusions: ["failure"],
				},
			},
		],
		enabledTools: {
			create_session: { enabled: true },
			slack_notify: { enabled: true },
		},
		requiredIntegrations: [
			{ provider: "github", reason: "Trigger source and PR creation", required: true },
			{ provider: "slack", reason: "Run notifications", required: false },
		],
		requiresRepo: true,
	},
];

/**
 * Look up a template by ID.
 */
export function getTemplateById(id: string): AutomationTemplate | undefined {
	return TEMPLATE_CATALOG.find((t) => t.id === id);
}
