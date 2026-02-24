/**
 * Jira Cloud action definitions — vNext provider format.
 *
 * Stateless module: receives token via ActionExecutionContext,
 * never imports Nango or reads DB directly.
 *
 * Uses the Atlassian Cloud REST API v3 via the platform proxy:
 *   https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...
 *
 * The cloudId (Atlassian site ID) is required for all operations.
 * Agents discover it via the list_sites action or through
 * session connection metadata.
 */

import { z } from "zod";
import type { ActionDefinition, ActionExecutionContext, ActionResult } from "../../types";

const ATLASSIAN_API = "https://api.atlassian.com";

// ============================================
// Action Definitions (Zod schemas)
// ============================================

export const actions: ActionDefinition[] = [
	{
		id: "list_sites",
		description: "List accessible Jira Cloud sites for the connected account",
		riskLevel: "read",
		params: z.object({}),
	},
	{
		id: "list_issues",
		description: "Search for issues using JQL",
		riskLevel: "read",
		params: z.object({
			cloud_id: z.string().describe("Atlassian Cloud site ID"),
			jql: z
				.string()
				.optional()
				.describe("JQL query string (e.g. 'project = PROJ AND status = Open')"),
			max_results: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("Maximum results to return (default 50)"),
			fields: z
				.string()
				.optional()
				.describe(
					"Comma-separated field names to include (default: summary,status,assignee,issuetype,priority,created,updated)",
				),
		}),
	},
	{
		id: "get_issue",
		description: "Get a specific issue by key or ID",
		riskLevel: "read",
		params: z.object({
			cloud_id: z.string().describe("Atlassian Cloud site ID"),
			issue_id_or_key: z.string().describe("Issue key (e.g. PROJ-123) or numeric ID"),
			fields: z.string().optional().describe("Comma-separated field names to include"),
		}),
	},
	{
		id: "create_issue",
		description: "Create a new Jira issue",
		riskLevel: "write",
		params: z.object({
			cloud_id: z.string().describe("Atlassian Cloud site ID"),
			project_key: z.string().describe("Project key (e.g. PROJ)"),
			issue_type: z.string().describe("Issue type name (e.g. Bug, Task, Story)"),
			summary: z.string().describe("Issue summary/title"),
			description: z
				.string()
				.optional()
				.describe("Issue description (plain text, converted to ADF)"),
			assignee_id: z.string().optional().describe("Atlassian account ID of the assignee"),
			priority: z.string().optional().describe("Priority name (e.g. High, Medium, Low)"),
			labels: z.array(z.string()).optional().describe("Labels to apply"),
			parent_key: z.string().optional().describe("Parent issue key for sub-tasks"),
		}),
	},
	{
		id: "update_issue",
		description: "Update an existing Jira issue",
		riskLevel: "write",
		params: z.object({
			cloud_id: z.string().describe("Atlassian Cloud site ID"),
			issue_id_or_key: z.string().describe("Issue key (e.g. PROJ-123) or numeric ID"),
			summary: z.string().optional().describe("New summary/title"),
			description: z.string().optional().describe("New description (plain text, converted to ADF)"),
			assignee_id: z.string().optional().describe("Atlassian account ID of the new assignee"),
			status: z
				.string()
				.optional()
				.describe("Transition to this status name (e.g. Done, In Progress)"),
			priority: z.string().optional().describe("New priority name"),
			labels: z.array(z.string()).optional().describe("Replace labels with this list"),
		}),
	},
	{
		id: "add_comment",
		description: "Add a comment to a Jira issue",
		riskLevel: "write",
		params: z.object({
			cloud_id: z.string().describe("Atlassian Cloud site ID"),
			issue_id_or_key: z.string().describe("Issue key (e.g. PROJ-123) or numeric ID"),
			body: z.string().describe("Comment text (plain text, converted to ADF)"),
		}),
	},
];

// ============================================
// HTTP Helper
// ============================================

async function jiraFetch(
	path: string,
	token: string,
	options?: { method?: string; body?: unknown },
): Promise<unknown> {
	const res = await fetch(`${ATLASSIAN_API}${path}`, {
		method: options?.method ?? "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: options?.body ? JSON.stringify(options.body) : undefined,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Jira API error ${res.status}: ${text}`);
	}

	// 204 No Content
	if (res.status === 204) return {};

	return res.json();
}

function jiraBase(cloudId: string): string {
	return `/ex/jira/${cloudId}/rest/api/3`;
}

/**
 * Convert plain text to Atlassian Document Format (ADF).
 * Jira v3 requires ADF for description and comment bodies.
 */
function textToAdf(text: string) {
	return {
		version: 1,
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text }],
			},
		],
	};
}

// ============================================
// Execute
// ============================================

