import { env } from "@proliferate/environment/server";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "slack" });
const SLACK_API_BASE = "https://slack.com/api";

function requireEnvVar(value: string | undefined, name: string): string {
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

/**
 * Helper to retry Slack API calls with exponential backoff on rate limits
 */
async function fetchWithRetry(
	url: string,
	options: RequestInit,
	maxRetries = 3,
): Promise<Response> {
	const lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const response = await fetch(url, options);

		// Check for rate limiting
		if (response.status === 429) {
			const retryAfter = response.headers.get("Retry-After");
			const waitTime = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 2 ** attempt * 1000;
			log.info(
				{ waitTimeMs: waitTime, attempt: attempt + 1, maxRetries },
				"Slack rate limited, retrying",
			);
			await new Promise((resolve) => setTimeout(resolve, waitTime));
			continue;
		}

		// Also check for ratelimited error in JSON response
		const clonedResponse = response.clone();
		try {
			const json = await clonedResponse.json();
			if (json.error === "ratelimited") {
				const waitTime = 2 ** attempt * 1000;
				log.info(
					{ waitTimeMs: waitTime, attempt: attempt + 1, maxRetries },
					"Slack rate limited (json), retrying",
				);
				await new Promise((resolve) => setTimeout(resolve, waitTime));
				continue;
			}
		} catch {
			// Not JSON, that's fine
		}

		return response;
	}

	throw lastError || new Error("Max retries exceeded");
}

export interface SlackOAuthResponse {
	ok: boolean;
	error?: string;
	access_token: string;
	token_type: "bot";
	scope: string;
	bot_user_id: string;
	app_id: string;
	team: {
		id: string;
		name: string;
	};
	authed_user: {
		id: string;
	};
	is_enterprise_install: boolean;
}

export interface SlackPostMessageResponse {
	ok: boolean;
	error?: string;
	ts?: string;
	channel?: string;
}

/**
 * Exchange OAuth authorization code for access token
 */
export async function exchangeCodeForToken(code: string): Promise<SlackOAuthResponse> {
	const response = await fetch(`${SLACK_API_BASE}/oauth.v2.access`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: requireEnvVar(env.SLACK_CLIENT_ID, "SLACK_CLIENT_ID"),
			client_secret: requireEnvVar(env.SLACK_CLIENT_SECRET, "SLACK_CLIENT_SECRET"),
			code,
			redirect_uri: `${env.NEXT_PUBLIC_APP_URL}/api/integrations/slack/oauth/callback`,
		}),
	});

	return response.json();
}

/**
 * Post a message to a Slack channel/thread
 */
export async function postMessage(
	botToken: string,
	options: {
		channel: string;
		text: string;
		thread_ts?: string;
		blocks?: unknown[];
	},
): Promise<SlackPostMessageResponse> {
	const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${botToken}`,
		},
		body: JSON.stringify(options),
	});

	return response.json();
}

/**
 * Revoke a Slack token (uninstall)
 */
export async function revokeToken(botToken: string): Promise<{ ok: boolean; error?: string }> {
	const response = await fetch(`${SLACK_API_BASE}/auth.revoke`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Bearer ${botToken}`,
		},
	});

	return response.json();
}

/**
 * Send Slack Connect invite to a customer
 * Creates a dedicated support channel and invites the customer
 * Uses Proliferate's workspace bot token
 */
