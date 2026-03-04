import type Anthropic from "@anthropic-ai/sdk";

export const MANAGER_TOOLS: Anthropic.Tool[] = [
	{
		name: "spawn_child_task",
		description:
			"Spawn a new child coding task session. The session inherits the coworker's repo and baseline settings. Returns the session ID.",
		input_schema: {
			type: "object" as const,
			properties: {
				title: {
					type: "string",
					description: "Short title describing the task",
				},
				instructions: {
					type: "string",
					description: "Detailed instructions for the coding agent",
				},
			},
			required: ["title", "instructions"],
		},
	},
	{
		name: "list_children",
		description: "List all child task sessions spawned during this run.",
		input_schema: {
			type: "object" as const,
			properties: {},
		},
	},
	{
		name: "inspect_child",
		description:
			"Get detailed status of a child task session including runtime status, operator status, outcome, and summary.",
		input_schema: {
			type: "object" as const,
			properties: {
				session_id: {
					type: "string",
					description: "The child session ID to inspect",
				},
			},
			required: ["session_id"],
		},
	},
	{
		name: "message_child",
		description: "Send a follow-up message to a running child task session.",
		input_schema: {
			type: "object" as const,
			properties: {
				session_id: {
					type: "string",
					description: "The child session ID to message",
				},
				content: {
					type: "string",
					description: "The message content to send",
				},
			},
			required: ["session_id", "content"],
		},
	},
	{
		name: "cancel_child",
		description: "Cancel a running child task session.",
		input_schema: {
			type: "object" as const,
			properties: {
				session_id: {
					type: "string",
					description: "The child session ID to cancel",
				},
			},
			required: ["session_id"],
		},
	},
	{
		name: "read_source",
		description:
			"Read data from a connected source binding (Sentry issues, Linear tickets, GitHub issues/PRs). Use list_source_bindings first to discover available bindings.",
		input_schema: {
			type: "object" as const,
			properties: {
				binding_id: {
					type: "string",
					description: "The binding ID to query (from list_source_bindings)",
				},
				cursor: {
					type: "string",
					description: "Pagination cursor from a previous query",
				},
				limit: {
					type: "number",
					description: "Max items to return (1-100, default 25)",
				},
			},
			required: ["binding_id"],
		},
	},
	{
		name: "get_source_item",
		description: "Get detailed information about a single source item by its reference ID.",
		input_schema: {
			type: "object" as const,
			properties: {
				binding_id: {
					type: "string",
					description: "The binding ID this item belongs to",
				},
				item_ref: {
					type: "string",
					description: "The source-specific item reference (e.g., issue ID)",
				},
			},
			required: ["binding_id", "item_ref"],
		},
	},
	{
		name: "list_source_bindings",
		description:
			"List all connected source bindings for this coworker. Returns binding IDs, source types (sentry/linear/github), and labels.",
		input_schema: {
			type: "object" as const,
			properties: {},
		},
	},
	{
		name: "list_capabilities",
		description: "List available action capabilities and their current permission modes.",
		input_schema: {
			type: "object" as const,
			properties: {},
		},
	},
	{
		name: "invoke_action",
		description:
			"Invoke an external action through the action boundary (e.g., create a Linear issue, post a Slack message). Actions may require approval.",
		input_schema: {
			type: "object" as const,
			properties: {
				integration: {
					type: "string",
					description:
						'The integration identifier (e.g., "linear", "sentry", "github", "connector:<id>")',
				},
				action: {
					type: "string",
					description: "The action ID to invoke",
				},
				params: {
					type: "object",
					description: "Action-specific parameters",
				},
			},
			required: ["integration", "action", "params"],
		},
	},
	{
		name: "send_notification",
		description:
			"Send a notification to the human operator (in-app and/or Slack). Use this for status updates, escalations, or when human attention is needed.",
		input_schema: {
			type: "object" as const,
			properties: {
				message: {
					type: "string",
					description: "The notification message",
				},
				severity: {
					type: "string",
					enum: ["info", "warning", "error"],
					description: "Notification severity level",
				},
			},
			required: ["message"],
		},
	},
	{
		name: "request_approval",
		description:
			"Pause execution and request human approval before proceeding with a significant action.",
		input_schema: {
			type: "object" as const,
			properties: {
				description: {
					type: "string",
					description: "What you want to do and why approval is needed",
				},
			},
			required: ["description"],
		},
	},
	{
		name: "skip_run",
		description:
			"Declare this run as no-action-needed. Use during triage when the wake event does not require any work.",
		input_schema: {
			type: "object" as const,
			properties: {
				reason: {
					type: "string",
					description: "Why no action is needed",
				},
			},
			required: ["reason"],
		},
	},
	{
		name: "complete_run",
		description:
			"Finalize this run with a summary. Call this after all child tasks are done or after orchestration is complete.",
		input_schema: {
			type: "object" as const,
			properties: {
				summary: {
					type: "string",
					description: "Summary of what was accomplished during this run",
				},
			},
			required: ["summary"],
		},
	},
];