export async function execute(
	actionId: string,
	params: Record<string, unknown>,
	ctx: ActionExecutionContext,
): Promise<ActionResult> {
	const startMs = Date.now();

	try {
		let data: unknown;

		switch (actionId) {
			case "list_sites": {
				data = await jiraFetch("/oauth/token/accessible-resources", ctx.token);
				break;
			}

			case "list_issues": {
				const { cloud_id, jql, max_results, fields } = params as {
					cloud_id: string;
					jql?: string;
					max_results?: number;
					fields?: string;
				};
				const base = jiraBase(cloud_id);
				const searchParams = new URLSearchParams();
				if (jql) searchParams.set("jql", jql);
				searchParams.set("maxResults", String(max_results ?? 50));
				searchParams.set(
					"fields",
					fields ?? "summary,status,assignee,issuetype,priority,created,updated",
				);
				const qs = searchParams.toString();
				data = await jiraFetch(`${base}/search?${qs}`, ctx.token);
				break;
			}

			case "get_issue": {
				const { cloud_id, issue_id_or_key, fields } = params as {
					cloud_id: string;
					issue_id_or_key: string;
					fields?: string;
				};
				const base = jiraBase(cloud_id);
				const qs = fields ? `?fields=${encodeURIComponent(fields)}` : "";
				data = await jiraFetch(
					`${base}/issue/${encodeURIComponent(issue_id_or_key)}${qs}`,
					ctx.token,
				);
				break;
			}

			case "create_issue": {
				const {
					cloud_id,
					project_key,
					issue_type,
					summary,
					description,
					assignee_id,
					priority,
					labels,
					parent_key,
				} = params as {
					cloud_id: string;
					project_key: string;
					issue_type: string;
					summary: string;
					description?: string;
					assignee_id?: string;
					priority?: string;
					labels?: string[];
					parent_key?: string;
				};

				const issueFields: Record<string, unknown> = {
					project: { key: project_key },
					issuetype: { name: issue_type },
					summary,
				};

				if (description) issueFields.description = textToAdf(description);
				if (assignee_id) issueFields.assignee = { accountId: assignee_id };
				if (priority) issueFields.priority = { name: priority };
				if (labels) issueFields.labels = labels;
				if (parent_key) issueFields.parent = { key: parent_key };

				const base = jiraBase(cloud_id);
				data = await jiraFetch(`${base}/issue`, ctx.token, {
					method: "POST",
					body: { fields: issueFields },
				});
				break;
			}

			case "update_issue": {
				const {
					cloud_id,
					issue_id_or_key,
					summary,
					description,
					assignee_id,
					status,
					priority,
					labels,
				} = params as {
					cloud_id: string;
					issue_id_or_key: string;
					summary?: string;
					description?: string;
					assignee_id?: string;
					status?: string;
					priority?: string;
					labels?: string[];
				};

				const base = jiraBase(cloud_id);

				// Handle status transition separately (requires finding transition ID)
				if (status) {
					const transitions = (await jiraFetch(
						`${base}/issue/${encodeURIComponent(issue_id_or_key)}/transitions`,
						ctx.token,
					)) as { transitions: Array<{ id: string; name: string }> };

					const transition = transitions.transitions.find(
						(t) => t.name.toLowerCase() === status.toLowerCase(),
					);
					if (transition) {
						await jiraFetch(
							`${base}/issue/${encodeURIComponent(issue_id_or_key)}/transitions`,
							ctx.token,
							{ method: "POST", body: { transition: { id: transition.id } } },
						);
					}
				}

				// Update other fields
				const updateFields: Record<string, unknown> = {};
				if (summary) updateFields.summary = summary;
				if (description) updateFields.description = textToAdf(description);
				if (assignee_id) updateFields.assignee = { accountId: assignee_id };
				if (priority) updateFields.priority = { name: priority };
				if (labels) updateFields.labels = labels;

				if (Object.keys(updateFields).length > 0) {
					await jiraFetch(`${base}/issue/${encodeURIComponent(issue_id_or_key)}`, ctx.token, {
						method: "PUT",
						body: { fields: updateFields },
					});
				}

				data = { key: issue_id_or_key, updated: true };
				break;
			}

			case "add_comment": {
				const { cloud_id, issue_id_or_key, body } = params as {
					cloud_id: string;
					issue_id_or_key: string;
					body: string;
				};
				const base = jiraBase(cloud_id);
				data = await jiraFetch(
					`${base}/issue/${encodeURIComponent(issue_id_or_key)}/comment`,
					ctx.token,
					{ method: "POST", body: { body: textToAdf(body) } },
				);
				break;
			}

			default:
				return {
					success: false,
					error: `Unknown Jira action: ${actionId}`,
					durationMs: Date.now() - startMs,
				};
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

export const guide = `# Jira Integration

## Authentication
This integration connects to Jira Cloud via OAuth 2.0 (Atlassian 3LO).
All actions require a \`cloud_id\` parameter identifying the Atlassian site.

## Discovery
Use \`list_sites\` first to discover available Jira Cloud sites and their IDs.

## Searching Issues
Use \`list_issues\` with a JQL query to find issues:
- \`project = PROJ\` — all issues in project PROJ
- \`assignee = currentUser() AND status != Done\` — your open issues
- \`project = PROJ AND issuetype = Bug AND priority = High\` — high-priority bugs

## Creating Issues
Use \`create_issue\` with at minimum: \`cloud_id\`, \`project_key\`, \`issue_type\`, and \`summary\`.

## Status Transitions
To change an issue's status, use \`update_issue\` with the \`status\` parameter set to
the target status name (e.g. "In Progress", "Done"). The integration will automatically
find and execute the appropriate workflow transition.
`;
