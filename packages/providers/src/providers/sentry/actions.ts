/**
 * Sentry action definitions — vNext provider format.
 *
 * Stateless module: receives token via ActionExecutionContext,
 * never imports Nango or reads DB directly.
 */

import { z } from "zod";
import type { ActionDefinition, ActionExecutionContext, ActionResult } from "../../types";

const SENTRY_API = "https://sentry.io/api/0";

// ============================================
// Action Definitions (Zod schemas)
// ============================================

export const actions: ActionDefinition[] = [
	{
		id: "list_issues",
		description: "List issues for a project",
		riskLevel: "read",
		params: z.object({
			organization_slug: z.string().describe("Sentry org slug"),
			project_slug: z.string().describe("Sentry project slug"),
			query: z.string().optional().describe("Search query"),
		}),
	},
	{
		id: "get_issue",
		description: "Get details of a specific issue",
		riskLevel: "read",
		params: z.object({
			issue_id: z.string().describe("Sentry issue ID"),
		}),
	},
	{
		id: "list_issue_events",
		description: "List events for a specific issue",
		riskLevel: "read",
		params: z.object({
			issue_id: z.string().describe("Sentry issue ID"),
		}),
	},
	{
		id: "get_event",
		description: "Get details of a specific event",
		riskLevel: "read",
		params: z.object({
			issue_id: z.string().describe("Sentry issue ID"),
			event_id: z.string().describe("Sentry event ID"),
		}),
	},
	{
		id: "update_issue",
		description: "Update an issue (resolve, assign, etc.)",
		riskLevel: "write",
		params: z.object({
			issue_id: z.string().describe("Sentry issue ID"),
			status: z.enum(["resolved", "unresolved", "ignored"]).optional().describe("New status"),
			assignedTo: z.string().optional().describe("User to assign to"),
		}),
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

function enc(s: string): string {
	return encodeURIComponent(s);
}

// ============================================
// Execute
// ============================================

export async function execute(
	actionId: string,
	params: Record<string, unknown>,
	ctx: ActionExecutionContext,
): Promise<ActionResult> {
	const token = ctx.token;
	const startMs = Date.now();

	try {
		let data: unknown;

		switch (actionId) {
			case "list_issues": {
				const org = params.organization_slug as string;
				const project = params.project_slug as string;
				const query = typeof params.query === "string" ? params.query : "";
				const qs = query ? `?query=${encodeURIComponent(query)}` : "";
				data = await sentryFetch(`/projects/${enc(org)}/${enc(project)}/issues/${qs}`, token);
				break;
			}

			case "get_issue": {
				const issueId = params.issue_id as string;
				data = await sentryFetch(`/issues/${enc(issueId)}/`, token);
				break;
			}

			case "list_issue_events": {
				const issueId = params.issue_id as string;
				data = await sentryFetch(`/issues/${enc(issueId)}/events/`, token);
				break;
			}

			case "get_event": {
				const issueId = params.issue_id as string;
				const eventId = params.event_id as string;
				data = await sentryFetch(`/issues/${enc(issueId)}/events/${enc(eventId)}/`, token);
				break;
			}

			case "update_issue": {
				const issueId = params.issue_id as string;
				const body: Record<string, unknown> = {};
				if (typeof params.status === "string") body.status = params.status;
				if (typeof params.assignedTo === "string") body.assignedTo = params.assignedTo;
				data = await sentryFetch(`/issues/${enc(issueId)}/`, token, {
					method: "PUT",
					body,
				});
				break;
			}

			default:
				return { success: false, error: `Unknown Sentry action: ${actionId}` };
		}

		return { success: true, data, durationMs: Date.now() - startMs };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - startMs,
		};
	}
}

// ============================================
// Guide
// ============================================

export const guide = `# Sentry Integration Guide

## Overview
Query and manage Sentry issues directly from the sandbox.
Authentication is handled server-side — no API keys needed.

## Available Actions

### list_issues (read)
List issues for a project, with optional search query.

### get_issue (read)
Get details of a specific issue by ID.

### list_issue_events (read)
List events for a specific issue.

### get_event (read)
Get details of a specific event.

### update_issue (write — requires approval)
Resolve, assign, or update an issue.

## Tips
- Read actions execute immediately.
- Write actions require approval unless your org has set them to "always allow".
- Use search queries like \`is:unresolved level:error\` to filter issues.
`;
