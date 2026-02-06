/**
 * Text Part Complete Handler
 *
 * Posts completed text segments to Slack, converting markdown to mrkdwn.
 */

import type { TextPartCompleteMessage } from "@proliferate/gateway-clients";
import { slackifyMarkdown } from "slackify-markdown";
import type { EventHandler, HandlerContext } from "./index";

export const textPartCompleteHandler: EventHandler<TextPartCompleteMessage> = {
	async handle(ctx: HandlerContext, event: TextPartCompleteMessage): Promise<boolean> {
		const text = event.payload.text?.trim();
		if (!text) return true;

		console.log(`[SlackHandler:text] Posting ${text.length} chars`);
		const slackText = slackifyMarkdown(text);
		await ctx.slackClient.postMessage(slackText);

		return true; // Continue processing
	},
};
