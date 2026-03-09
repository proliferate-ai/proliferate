import type { Logger } from "@proliferate/logger";
import {
	handleCancelChild,
	handleInspectChild,
	handleListChildren,
	handleMessageChild,
	handleSpawnChildTask,
	handleWakeChild,
} from "./handlers/child-sessions";
import { handleListRepos } from "./handlers/repos";
import type { ManagerToolContext } from "./types";

export async function executeManagerTool(
	name: string,
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	switch (name) {
		case "spawn_child_task":
			return handleSpawnChildTask(args, ctx, log);
		case "list_children":
			return handleListChildren(ctx, log);
		case "inspect_child":
			return handleInspectChild(args, ctx, log);
		case "message_child":
			return handleMessageChild(args, ctx, log);
		case "cancel_child":
			return handleCancelChild(args, ctx, log);
		case "wake_child":
			return handleWakeChild(args, ctx, log);
		case "list_repos":
			return handleListRepos(ctx, log);
		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}
