export type AdapterProvider = "linear" | "sentry" | "jira" | "slack";

export interface ActionMeta {
	name: string;
	description: string;
	riskLevel: "read" | "write";
}

export interface AdapterMeta {
	integration: AdapterProvider;
	displayName: string;
	description: string;
	actions: ActionMeta[];
}

/**
 * Static frontend metadata for built-in action adapters.
 *
 * Mirrors provider action surfaces in packages/providers/src/providers/*
 * without execute logic.
 */
export const ACTION_ADAPTERS: AdapterMeta[] = [
	{
		integration: "linear",
		displayName: "Linear",
		description: "Create, read, and update Linear issues from sessions",
		actions: [
			{ name: "list_teams", description: "List teams and team IDs", riskLevel: "read" },
			{
				name: "list_projects",
				description: "List projects and project IDs, optionally by team",
				riskLevel: "read",
			},
			{
				name: "list_workflow_states",
				description: "List workflow states and state IDs",
				riskLevel: "read",
			},
			{ name: "list_users", description: "List users and assignee IDs", riskLevel: "read" },
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
			{
				name: "list_organizations",
				description: "List organizations available to your account",
				riskLevel: "read",
			},
			{
				name: "list_projects",
				description: "List projects globally or by organization",
				riskLevel: "read",
			},
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
	{
		integration: "slack",
		displayName: "Slack",
		description: "Post messages to connected Slack channels from sessions",
		actions: [
			{
				name: "list_channels",
				description: "List available Slack channels and channel IDs",
				riskLevel: "read",
			},
			{
				name: "post_message",
				description: "Post a message to a Slack channel",
				riskLevel: "write",
			},
		],
	},
	{
		integration: "jira",
		displayName: "Jira",
		description: "Create, read, and update Jira issues from sessions",
		actions: [
			{
				name: "list_sites",
				description: "List accessible Jira Cloud sites",
				riskLevel: "read",
			},
			{
				name: "list_projects",
				description: "List projects for a Jira site",
				riskLevel: "read",
			},
			{
				name: "list_issue_types",
				description: "List issue types, optionally scoped to a project",
				riskLevel: "read",
			},
			{
				name: "list_users",
				description: "Search users in a Jira site",
				riskLevel: "read",
			},
			{ name: "list_issues", description: "Search issues using JQL", riskLevel: "read" },
			{
				name: "get_issue",
				description: "Get a specific issue by key or ID",
				riskLevel: "read",
			},
			{ name: "create_issue", description: "Create a new issue", riskLevel: "write" },
			{ name: "update_issue", description: "Update an existing issue", riskLevel: "write" },
			{ name: "add_comment", description: "Add a comment to an issue", riskLevel: "write" },
		],
	},
];
