import type { Logger } from "@proliferate/logger";
import type { ManagerToolContext } from "../wake-cycle/types";
import { handleInvokeAction, handleListCapabilities } from "./handlers/actions";
import {
	handleCancelChild,
	handleInspectChild,
	handleListChildren,
	handleMessageChild,
	handleSpawnChildTask,
} from "./handlers/child-sessions";
import {
	handleCompleteRun,
	handleRequestApproval,
	handleSendNotification,
	handleSkipRun,
} from "./handlers/run-control";
import {
	handleGetSourceItem,
	handleListSourceBindings,
	handleReadSource,
} from "./handlers/source-reads";

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
		case "read_source":
			return handleReadSource(args, ctx, log);
		case "get_source_item":
			return handleGetSourceItem(args, ctx, log);
		case "list_source_bindings":
			return handleListSourceBindings(ctx, log);
		case "list_capabilities":
			return handleListCapabilities(ctx, log);
		case "invoke_action":
			return handleInvokeAction(args, ctx, log);
		case "send_notification":
			return handleSendNotification(args, ctx, log);
		case "request_approval":
			return handleRequestApproval(args, ctx, log);
		case "skip_run":
			return handleSkipRun(args, ctx, log);
		case "complete_run":
			return handleCompleteRun(args, ctx, log);
		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}