export async function sendSlackConnectInvite(
	customerEmail: string,
	channelName: string,
): Promise<{
	ok: boolean;
	error?: string;
	channel_id?: string;
	invite_id?: string;
	invite_url?: string;
}> {
	const proliferateBotToken = env.PROLIFERATE_SLACK_BOT_TOKEN;

	if (!proliferateBotToken) {
		log.warn("Slack Connect not configured (missing PROLIFERATE_SLACK_BOT_TOKEN)");
		return { ok: false, error: "Slack Connect not configured" };
	}

	// Sanitize channel name (max 80 chars, lowercase, alphanumeric + hyphens)
	const sanitizedChannelName = channelName
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80);

	// 1. Create a new channel for this customer
	log.info({ channelName: sanitizedChannelName }, "Creating Slack Connect channel");
	const createResponse = await fetch(`${SLACK_API_BASE}/conversations.create`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${proliferateBotToken}`,
		},
		body: JSON.stringify({
			name: sanitizedChannelName,
			is_private: false, // Must be public for Slack Connect
		}),
	});

	const createResult = await createResponse.json();
	log.info({ ok: createResult.ok }, "Create channel result");

	if (!createResult.ok) {
		// If channel already exists, try to find it
		if (createResult.error === "name_taken") {
			log.info({ channelName: sanitizedChannelName }, "Channel already exists, finding it");
			const listResponse = await fetch(
				`${SLACK_API_BASE}/conversations.list?types=public_channel&limit=1000`,
				{
					headers: { Authorization: `Bearer ${proliferateBotToken}` },
				},
			);
			const listResult = await listResponse.json();
			const existingChannel = listResult.channels?.find(
				(c: { name: string }) => c.name === sanitizedChannelName,
			);
			if (existingChannel) {
				log.info({ channelId: existingChannel.id }, "Found existing channel");
				createResult.ok = true;
				createResult.channel = existingChannel;
			}
		}

		if (!createResult.ok) {
			log.error({ error: createResult.error }, "Failed to create Slack Connect channel");
			return { ok: false, error: createResult.error };
		}
	}

	const channelId = createResult.channel.id;
	log.info({ channelId }, "Using channel");

	// 2. Add default team members to the channel directly
	const defaultEmails = (env.PROLIFERATE_SLACK_CONNECT_EMAILS ?? "")
		.split(",")
		.map((e) => e.trim())
		.filter(Boolean);
	log.info({ memberCount: defaultEmails.length }, "Adding team members to channel");

	for (const email of defaultEmails) {
		try {
			// Look up user by email
			log.info({ email }, "Looking up Slack user");
			const userLookup = await fetch(
				`${SLACK_API_BASE}/users.lookupByEmail?email=${encodeURIComponent(email)}`,
				{ headers: { Authorization: `Bearer ${proliferateBotToken}` } },
			);
			const userResult = await userLookup.json();
			log.info(
				{ email, found: userResult.ok, userId: userResult.user?.id },
				"User lookup result",
			);

			if (userResult.ok && userResult.user?.id) {
				// Add user to channel
				const inviteResult = await fetch(`${SLACK_API_BASE}/conversations.invite`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${proliferateBotToken}`,
					},
					body: JSON.stringify({
						channel: channelId,
						users: userResult.user.id,
					}),
				});
				const inviteJson = await inviteResult.json();
				log.info(
					{ email, ok: inviteJson.ok, error: inviteJson.error },
					"Added user to channel",
				);
			}
		} catch (err) {
			log.error({ err, email }, "Failed to add user to channel");
		}
	}

	// 3. Invite the customer via Slack Connect (with retry for rate limits)
	log.info({ customerEmail }, "Sending Slack Connect invite to customer");
	let inviteResult: { ok: boolean; error?: string; invite_id?: string; url?: string };
	try {
		const inviteResponse = await fetchWithRetry(
			`${SLACK_API_BASE}/conversations.inviteShared`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${proliferateBotToken}`,
				},
				body: JSON.stringify({
					channel: channelId,
					emails: [customerEmail],
					external_limited: false,
				}),
			},
			5, // More retries for the invite step
		);

		inviteResult = await inviteResponse.json();
		log.info({ ok: inviteResult.ok }, "Customer invite result");

		if (!inviteResult.ok) {
			log.error({ error: inviteResult.error }, "Failed to send Slack Connect invite");
			return { ok: false, error: inviteResult.error, channel_id: channelId };
		}
	} catch (err) {
		log.error({ err }, "Slack Connect invite failed after retries");
		return { ok: false, error: "rate_limit_exceeded", channel_id: channelId };
	}

	log.info({ channelName: sanitizedChannelName, customerEmail }, "Slack Connect complete");
	return {
		ok: true,
		channel_id: channelId,
		invite_id: inviteResult.invite_id,
		invite_url: inviteResult.url,
	};
}

/**
 * Required OAuth scopes for the Slack bot
 */
export const SLACK_BOT_SCOPES = [
	"app_mentions:read",
	"chat:write",
	"chat:write.public",
	"channels:history",
	"groups:history",
	"im:history",
	"mpim:history",
	"channels:read",
	"groups:read",
	"users:read",
	"users:read.email",
	"files:write",
].join(",");

/**
 * Generate Slack OAuth URL
 */
export function getSlackOAuthUrl(state: string): string {
	const url = new URL("https://slack.com/oauth/v2/authorize");
	url.searchParams.set("client_id", requireEnvVar(env.SLACK_CLIENT_ID, "SLACK_CLIENT_ID"));
	url.searchParams.set("scope", SLACK_BOT_SCOPES);
	url.searchParams.set(
		"redirect_uri",
		`${env.NEXT_PUBLIC_APP_URL}/api/integrations/slack/oauth/callback`,
	);
	url.searchParams.set("state", state);
	return url.toString();
}
