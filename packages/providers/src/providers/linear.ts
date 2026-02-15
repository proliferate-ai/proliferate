/**
 * Linear provider — AdapterActionSource implementation.
 *
 * Stateless: receives token as parameter, never resolves tokens directly.
 * Wraps the Linear GraphQL API with typed actions.
 */

import type { AdapterActionSource } from "../action-source";
import type { ActionResult } from "../types";

const LINEAR_API = "https://api.linear.app/graphql";

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

function requireParam(params: Record<string, unknown>, name: string): string {
	const value = params[name];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Missing required parameter: ${name}`);
	}
	return value;
}

async function execute(
	action: string,
	params: Record<string, unknown>,
	token: string,
): Promise<ActionResult> {
	const start = Date.now();
	try {
		let data: unknown;

		switch (action) {
			case "list_issues": {
				const filter: Record<string, unknown> = {};
				if (typeof params.teamId === "string") filter.team = { id: { eq: params.teamId } };
				if (typeof params.projectId === "string") filter.project = { id: { eq: params.projectId } };
				data = await linearQuery(
					`query ListIssues($first: Int, $after: String, $filter: IssueFilter) {
						issues(first: $first, after: $after, filter: $filter) {
							nodes { id identifier title state { name } assignee { name } priority createdAt updatedAt labels { nodes { name } } }
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
				const issueId = requireParam(params, "issueId");
				data = await linearQuery(
					`query GetIssue($id: String!) {
						issue(id: $id) {
							id identifier title description state { name } assignee { id name } priority
							labels { nodes { id name } } comments { nodes { id body createdAt user { name } } }
							createdAt updatedAt
						}
					}`,
					{ id: issueId },
					token,
				);
				break;
			}

			case "create_issue": {
				const teamId = requireParam(params, "teamId");
				const title = requireParam(params, "title");
				const input: Record<string, unknown> = { teamId, title };
				if (typeof params.description === "string") input.description = params.description;
				if (typeof params.assigneeId === "string") input.assigneeId = params.assigneeId;
				if (typeof params.stateId === "string") input.stateId = params.stateId;
				if (typeof params.priority === "number") input.priority = params.priority;
				if (Array.isArray(params.labelIds)) input.labelIds = params.labelIds;
				if (typeof params.projectId === "string") input.projectId = params.projectId;
				data = await linearQuery(
					`mutation CreateIssue($input: IssueCreateInput!) {
						issueCreate(input: $input) { success issue { id identifier title url } }
					}`,
					{ input },
					token,
				);
				break;
			}

			case "update_issue": {
				const issueId = requireParam(params, "issueId");
				const input: Record<string, unknown> = {};
				if (typeof params.title === "string") input.title = params.title;
				if (typeof params.description === "string") input.description = params.description;
				if (typeof params.assigneeId === "string") input.assigneeId = params.assigneeId;
				if (typeof params.stateId === "string") input.stateId = params.stateId;
				if (typeof params.priority === "number") input.priority = params.priority;
				data = await linearQuery(
					`mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
						issueUpdate(id: $id, input: $input) { success issue { id identifier title url state { name } } }
					}`,
					{ id: issueId, input },
					token,
				);
				break;
			}

			case "add_comment": {
				const issueId = requireParam(params, "issueId");
				const body = requireParam(params, "body");
				data = await linearQuery(
					`mutation AddComment($input: CommentCreateInput!) {
						commentCreate(input: $input) { success comment { id body createdAt } }
					}`,
					{ input: { issueId, body } },
					token,
				);
				break;
			}

			default:
				return { success: false, error: `Unknown Linear action: ${action}` };
		}

		return { success: true, data, durationMs: Date.now() - start };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - start,
		};
	}
}

export const linearSource: AdapterActionSource = {
	type: "adapter",
	id: "linear",
	displayName: "Linear",
	integration: "linear",
	actions: [
		{
			name: "list_issues",
			description: "List issues, optionally filtered by team or project",
			riskLevel: "read",
			params: [
				{ name: "teamId", type: "string", required: false, description: "Filter by team ID" },
				{
					name: "projectId",
					type: "string",
					required: false,
					description: "Filter by project ID",
				},
				{
					name: "first",
					type: "number",
					required: false,
					description: "Number of issues (max 50)",
				},
				{ name: "after", type: "string", required: false, description: "Pagination cursor" },
			],
		},
		{
			name: "get_issue",
			description: "Get a specific issue by ID or identifier (e.g. ENG-123)",
			riskLevel: "read",
			params: [
				{
					name: "issueId",
					type: "string",
					required: true,
					description: "Issue ID or identifier",
				},
			],
		},
		{
			name: "create_issue",
			description: "Create a new issue",
			riskLevel: "write",
			params: [
				{ name: "teamId", type: "string", required: true, description: "Team ID" },
				{ name: "title", type: "string", required: true, description: "Issue title" },
				{
					name: "description",
					type: "string",
					required: false,
					description: "Issue description (markdown)",
				},
				{
					name: "assigneeId",
					type: "string",
					required: false,
					description: "Assignee user ID",
				},
				{ name: "stateId", type: "string", required: false, description: "Workflow state ID" },
				{
					name: "priority",
					type: "number",
					required: false,
					description: "Priority (0=none, 1=urgent, 4=low)",
				},
				{
					name: "labelIds",
					type: "array",
					required: false,
					description: "Array of label IDs",
				},
				{ name: "projectId", type: "string", required: false, description: "Project ID" },
			],
		},
		{
			name: "update_issue",
			description: "Update an existing issue",
			riskLevel: "write",
			params: [
				{ name: "issueId", type: "string", required: true, description: "Issue ID" },
				{ name: "title", type: "string", required: false, description: "New title" },
				{ name: "description", type: "string", required: false, description: "New description" },
				{
					name: "assigneeId",
					type: "string",
					required: false,
					description: "Assignee user ID",
				},
				{ name: "stateId", type: "string", required: false, description: "Workflow state ID" },
				{ name: "priority", type: "number", required: false, description: "Priority (0-4)" },
			],
		},
		{
			name: "add_comment",
			description: "Add a comment to an issue",
			riskLevel: "write",
			params: [
				{ name: "issueId", type: "string", required: true, description: "Issue ID" },
				{
					name: "body",
					type: "string",
					required: true,
					description: "Comment body (markdown)",
				},
			],
		},
	],
	guide: `# Linear Integration
Create, read, and update Linear issues. Authentication is handled server-side.

## Actions
- **list_issues** (read): List issues by team or project
- **get_issue** (read): Get issue by ID or identifier (e.g. ENG-123)
- **create_issue** (write): Create a new issue
- **update_issue** (write): Update an existing issue
- **add_comment** (write): Add a comment to an issue`,
	execute,
};
