import type { Provider } from "@/components/integrations/provider-icon";

export interface ActionMeta {
	name: string;
	description: string;
	riskLevel: "read" | "write";
}

export interface AdapterMeta {
	integration: Provider;
	displayName: string;
	description: string;
	actions: ActionMeta[];
}

/**
 * Static frontend metadata for built-in action adapters.
 *
 * Mirrors the backend definitions in packages/services/src/actions/adapters/
 * but without execute logic. Only two adapters exist and their action lists
 * are stable, so the duplication cost is negligible.
 */
export const ACTION_ADAPTERS: AdapterMeta[] = [
	{
		integration: "linear",
		displayName: "Linear",
		description: "Create, read, and update Linear issues from sessions",
		actions: [
			{
				name: "list_issues",
				description: "List issues, optionally filtered by team or project",
				riskLevel: "read",
			},
			{
				name: "get_issue",
				description: "Get a specific issue by ID or identifier",
				riskLevel: "read",
			},
			{ name: "create_issue", description: "Create a new issue", riskLevel: "write" },
			{ name: "update_issue", description: "Update an existing issue", riskLevel: "write" },
			{ name: "add_comment", description: "Add a comment to an issue", riskLevel: "write" },
		],
	},
	{
		integration: "sentry",
		displayName: "Sentry",
		description: "Query and manage Sentry issues from sessions",
		actions: [
			{ name: "list_issues", description: "List issues for a project", riskLevel: "read" },
			{ name: "get_issue", description: "Get details of a specific issue", riskLevel: "read" },
			{
				name: "list_issue_events",
				description: "List events for a specific issue",
				riskLevel: "read",
			},
			{ name: "get_event", description: "Get details of a specific event", riskLevel: "read" },
			{
				name: "update_issue",
				description: "Update an issue (resolve, assign, etc.)",
				riskLevel: "write",
			},
		],
	},
];
