/**
 * Default Tool Handler
 *
 * Fallback handler for tools that don't have specific handlers.
 * Posts tool result in a code block.
 */

import type { HandlerContext, ToolHandler } from "./index";

const MAX_RESULT_LENGTH = 2000;

export const defaultToolHandler: ToolHandler = {
	tools: [], // Empty = matches all tools as fallback

	async handle(ctx: HandlerContext, toolName: string, result: string): Promise<void> {
		const truncatedResult =
			result.length > MAX_RESULT_LENGTH ? `${result.slice(0, MAX_RESULT_LENGTH)}...` : result;

		const message = `*Tool: ${toolName}*\n\`\`\`\n${truncatedResult}\n\`\`\``;
		await ctx.slackClient.postMessage(message);
	},
};
