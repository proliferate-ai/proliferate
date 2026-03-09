/**
 * Pi Manager Tools Extension
 *
 * Registers manager tools so Pi can manage child coding sessions and repos
 * during coworker chat sessions. Auto-discovered by pi-acp from
 * ~/.pi/agent/extensions/.
 *
 * Environment variables consumed at runtime inside the sandbox:
 *   PROLIFERATE_GATEWAY_URL        — Gateway base URL
 *   PROLIFERATE_GATEWAY_AUTH_TOKEN  — Bearer token for control-plane API
 *   PROLIFERATE_MANAGER_SESSION_ID  — Session ID
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { executeToolViaGateway } from "./lib/gateway-client.js";
import { EmptyObj, Obj, OptStr, Str } from "./lib/schema.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "spawn_child_task",
		label: "Spawn Child Task",
		description:
			"Spawn a new child coding task session. The session inherits the coworker's repo and baseline settings unless a specific repo configurationId is provided. Returns the session ID.",
		parameters: Obj(
			{
				title: Str("Short title describing the task"),
				instructions: Str("Detailed instructions for the coding agent"),
				repo: OptStr(
					"configurationId for the target repo (from list_repos). If omitted, inherits the coworker's default repo.",
				),
			},
			["title", "instructions"],
		),
		async execute(_toolCallId: string, params: Record<string, unknown>) {
			const text = await executeToolViaGateway("spawn_child_task", params);
			return { content: [{ type: "text" as const, text }] };
		},
	});

	pi.registerTool({
		name: "list_children",
		label: "List Children",
		description: "List all child task sessions spawned by this coworker.",
		parameters: EmptyObj,
		async execute() {
			const text = await executeToolViaGateway("list_children", {});
			return { content: [{ type: "text" as const, text }] };
		},
	});

	pi.registerTool({
		name: "inspect_child",
		label: "Inspect Child",
		description:
			"Get detailed status of a child task session including runtime status, operator status, outcome, and summary. The child must be running — use wake_child first if it is paused.",
		parameters: Obj({ session_id: Str("The child session ID to inspect") }, ["session_id"]),
		async execute(_toolCallId: string, params: Record<string, unknown>) {
			const text = await executeToolViaGateway("inspect_child", params);
			return { content: [{ type: "text" as const, text }] };
		},
	});

	pi.registerTool({
		name: "message_child",
		label: "Message Child",
		description:
			"Send a follow-up message to a running child task session. The child must be running — use wake_child first if it is paused.",
		parameters: Obj(
			{
				session_id: Str("The child session ID to message"),
				content: Str("The message content to send"),
			},
			["session_id", "content"],
		),
		async execute(_toolCallId: string, params: Record<string, unknown>) {
			const text = await executeToolViaGateway("message_child", params);
			return { content: [{ type: "text" as const, text }] };
		},
	});

	pi.registerTool({
		name: "cancel_child",
		label: "Cancel Child",
		description: "Cancel a running child task session.",
		parameters: Obj({ session_id: Str("The child session ID to cancel") }, ["session_id"]),
		async execute(_toolCallId: string, params: Record<string, unknown>) {
			const text = await executeToolViaGateway("cancel_child", params);
			return { content: [{ type: "text" as const, text }] };
		},
	});

	pi.registerTool({
		name: "wake_child",
		label: "Wake Child",
		description:
			"Wake a paused child session by starting its sandbox. Required before inspect_child or message_child if the child is not running.",
		parameters: Obj({ session_id: Str("The child session ID to wake") }, ["session_id"]),
		async execute(_toolCallId: string, params: Record<string, unknown>) {
			const text = await executeToolViaGateway("wake_child", params);
			return { content: [{ type: "text" as const, text }] };
		},
	});

	pi.registerTool({
		name: "list_repos",
		label: "List Repos",
		description:
			"List all configured repos for the organization. Returns repo names, URLs, and configurationIds that can be passed to spawn_child_task.",
		parameters: EmptyObj,
		async execute() {
			const text = await executeToolViaGateway("list_repos", {});
			return { content: [{ type: "text" as const, text }] };
		},
	});
}
