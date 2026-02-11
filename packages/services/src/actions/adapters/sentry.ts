/**
 * Sentry action adapter.
 *
 * Provides read/write actions against the Sentry API.
 * Docs: https://docs.sentry.io/api/
 */

import type { ActionAdapter, ActionDefinition } from "./types";

const SENTRY_API = "https://sentry.io/api/0";

const actions: ActionDefinition[] = [
	{
		name: "list_issues",
		description: "List issues for a project",
		riskLevel: "read",
		params: [
			{ name: "organization_slug", type: "string", required: true, description: "Sentry org slug" },
			{ name: "project_slug", type: "string", required: true, description: "Sentry project slug" },
			{ name: "query", type: "string", required: false, description: "Search query" },
		],
	},
	{
		name: "get_issue",
		description: "Get details of a specific issue",
		riskLevel: "read",
		params: [{ name: "issue_id", type: "string", required: true, description: "Sentry issue ID" }],
	},
	{
		name: "list_issue_events",
		description: "List events for a specific issue",
		riskLevel: "read",
		params: [{ name: "issue_id", type: "string", required: true, description: "Sentry issue ID" }],
	},
	{
		name: "get_event",
		description: "Get details of a specific event",
		riskLevel: "read",
		params: [
			{ name: "issue_id", type: "string", required: true, description: "Sentry issue ID" },
			{ name: "event_id", type: "string", required: true, description: "Sentry event ID" },
		],
	},
	{
		name: "update_issue",
		description: "Update an issue (resolve, assign, etc.)",
		riskLevel: "write",
		params: [
			{ name: "issue_id", type: "string", required: true, description: "Sentry issue ID" },
			{
				name: "status",
				type: "string",
				required: false,
				description: "resolved | unresolved | ignored",
			},
			{ name: "assignedTo", type: "string", required: false, description: "User to assign to" },
		],
	},
];

// ============================================
// HTTP Helper
// ============================================

async function sentryFetch(
	path: string,
	token: string,
	options?: { method?: string; body?: unknown },
): Promise<unknown> {
	const res = await fetch(`${SENTRY_API}${path}`, {
		method: options?.method ?? "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: options?.body ? JSON.stringify(options.body) : undefined,
		signal: AbortSignal.timeout(30_000),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Sentry API ${res.status}: ${text.slice(0, 200)}`);
	}

	return res.json();
}

/** URL-encode a path segment. */
function enc(s: string): string {
	return encodeURIComponent(s);
}

function requireParam(params: Record<string, unknown>, name: string): string {
	const value = params[name];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Missing required parameter: ${name}`);
	}
	return value;
}

// ============================================
// Execute
// ============================================

async function execute(
	action: string,
	params: Record<string, unknown>,
	token: string,
): Promise<unknown> {
	switch (action) {
		case "list_issues": {
			const org = requireParam(params, "organization_slug");
			const project = requireParam(params, "project_slug");
			const query = typeof params.query === "string" ? params.query : "";
			const qs = query ? `?query=${encodeURIComponent(query)}` : "";
			return sentryFetch(`/projects/${enc(org)}/${enc(project)}/issues/${qs}`, token);
		}

		case "get_issue": {
			const issueId = requireParam(params, "issue_id");
			return sentryFetch(`/issues/${enc(issueId)}/`, token);
		}

		case "list_issue_events": {
			const issueId = requireParam(params, "issue_id");
			return sentryFetch(`/issues/${enc(issueId)}/events/`, token);
		}

		case "get_event": {
			const issueId = requireParam(params, "issue_id");
			const eventId = requireParam(params, "event_id");
			return sentryFetch(`/issues/${enc(issueId)}/events/${enc(eventId)}/`, token);
		}

		case "update_issue": {
			const issueId = requireParam(params, "issue_id");
			const body: Record<string, unknown> = {};
			if (typeof params.status === "string") body.status = params.status;
			if (typeof params.assignedTo === "string") body.assignedTo = params.assignedTo;
			return sentryFetch(`/issues/${enc(issueId)}/`, token, { method: "PUT", body });
		}

		default:
			throw new Error(`Unknown Sentry action: ${action}`);
	}
}

export const sentryAdapter: ActionAdapter = {
	integration: "sentry",
	actions,
	execute,
};
