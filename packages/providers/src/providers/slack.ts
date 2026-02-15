/**
 * Slack provider — AdapterActionSource implementation.
 *
 * Stateless: receives bot token as parameter, never resolves tokens directly.
 * Wraps the Slack Web API with typed actions.
 */

import type { AdapterActionSource } from "../action-source";
import type { ActionResult } from "../types";

const SLACK_API = "https://slack.com/api";

async function slackFetch(
	method: string,
	token: string,
	body: Record<string, unknown>,
): Promise<unknown> {
	const res = await fetch(`${SLACK_API}/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15_000),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Slack API ${res.status}: ${text.slice(0, 200)}`);
	}

	const json = (await res.json()) as { ok: boolean; error?: string; [key: string]: unknown };
	if (!json.ok) {
		throw new Error(`Slack error: ${json.error ?? "unknown"}`);
	}

	return json;
}

function requireParam(params: Record<string, unknown>, name: string): string {
	const value = params[name];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Missing required parameter: ${name}`);
	}
	return value;
}

async function execute(
	action: string,
	params: Record<string, unknown>,
	token: string,
): Promise<ActionResult> {
	const start = Date.now();
	try {
		let data: unknown;

		switch (action) {
			case "send_message": {
				const channel = requireParam(params, "channel");
				const text = requireParam(params, "text");
				data = await slackFetch("chat.postMessage", token, { channel, text });
				break;
			}

			default:
				return { success: false, error: `Unknown Slack action: ${action}` };
		}

		return { success: true, data, durationMs: Date.now() - start };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - start,
		};
	}
}

export const slackSource: AdapterActionSource = {
	type: "adapter",
	id: "slack",
	displayName: "Slack",
	integration: "slack",
	actions: [
		{
			name: "send_message",
			description: "Send a message to a Slack channel",
			riskLevel: "write",
			params: [
				{
					name: "channel",
					type: "string",
					required: true,
					description: "Channel ID or name",
				},
				{ name: "text", type: "string", required: true, description: "Message text" },
			],
		},
	],
	guide: `# Slack Integration
Send messages to Slack channels. Authentication is handled server-side.

## Actions
- **send_message** (write): Send a message to a channel`,
	execute,
};
