/**
 * GitHub Trigger Provider
 *
 * Supports webhooks for GitHub events via Nango forwarding.
 * Handles: issues, pull_request, check_suite, check_run, push, workflow_run
 */

import type {
	GitHubItem,
	GitHubTriggerConfig,
	GitHubWebhookPayload,
	OAuthConnection,
	ParsedEventContext,
	PollResult,
	PollState,
	TriggerProvider,
} from "./types";
import { registerProvider } from "./types";

/**
 * HMAC-SHA256 helper for webhook verification
 */
async function hmacSha256(secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return Array.from(new Uint8Array(signatureBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * GitHub provider implementation
 */
export const GitHubProvider: TriggerProvider<GitHubTriggerConfig, PollState, GitHubItem> = {
	async poll(
		_connection: OAuthConnection,
		_config: GitHubTriggerConfig,
		_lastState: PollState | null,
	): Promise<PollResult<GitHubItem, PollState>> {
		// GitHub triggers are webhook-only via Nango
		throw new Error("GitHub triggers only support webhooks, not polling");
	},

	findNewItems(items: GitHubItem[], _lastState: PollState | null): GitHubItem[] {
		// For webhooks, all items are new
		return items;
	},

	filter(item: GitHubItem, config: GitHubTriggerConfig): boolean {
		// Event type filter
		if (config.eventTypes?.length) {
			if (!config.eventTypes.includes(item.eventType)) {
				return false;
			}
		}

		// Action filter (e.g., "opened", "closed", "merged")
		if (config.actionFilters?.length) {
			if (!item.action || !config.actionFilters.includes(item.action)) {
				return false;
			}
		}

		// Branch filter (for push, pull_request)
		if (config.branchFilters?.length && item.branch) {
			if (!config.branchFilters.some((b) => item.branch?.includes(b))) {
				return false;
			}
		}

		// Label filter (for issues, pull_request)
		if (config.labelFilters?.length && item.labels) {
			if (!config.labelFilters.some((l) => item.labels?.includes(l))) {
				return false;
			}
		}

		// Repository filter
		if (config.repoFilters?.length && item.repoFullName) {
			if (!config.repoFilters.includes(item.repoFullName)) {
				return false;
			}
		}

		// Workflow conclusion filter (for workflow_run, check_suite)
		if (config.conclusionFilters?.length && item.conclusion) {
			// Cast to the expected type since we're checking it exists
			const conclusion = item.conclusion as (typeof config.conclusionFilters)[number];
			if (!config.conclusionFilters.includes(conclusion)) {
				return false;
			}
		}

		return true;
	},

	parseContext(item: GitHubItem): ParsedEventContext {
		const baseContext: ParsedEventContext = {
			title: item.title || `GitHub ${item.eventType}: ${item.action || "event"}`,
			description: item.body,
			relatedFiles: item.relatedFiles,
			github: {
				eventType: item.eventType,
				action: item.action,
				repoFullName: item.repoFullName || "",
				repoUrl: item.repoUrl || "",
				sender: item.sender,
				// Issue fields
				issueNumber: item.issueNumber,
				issueTitle: item.issueTitle,
				issueBody: item.issueBody,
				issueUrl: item.issueUrl,
				issueState: item.issueState,
				labels: item.labels,
				// PR fields
				prNumber: item.prNumber,
				prTitle: item.prTitle,
				prBody: item.prBody,
				prUrl: item.prUrl,
				prState: item.prState,
				baseBranch: item.baseBranch,
				headBranch: item.headBranch,
				isDraft: item.isDraft,
				isMerged: item.isMerged,
				// Push fields
				branch: item.branch,
				commits: item.commits,
				compareUrl: item.compareUrl,
				// Check/workflow fields
				checkName: item.checkName,
				conclusion: item.conclusion,
				workflowName: item.workflowName,
				workflowUrl: item.workflowUrl,
				// Error details (for check failures)
				errorMessage: item.errorMessage,
				errorDetails: item.errorDetails,
			},
		};

		return baseContext;
	},

	async verifyWebhook(request: Request, secret: string, body: string): Promise<boolean> {
		// GitHub uses X-Hub-Signature-256 header with sha256=<signature> format
		const signature = request.headers.get("X-Hub-Signature-256");
		if (!signature) return false;

		const expected = `sha256=${await hmacSha256(secret, body)}`;
		return signature === expected;
	},

	parseWebhook(payload: unknown): GitHubItem[] {
		const p = payload as GitHubWebhookPayload;

		// Determine event type from payload structure
		const items: GitHubItem[] = [];

		// Issue events
		if ("issue" in p && p.issue && !("pull_request" in p)) {
			const issue = p.issue;
			items.push({
				id: `issue-${issue.id}`,
				eventType: "issues",
				action: p.action,
				title: `Issue #${issue.number}: ${issue.title}`,
				body: issue.body || undefined,
				repoFullName: p.repository?.full_name,
				repoUrl: p.repository?.html_url,
				sender: p.sender?.login,
				issueNumber: issue.number,
				issueTitle: issue.title,
				issueBody: issue.body || undefined,
				issueUrl: issue.html_url,
				issueState: issue.state,
				labels: issue.labels?.map((l: { name: string }) => l.name) || [],
			});
		}

		// Pull request events
		if ("pull_request" in p && p.pull_request) {
			const pr = p.pull_request;
			items.push({
				id: `pr-${pr.id}`,
				eventType: "pull_request",
				action: p.action,
				title: `PR #${pr.number}: ${pr.title}`,
				body: pr.body || undefined,
				repoFullName: p.repository?.full_name,
				repoUrl: p.repository?.html_url,
				sender: p.sender?.login,
				prNumber: pr.number,
				prTitle: pr.title,
				prBody: pr.body || undefined,
				prUrl: pr.html_url,
				prState: pr.state,
				baseBranch: pr.base?.ref,
				headBranch: pr.head?.ref,
				isDraft: pr.draft,
				isMerged: pr.merged,
				labels: pr.labels?.map((l: { name: string }) => l.name) || [],
				relatedFiles: pr.changed_files ? [`${pr.changed_files} files changed`] : undefined,
			});
		}

		// Push events
		if ("commits" in p && p.ref && !("check_suite" in p)) {
			const branch = p.ref?.replace("refs/heads/", "") || "";
			const commits = p.commits || [];
			items.push({
				id: `push-${p.after || Date.now()}`,
				eventType: "push",
				action: "push",
				title: `Push to ${branch}: ${commits.length} commit(s)`,
				body: commits.map((c: { message: string }) => c.message).join("\n"),
				repoFullName: p.repository?.full_name,
				repoUrl: p.repository?.html_url,
				sender: p.sender?.login || p.pusher?.name,
				branch,
				commits: commits.map((c: { id: string; message: string; author?: { name: string } }) => ({
					sha: c.id,
					message: c.message,
					author: c.author?.name,
				})),
				compareUrl: p.compare,
				relatedFiles: commits.flatMap(
					(c: { added?: string[]; modified?: string[]; removed?: string[] }) => [
						...(c.added || []),
						...(c.modified || []),
						...(c.removed || []),
					],
				),
			});
		}

		// Check suite events
		if ("check_suite" in p && p.check_suite) {
			const suite = p.check_suite;
			items.push({
				id: `check-suite-${suite.id}`,
				eventType: "check_suite",
				action: p.action,
				title: `Check Suite ${suite.conclusion || suite.status}`,
				repoFullName: p.repository?.full_name,
				repoUrl: p.repository?.html_url,
				sender: p.sender?.login,
				branch: suite.head_branch,
				conclusion: suite.conclusion ?? undefined,
				checkName: suite.app?.name || "Check Suite",
			});
		}

		// Check run events
		if ("check_run" in p && p.check_run) {
			const run = p.check_run;
			items.push({
				id: `check-run-${run.id}`,
				eventType: "check_run",
				action: p.action,
				title: `Check Run: ${run.name} - ${run.conclusion || run.status}`,
				repoFullName: p.repository?.full_name,
				repoUrl: p.repository?.html_url,
				sender: p.sender?.login,
				branch: run.check_suite?.head_branch,
				conclusion: run.conclusion ?? undefined,
				checkName: run.name,
				errorMessage: run.output?.title ?? undefined,
				errorDetails: run.output?.summary ?? undefined,
			});
		}

		// Workflow run events
		if ("workflow_run" in p && p.workflow_run) {
			const run = p.workflow_run;
			items.push({
				id: `workflow-run-${run.id}`,
				eventType: "workflow_run",
				action: p.action,
				title: `Workflow: ${run.name} - ${run.conclusion || run.status}`,
				repoFullName: p.repository?.full_name,
				repoUrl: p.repository?.html_url,
				sender: p.sender?.login || run.actor?.login,
				branch: run.head_branch,
				conclusion: run.conclusion ?? undefined,
				workflowName: run.name,
				workflowUrl: run.html_url,
			});
		}

		return items;
	},

	computeDedupKey(item: GitHubItem): string | null {
		// Dedupe on item ID + action
		return `github:${item.id}:${item.action || "event"}`;
	},

	extractExternalId(item: GitHubItem): string {
		return item.id;
	},

	getEventType(item: GitHubItem): string {
		return `${item.eventType}:${item.action || "event"}`;
	},
};

// Register the provider
registerProvider("github", GitHubProvider as TriggerProvider<unknown, unknown, unknown>);

export default GitHubProvider;
