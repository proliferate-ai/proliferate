/**
 * Webhook Ingestion Routes — Fast-path insert-and-return.
 *
 * Every route follows the same pattern:
 *   1. Verify signature (if applicable).
 *   2. Extract identity (provider, connection ID, org ID).
 *   3. INSERT INTO webhook_inbox.
 *   4. Enqueue a BullMQ job for async processing.
 *   5. Return 200 immediately.
 *
 * This decouples ingestion from processing so upstream rate-limit storms
 * don't block the HTTP response.
 */

import crypto from "node:crypto";
import { env } from "@proliferate/environment/server";
import {
	type Queue,
	type WebhookInboxJob,
	createWebhookInboxQueue,
	queueWebhookInbox,
} from "@proliferate/queue";
import { webhookInbox } from "@proliferate/services";
import { verifyNangoSignature } from "@proliferate/triggers";
import { type IRouter, Router } from "express";
import { logger as rootLogger } from "../lib/logger.js";

const logger = rootLogger.child({ module: "webhooks" });

let inboxQueue: Queue<WebhookInboxJob> | null = null;
function getInboxQueue(): Queue<WebhookInboxJob> {
	if (!inboxQueue) inboxQueue = createWebhookInboxQueue();
	return inboxQueue;
}

// ============================================
// Helpers
// ============================================

type RawBodyRequest = import("express").Request & { rawBody?: string };

function getRawBody(req: RawBodyRequest): string {
	return req.rawBody ?? "";
}

function extractHeaders(req: import("express").Request): Record<string, string> {
	const headers: Record<string, string> = {};
	const keep = [
		"x-hub-signature-256",
		"x-nango-hmac-sha256",
		"linear-signature",
		"sentry-hook-signature",
		"x-posthog-signature",
		"x-posthog-token",
		"x-webhook-signature",
		"x-signature",
		"x-signature-256",
		"content-type",
		"x-github-event",
		"x-github-delivery",
		"user-agent",
	];
	for (const name of keep) {
		const val = req.headers[name];
		if (typeof val === "string") headers[name] = val;
	}
	return headers;
}

async function ingestAndQueue(
	provider: string,
	payload: Record<string, unknown>,
	opts?: {
		organizationId?: string | null;
		externalId?: string | null;
		headers?: Record<string, string> | null;
		signature?: string | null;
	},
): Promise<string> {
	const inboxId = await webhookInbox.insert({
		provider,
		organizationId: opts?.organizationId,
		externalId: opts?.externalId,
		headers: opts?.headers,
		payload,
		signature: opts?.signature,
	});
	await queueWebhookInbox(getInboxQueue(), inboxId);
	return inboxId;
}

// ============================================
// Routes
// ============================================

export const webhookRouter: IRouter = Router();

/**
 * POST /webhooks/nango — Nango forwarded webhooks.
 * Verifies Nango HMAC-SHA256 signature, then ingests.
 */
webhookRouter.post("/nango", async (req, res) => {
	try {
		const rawBody = getRawBody(req);
		const signature = req.headers["x-nango-hmac-sha256"];

		if (typeof signature !== "string" || !env.NANGO_SECRET_KEY) {
			return res.status(401).json({ error: "Missing signature or secret" });
		}

		if (!verifyNangoSignature(rawBody, signature, env.NANGO_SECRET_KEY)) {
			logger.warn("Invalid Nango webhook signature");
			return res.status(401).json({ error: "Invalid signature" });
		}

		const body = req.body as Record<string, unknown>;
		const connectionId = (body.connectionId as string) ?? undefined;

		await ingestAndQueue("nango", body, {
			externalId: connectionId,
			headers: extractHeaders(req),
			signature,
		});

		res.json({ ok: true });
	} catch (err) {
		logger.error({ err }, "Nango webhook ingestion error");
		res.status(500).json({ error: "Internal server error" });
	}
});

/**
 * POST /webhooks/github-app — Direct GitHub App webhooks.
 * Verifies X-Hub-Signature-256 using GITHUB_APP_WEBHOOK_SECRET.
 */
webhookRouter.post("/github-app", async (req, res) => {
	try {
		const rawBody = getRawBody(req);
		const signature = req.headers["x-hub-signature-256"];
		const secret = env.GITHUB_APP_WEBHOOK_SECRET;

		if (!secret || typeof signature !== "string") {
			return res.status(401).json({ error: "Missing signature or secret" });
		}

		const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
		if (
			signature.length !== expected.length ||
			!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
		) {
			logger.warn("Invalid GitHub App webhook signature");
			return res.status(401).json({ error: "Invalid signature" });
		}

		const body = req.body as Record<string, unknown>;
		const delivery = req.headers["x-github-delivery"] as string | undefined;
		const event = req.headers["x-github-event"] as string | undefined;

		await ingestAndQueue("github-app", body, {
			externalId: delivery,
			headers: extractHeaders(req),
			signature,
		});

		logger.info({ event, delivery }, "GitHub App webhook ingested");
		res.json({ ok: true });
	} catch (err) {
		logger.error({ err }, "GitHub App webhook ingestion error");
		res.status(500).json({ error: "Internal server error" });
	}
});

/**
 * POST /webhooks/custom/:triggerId — Custom webhooks addressed to a specific trigger.
 * Signature verification deferred to async processing.
 */
webhookRouter.post("/custom/:triggerId", async (req, res) => {
	try {
		const { triggerId } = req.params;
		const body = req.body as Record<string, unknown>;
		const signature =
			(req.headers["x-webhook-signature"] as string) ??
			(req.headers["x-signature"] as string) ??
			(req.headers["x-hub-signature-256"] as string) ??
			(req.headers["x-signature-256"] as string) ??
			null;

		await ingestAndQueue("custom", body, {
			externalId: triggerId,
			headers: extractHeaders(req),
			signature,
		});

		res.json({ ok: true });
	} catch (err) {
		logger.error({ err }, "Custom webhook ingestion error");
		res.status(500).json({ error: "Internal server error" });
	}
});

/** GET /webhooks/custom/:triggerId — Health check for custom webhook endpoints. */
webhookRouter.get("/custom/:triggerId", (_req, res) => {
	res.json({ ok: true, message: "Webhook endpoint active" });
});

/**
 * POST /webhooks/posthog/:automationId — PostHog webhooks addressed to an automation.
 * Signature verification deferred to async processing.
 */
webhookRouter.post("/posthog/:automationId", async (req, res) => {
	try {
		const { automationId } = req.params;
		const body = req.body as Record<string, unknown>;
		const signature = (req.headers["x-posthog-signature"] as string) ?? null;

		await ingestAndQueue("posthog", body, {
			externalId: automationId,
			headers: extractHeaders(req),
			signature,
		});

		res.json({ ok: true });
	} catch (err) {
		logger.error({ err }, "PostHog webhook ingestion error");
		res.status(500).json({ error: "Internal server error" });
	}
});

/**
 * POST /webhooks/automation/:automationId — Generic automation webhooks.
 * Signature verification deferred to async processing.
 */
webhookRouter.post("/automation/:automationId", async (req, res) => {
	try {
		const { automationId } = req.params;
		const body = req.body as Record<string, unknown>;
		const signature =
			(req.headers["x-webhook-signature"] as string) ??
			(req.headers["x-signature"] as string) ??
			null;

		await ingestAndQueue("automation", body, {
			externalId: automationId,
			headers: extractHeaders(req),
			signature,
		});

		res.json({ ok: true });
	} catch (err) {
		logger.error({ err }, "Automation webhook ingestion error");
		res.status(500).json({ error: "Internal server error" });
	}
});
