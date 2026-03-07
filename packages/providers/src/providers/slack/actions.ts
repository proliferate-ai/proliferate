/**
 * Slack action definitions — vNext provider format.
 *
 * Stateless module: receives bot token via ActionExecutionContext,
 * never imports Slack SDK or reads DB directly.
 */

import { z } from "zod";
import type { ActionDefinition, ActionExecutionContext, ActionResult } from "../../types";

const SLACK_API = "https://slack.com/api";

// ============================================
// Action Definitions (Zod schemas)
// ============================================

export const actions: ActionDefinition[] = [
	{
		id: "list_channels",
		description: "List available Slack channels",
		riskLevel: "read",
		params: z.object({
			cursor: z.string().optional().describe("Slack pagination cursor from a previous response"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(200)
				.optional()
				.describe("Max number of channels to return (default 100)"),
		}),
	},
	{
		id: "post_message",
		description: "Post a message to a Slack channel",
		riskLevel: "write",
		params: z.object({
			channel: z.string().describe("Channel ID (e.g. C01234567)"),
			text: z.string().describe("Message text (supports Slack mrkdwn)"),
			thread_ts: z.string().optional().describe("Thread timestamp to reply to"),
		}),
	},
];

// ============================================
// Execute
// ============================================

export async function execute(
	actionId: string,
	params: Record<string, unknown>,
	ctx: ActionExecutionContext,
): Promise<ActionResult> {
	const token = ctx.token;
	const startMs = Date.now();

	try {
		switch (actionId) {
			case "list_channels": {
				const query = new URLSearchParams({
					limit: typeof params.limit === "number" ? String(params.limit) : "100",
					exclude_archived: "true",
					types: "public_channel,private_channel",
				});
				if (typeof params.cursor === "string" && params.cursor.length > 0) {
					query.set("cursor", params.cursor);
				}

				const res = await fetch(`${SLACK_API}/conversations.list?${query.toString()}`, {
					method: "GET",
					headers: {
						Authorization: `Bearer ${token}`,
					},
					signal: AbortSignal.timeout(30_000),
				});

				const json = (await res.json()) as {
					ok: boolean;
					error?: string;
					channels?: Array<{
						id: string;
						name: string;
						is_private?: boolean;
						is_archived?: boolean;
					}>;
					response_metadata?: { next_cursor?: string };
				};

				if (!json.ok) {
					return {
						success: false,
						error: `Slack API error: ${json.error}`,
						durationMs: Date.now() - startMs,
					};
				}

				return {
					success: true,
					data: {
						channels: (json.channels ?? []).map((channel) => ({
							id: channel.id,
							name: channel.name,
							is_private: Boolean(channel.is_private),
							is_archived: Boolean(channel.is_archived),
						})),
						next_cursor: json.response_metadata?.next_cursor ?? null,
					},
					durationMs: Date.now() - startMs,
				};
			}

			case "post_message": {
				const body: Record<string, unknown> = {
					channel: params.channel,
					text: params.text,
				};
				if (typeof params.thread_ts === "string") {
					body.thread_ts = params.thread_ts;
				}

				const res = await fetch(`${SLACK_API}/chat.postMessage`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(30_000),
				});

				const json = (await res.json()) as { ok: boolean; error?: string; ts?: string };
				if (!json.ok) {
					return {
						success: false,
						error: `Slack API error: ${json.error}`,
						durationMs: Date.now() - startMs,
					};
				}

				return {
					success: true,
					data: { ts: json.ts, channel: params.channel },
					durationMs: Date.now() - startMs,
				};
			}

			default:
				return { success: false, error: `Unknown Slack action: ${actionId}` };
		}
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - startMs,
		};
	}
}

// ============================================
// Guide
// ============================================

export const guide = `# Slack Integration Guide

## Overview
Post messages to Slack channels directly from the sandbox.
Authentication is handled server-side via the org's Slack bot installation.

## Available Actions

### list_channels (read)
List public/private channels the bot can access, including channel IDs for use with \`post_message\`.

### post_message (write — requires approval)
Post a message to a Slack channel. Supports Slack mrkdwn formatting.

## Tips
- Use \`list_channels\` first, then pass a channel ID (e.g. \`C01234567\`) into \`post_message\`.
- Thread replies require the \`thread_ts\` of the parent message.
`;
