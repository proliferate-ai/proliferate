/**
 * Slack Event Handler Registry
 *
 * Defines handler interfaces and exports all handlers.
 */

import type { ServerMessage, SyncClient } from "@proliferate/gateway-clients";
import type { Logger } from "@proliferate/logger";
import type { SlackApiClient } from "../api";

/**
 * Context passed to Slack handlers
 */
export interface HandlerContext {
	client: SlackApiClient;
	slackClient: SlackApiClient; // Alias for backward compatibility
	syncClient: SyncClient;
	sessionId: string;
	appUrl: string;
	logger: Logger;
}

/**
 * Handler for tools that produce visible results in Slack
 */
export interface ToolHandler {
	/** Tool names this handler matches (empty = fallback) */
	tools: string[];
	/** Handle the tool result */
	handle(ctx: HandlerContext, toolName: string, result: string): Promise<void>;
}

/**
 * Handler for a specific event type
 */
export interface EventHandler<T extends ServerMessage = ServerMessage> {
	/**
	 * Handle the event
	 * @returns true if message processing should continue, false to stop
	 */
	handle(ctx: HandlerContext, event: T): Promise<boolean>;
}

// Export handlers
export { textPartCompleteHandler } from "./text";
export { verifyToolHandler } from "./verify";
export { defaultToolHandler } from "./default-tool";
export { todoWriteToolHandler } from "./todo";
