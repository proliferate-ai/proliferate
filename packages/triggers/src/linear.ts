/**
 * Linear Trigger Provider
 *
 * Supports both webhooks and polling for Linear issues.
 */

import type {
	LinearIssue,
	LinearTriggerConfig,
	LinearWebhookPayloadInternal,
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
 * Linear provider implementation
 */
export const LinearProvider: TriggerProvider<LinearTriggerConfig, PollState, LinearIssue> = {
	async poll(
		connection: OAuthConnection,
		config: LinearTriggerConfig,
		lastState: PollState | null,
	): Promise<PollResult<LinearIssue, PollState>> {
		// Build GraphQL query for issues
		const teamFilter = config.teamId ? `team: { id: { eq: "${config.teamId}" } }` : "";

		const query = `
			query RecentIssues($first: Int!, $after: String) {
				issues(
					first: $first
					after: $after
					orderBy: createdAt
					${teamFilter ? `filter: { ${teamFilter} }` : ""}
				) {
					pageInfo {
						hasNextPage
						endCursor
					}
					nodes {
						id
						number
						title
						description
						createdAt
						updatedAt
						url
						priority
						state { id name }
						labels { nodes { id name } }
						assignee { id name email }
						team { id name key }
						project { id name }
					}
				}
			}
		`;

		const accessToken = connection.accessToken;
		if (!accessToken) {
			throw new Error("Missing Linear access token");
		}

		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: accessToken,
			},
			body: JSON.stringify({
				query,
				variables: {
					first: 100,
					after: lastState?.cursor || null,
				},
			}),
		});

		if (!response.ok) {
			throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
		}

		const result = (await response.json()) as {
			data?: {
				issues?: {
					nodes: LinearIssue[];
					pageInfo: { hasNextPage: boolean; endCursor: string };
				};
			};
			errors?: Array<{ message: string }>;
		};

		if (result.errors?.length) {
			throw new Error(`Linear GraphQL error: ${result.errors[0].message}`);
		}

		const issues = result.data?.issues?.nodes || [];

		// Compute new state
		const maxTimestamp =
			issues.length > 0 ? issues[0].createdAt || null : lastState?.maxTimestamp || null;

		const newState: PollState = {
			maxTimestamp,
			seenIds: issues.slice(0, 100).map((i) => i.id),
			cursor: result.data?.issues?.pageInfo?.endCursor,
		};

		return { items: issues, newState };
	},

	findNewItems(items: LinearIssue[], lastState: PollState | null): LinearIssue[] {
		if (!lastState?.maxTimestamp) {
			// First poll: all items are new
			return items;
		}

		const lastTimestamp = new Date(lastState.maxTimestamp);

		return items.filter((item) => {
			if (!item.createdAt) return false;
			const itemTime = new Date(item.createdAt);
			// Also check seenIds to handle edge cases with identical timestamps
			return itemTime > lastTimestamp || !lastState.seenIds.includes(item.id);
		});
	},

	filter(item: LinearIssue, config: LinearTriggerConfig): boolean {
		// Team filter (may already be applied in poll query, but double-check)
		if (config.teamId && item.team?.id !== config.teamId) {
			return false;
		}

		// State filter
		if (config.stateFilters?.length) {
			const itemState = item.state?.name;
			if (!itemState || !config.stateFilters.includes(itemState)) {
				return false;
			}
		}

		// Priority filter
		if (config.priorityFilters?.length) {
			const itemPriority = item.priority ?? 4; // Default to low priority
			if (!config.priorityFilters.includes(itemPriority)) {
				return false;
			}
		}

		// Label filter (match ANY)
		if (config.labelFilters?.length) {
			const itemLabels = item.labels?.nodes?.map((l) => l.name) ?? [];
			if (!config.labelFilters.some((f) => itemLabels.includes(f))) {
				return false;
			}
		}

		// Assignee filter
		if (config.assigneeIds?.length) {
			if (!item.assignee?.id || !config.assigneeIds.includes(item.assignee.id)) {
				return false;
			}
		}

		// Project filter
		if (config.projectIds?.length) {
			if (!item.project?.id || !config.projectIds.includes(item.project.id)) {
				return false;
			}
		}

		return true;
	},

	parseContext(item: LinearIssue): ParsedEventContext {
		return {
			title: `Linear Issue: ${item.title || "Untitled"}`,
			description: item.description,
			linear: {
				issueId: item.id,
				issueNumber: item.number || 0,
				title: item.title || "",
				description: item.description,
				state: item.state?.name ?? "Unknown",
				priority: item.priority ?? 4,
				labels: item.labels?.nodes?.map((l) => l.name) ?? [],
				issueUrl: item.url || `https://linear.app/issue/${item.id}`,
				teamKey: item.team?.key,
			},
		};
	},

	async verifyWebhook(request: Request, secret: string, body: string): Promise<boolean> {
		const signature = request.headers.get("Linear-Signature");
		if (!signature) return false;

		const expected = await hmacSha256(secret, body);
		return signature === expected;
	},

	parseWebhook(payload: unknown): LinearIssue[] {
		const p = payload as LinearWebhookPayloadInternal;

		// Only process Issue events
		if (p.type !== "Issue") {
			return [];
		}

		// Don't trigger on deletes
		if (p.action === "remove") {
			return [];
		}

		// Return the issue data with action attached for filtering
		return [
			{
				...p.data,
				// Store action on the item for action filtering
				action: p.action,
			} as any,
		];
	},

	computeDedupKey(item: LinearIssue): string | null {
		// For Linear, dedupe on issue ID + action
		// The action is stored on the item by parseWebhook
		const action = (item as any).action || "create";
		return `linear:${item.id}:${action}`;
	},

	extractExternalId(item: LinearIssue): string {
		return item.id;
	},

	getEventType(item: LinearIssue): string {
		const action = (item as any).action || "create";
		return `Issue:${action}`;
	},
};

// Register the provider
registerProvider("linear", LinearProvider as TriggerProvider<unknown, unknown, unknown>);

// Helper to filter by action (for webhooks)
export function filterLinearByAction(
	item: LinearIssue,
	actionFilters?: ("create" | "update")[],
): boolean {
	if (!actionFilters?.length) return true;

	const action = (item as any).action || "create";
	return actionFilters.includes(action);
}

export default LinearProvider;
