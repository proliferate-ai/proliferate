/**
 * Slack Events API Webhook Handler
 *
 * Receives events from Slack and enqueues them for processing by the worker.
 * Replaces the previous Cloudflare Worker + SlackEventDO approach.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "@/lib/logger";
import { env } from "@proliferate/environment/server";

const log = logger.child({ handler: "slack-events" });
import {
	type SlackMessageJob,
	createSlackMessagesQueue,
	queueSlackMessage,
} from "@proliferate/queue";
import { integrations } from "@proliferate/services";

const SLACK_SIGNING_SECRET = env.SLACK_SIGNING_SECRET;

interface SlackFile {
	id: string;
	mimetype: string;
	url_private_download: string;
}

interface SlackEventPayload {
	type: string;
	challenge?: string;
	event_id?: string;
	team_id?: string;
	event?: {
		type: string;
		channel: string;
		thread_ts?: string;
		ts: string;
		text?: string;
		user?: string;
		bot_id?: string;
		subtype?: string;
		files?: SlackFile[];
	};
}

/**
 * Verify Slack request signature using HMAC-SHA256
 */
function verifySlackSignature(
	body: string,
	timestamp: string | null,
	signature: string | null,
): boolean {
	if (!timestamp || !signature || !SLACK_SIGNING_SECRET) {
		return false;
	}

	// Check timestamp freshness (5 minute window)
	const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
	if (Number.parseInt(timestamp, 10) < fiveMinutesAgo) {
		return false;
	}

	const baseString = `v0:${timestamp}:${body}`;
	const hmac = createHmac("sha256", SLACK_SIGNING_SECRET);
	hmac.update(baseString);
	const expectedSignature = `v0=${hmac.digest("hex")}`;

	try {
		return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
	} catch {
		return false;
	}
}

/**
 * Extract prompt text from Slack message (removes bot mentions)
 */
function extractPrompt(text: string): string {
	return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

export async function POST(request: Request): Promise<Response> {
	const body = await request.text();
	const timestamp = request.headers.get("X-Slack-Request-Timestamp");
	const signature = request.headers.get("X-Slack-Signature");

	// Verify signature
	const isValid = verifySlackSignature(body, timestamp, signature);
	if (!isValid) {
		log.error("Invalid signature");
		return new Response("Invalid signature", { status: 401 });
	}

	const payload: SlackEventPayload = JSON.parse(body);

	// Handle URL verification challenge (required by Slack)
	if (payload.type === "url_verification" && payload.challenge) {
		return Response.json({ challenge: payload.challenge });
	}

	const { event, event_id, team_id } = payload;

	// Only process app_mention and message events
	if (!event || (event.type !== "app_mention" && event.type !== "message")) {
		log.info({ eventType: event?.type }, "Skipping: not relevant event type");
		return new Response("OK");
	}

	// Skip bot messages to prevent loops
	if (event.bot_id || event.subtype === "bot_message" || !event.user || !event.text) {
		log.info("Skipping: bot message or missing user/text");
		return new Response("OK");
	}

	if (!event_id || !team_id) {
		log.error("Missing required fields");
		return new Response("Missing required fields", { status: 400 });
	}

	// Find installation by team_id
	const installation = await integrations.findSlackInstallationByTeamId(team_id);

	if (!installation) {
		log.error({ teamId: team_id }, "No active installation for team");
		return new Response("No installation found", { status: 404 });
	}

	// For message events (not app_mention), only respond if:
	// 1. It's in a thread (has thread_ts)
	// 2. There's an existing session for that thread (meaning Proliferate was previously tagged)
	// This allows follow-up messages without requiring @mention each time
	if (event.type === "message") {
		if (!event.thread_ts) {
			// Not in a thread - skip (user should @mention to start a conversation)
			log.info("Skipping: message event not in a thread");
			return new Response("OK");
		}

		const existingSession = await integrations.findSlackSessionByThread(
			installation.id,
			event.channel,
			event.thread_ts,
		);

		if (!existingSession) {
			log.info("Skipping: message in thread but no existing session");
			return new Response("OK");
		}
		log.info({ sessionId: existingSession.id }, "Found existing session for thread");
	}

	const prompt = extractPrompt(event.text);
	if (!prompt) {
		// Empty prompt after removing mention - acknowledge but don't process
		log.info("Skipping: empty prompt after mention removal");
		return new Response("OK");
	}

	// Extract image URLs from attached files
	const imageUrls =
		event.files
			?.filter((f) => f.mimetype?.startsWith("image/"))
			?.map((f) => f.url_private_download) || [];

	// Create job payload
	const jobData: SlackMessageJob = {
		installationId: installation.id,
		channelId: event.channel,
		threadTs: event.thread_ts || event.ts,
		content: prompt,
		encryptedBotToken: installation.encryptedBotToken,
		messageTs: event.ts,
		slackUserId: event.user,
		organizationId: installation.organizationId,
		imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
	};

	// Enqueue message job
	try {
		const queue = createSlackMessagesQueue();
		await queueSlackMessage(queue, jobData);
		await queue.close();

		log.info({ threadTs: event.thread_ts || event.ts }, "Queued message for thread");
	} catch (err) {
		log.error({ err }, "Failed to queue message");
		return new Response("Failed to queue message", { status: 500 });
	}

	return new Response("OK");
}
