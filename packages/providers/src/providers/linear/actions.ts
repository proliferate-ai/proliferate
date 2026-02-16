/**
 * Linear action definitions — vNext provider format.
 *
 * Stateless module: receives token via ActionExecutionContext,
 * never imports Nango or reads DB directly.
 */

import { z } from "zod";
import type { ActionDefinition, ActionExecutionContext, ActionResult } from "../../types";

const LINEAR_API = "https://api.linear.app/graphql";

// ============================================
// Action Definitions (Zod schemas)
// ============================================

export const actions: ActionDefinition[] = [
	{
		id: "list_issues",
		description: "List issues, optionally filtered by team or project",
		riskLevel: "read",
		params: z.object({
			teamId: z.string().optional().describe("Filter by team ID"),
			projectId: z.string().optional().describe("Filter by project ID"),
			first: z.number().max(50).optional().describe("Number of issues (max 50)"),
			after: z.string().optional().describe("Pagination cursor"),
		}),
	},
	{
		id: "get_issue",
		description: "Get a specific issue by ID or identifier (e.g. ENG-123)",
		riskLevel: "read",
		params: z.object({
			issueId: z.string().describe("Issue ID or identifier"),
		}),
	},
	{
		id: "create_issue",
		description: "Create a new issue",
		riskLevel: "write",
		params: z.object({
			teamId: z.string().describe("Team ID"),
			title: z.string().describe("Issue title"),
			description: z.string().optional().describe("Issue description (markdown)"),
			assigneeId: z.string().optional().describe("Assignee user ID"),
			stateId: z.string().optional().describe("Workflow state ID"),
			priority: z.number().min(0).max(4).optional().describe("Priority (0=none, 1=urgent, 4=low)"),
			labelIds: z.array(z.string()).optional().describe("Array of label IDs"),
			projectId: z.string().optional().describe("Project ID"),
		}),
	},
	{
		id: "update_issue",
		description: "Update an existing issue",
		riskLevel: "write",
		params: z.object({
			issueId: z.string().describe("Issue ID"),
			title: z.string().optional().describe("New title"),
			description: z.string().optional().describe("New description"),
			assigneeId: z.string().optional().describe("Assignee user ID"),
			stateId: z.string().optional().describe("Workflow state ID"),
			priority: z.number().min(0).max(4).optional().describe("Priority (0-4)"),
		}),
	},
	{
		id: "add_comment",
		description: "Add a comment to an issue",
		riskLevel: "write",
		params: z.object({
			issueId: z.string().describe("Issue ID"),
			body: z.string().describe("Comment body (markdown)"),
		}),
	},
];

// ============================================
// GraphQL Helper
// ============================================

async function linearQuery(
	query: string,
	variables: Record<string, unknown>,
	token: string,
): Promise<unknown> {
	const res = await fetch(LINEAR_API, {
		method: "POST",
		headers: {
			Authorization: token,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(30_000),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Linear API ${res.status}: ${text.slice(0, 200)}`);
	}

	const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
	if (json.errors?.length) {
		throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
	}

	return json.data;
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
				const filter: Record<string, unknown> = {};
				if (typeof params.teamId === "string") filter.team = { id: { eq: params.teamId } };
				if (typeof params.projectId === "string") filter.project = { id: { eq: params.projectId } };
				data = await linearQuery(
					`query ListIssues($first: Int, $after: String, $filter: IssueFilter) {
						issues(first: $first, after: $after, filter: $filter) {
							nodes {
								id identifier title state { name } assignee { name } priority
								createdAt updatedAt labels { nodes { name } }
							}
							pageInfo { hasNextPage endCursor }
						}
					}`,
					{
						first: typeof params.first === "number" ? Math.min(params.first, 50) : 25,
						after: typeof params.after === "string" ? params.after : null,
						filter: Object.keys(filter).length > 0 ? filter : null,
					},
					token,
				);
				break;
			}

			case "get_issue": {
				const issueId = params.issueId as string;
				data = await linearQuery(
					`query GetIssue($id: String!) {
						issue(id: $id) {
							id identifier title description state { name }
							assignee { id name } priority
							labels { nodes { id name } }
							comments { nodes { id body createdAt user { name } } }
							createdAt updatedAt
						}
					}`,
					{ id: issueId },
					token,
				);
				break;
			}

			case "create_issue": {
				const input: Record<string, unknown> = {
					teamId: params.teamId,
					title: params.title,
				};
				if (typeof params.description === "string") input.description = params.description;
				if (typeof params.assigneeId === "string") input.assigneeId = params.assigneeId;
				if (typeof params.stateId === "string") input.stateId = params.stateId;
				if (typeof params.priority === "number") input.priority = params.priority;
				if (Array.isArray(params.labelIds)) input.labelIds = params.labelIds;
				if (typeof params.projectId === "string") input.projectId = params.projectId;
				data = await linearQuery(
					`mutation CreateIssue($input: IssueCreateInput!) {
						issueCreate(input: $input) {
							success
							issue { id identifier title url }
						}
					}`,
					{ input },
					token,
				);
				break;
			}

			case "update_issue": {
				const issueId = params.issueId as string;
				const input: Record<string, unknown> = {};
				if (typeof params.title === "string") input.title = params.title;
				if (typeof params.description === "string") input.description = params.description;
				if (typeof params.assigneeId === "string") input.assigneeId = params.assigneeId;
				if (typeof params.stateId === "string") input.stateId = params.stateId;
				if (typeof params.priority === "number") input.priority = params.priority;
				data = await linearQuery(
					`mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
						issueUpdate(id: $id, input: $input) {
							success
							issue { id identifier title url state { name } }
						}
					}`,
					{ id: issueId, input },
					token,
				);
				break;
			}

			case "add_comment": {
				const issueId = params.issueId as string;
				const body = params.body as string;
				data = await linearQuery(
					`mutation AddComment($input: CommentCreateInput!) {
						commentCreate(input: $input) {
							success
							comment { id body createdAt }
						}
					}`,
					{ input: { issueId, body } },
					token,
				);
				break;
			}

			default:
				return { success: false, error: `Unknown Linear action: ${actionId}` };
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

export const guide = `# Linear Integration Guide

## Overview
Create, read, and update Linear issues directly from the sandbox.
Authentication is handled server-side — no API keys needed.

## Available Actions

### list_issues (read)
List issues, optionally filtered by team or project.

### get_issue (read)
Get a specific issue by ID or identifier (e.g. ENG-123).

### create_issue (write — requires approval)
Create a new issue with team, title, description, assignee, labels, etc.

### update_issue (write — requires approval)
Update an existing issue's title, description, assignee, state, or priority.

### add_comment (write — requires approval)
Add a markdown comment to an issue.

## Tips
- Read actions execute immediately.
- Write actions require approval unless your org has set them to "always allow".
- Issue identifiers like \`ENG-123\` work anywhere an \`issueId\` is accepted.
`;
