/**
 * Webhook ingestion routes — Fast-Ack pattern.
 *
 * These routes do exactly three things:
 * 1. Verify signatures (where applicable)
 * 2. INSERT INTO webhook_inbox
 * 3. Return 200 OK
 *
 * No parsing, no matching, no hydration, no run creation.
 * All processing happens asynchronously in the webhook inbox worker.
 */

import { webhookInbox } from "@proliferate/services";
import { type IRouter, Router } from "express";
import { logger as rootLogger } from "../lib/logger.js";
import { dispatchIntegrationWebhook } from "../lib/webhook-dispatcher.js";

const logger = rootLogger.child({ module: "webhooks" });

export const webhookRouter: IRouter = Router();

/**
 * POST /webhooks/nango — Nango-forwarded webhooks.
 *
 * Nango forwards provider webhooks (Linear, Sentry, GitHub, etc.)
 * through its own endpoint. We verify the Nango signature, extract
 * routing info, and store the raw payload in the inbox.
 */
webhookRouter.post("/nango", async (req, res) => {
	try {
		// Use existing Nango dispatcher for signature verification and routing extraction
		const dispatch = await dispatchIntegrationWebhook("nango", req);
		if (!dispatch) {
			return res.status(200).send("OK");
		}

		// Store in inbox for async processing
		await webhookInbox.insertInboxRow({
			provider: dispatch.provider,
			headers: req.headers as Record<string, unknown>,
			payload: req.body,
			// connectionId is stored in payload for the inbox worker to resolve
		});

		logger.debug(
			{ provider: dispatch.provider, connectionId: dispatch.connectionId },
			"Webhook received and queued",
		);

		res.status(200).send("OK");
	} catch (error) {
		if (error instanceof Error && error.message === "Invalid signature") {
			return res.status(401).json({ error: "Invalid signature" });
		}
		logger.error({ err: error }, "Webhook ingestion error");
		res.status(500).json({ error: "Internal error" });
	}
});

/**
 * POST /webhooks/direct/:providerId — Direct provider webhooks (vNext).
 *
 * For providers that send webhooks directly (not through Nango).
 * Uses the vNext ProviderTriggers.webhook.verify() interface.
 *
 * The provider's verify() method returns routing identity (org/integration/trigger)
 * which the inbox worker uses to resolve the target organization.
 */
webhookRouter.post("/direct/:providerId", async (req, res) => {
	try {
		const { providerId } = req.params;
		const payload =
			req.body && typeof req.body === "object" && !Array.isArray(req.body)
				? ({ ...(req.body as Record<string, unknown>) } as Record<string, unknown>)
				: {};
		const queryIntegrationId =
			typeof req.query.integrationId === "string" ? req.query.integrationId : null;
		const queryConnectionId =
			typeof req.query.connectionId === "string" ? req.query.connectionId : null;

		if (queryIntegrationId && !payload.integrationId && !payload.integration_id) {
			payload.integrationId = queryIntegrationId;
		}
		if (queryConnectionId && !payload.connectionId) {
			payload.connectionId = queryConnectionId;
		}

		const hasRoutingIdentity =
			typeof payload.connectionId === "string" ||
			typeof payload.integrationId === "string" ||
			typeof payload.integration_id === "string";
		if (!hasRoutingIdentity) {
			return res.status(400).json({
				error: "Direct webhooks require integrationId (or connectionId) for routing",
			});
		}

		// TODO: Look up provider from vNext ProviderRegistry once implemented
		// For now, store direct webhooks in the inbox with explicit routing identity.
		await webhookInbox.insertInboxRow({
			provider: providerId,
			headers: req.headers as Record<string, unknown>,
			payload,
		});

		logger.debug({ provider: providerId }, "Direct webhook received and queued");

		res.status(200).send("OK");
	} catch (error) {
		logger.error({ err: error }, "Direct webhook ingestion error");
		res.status(500).json({ error: "Internal error" });
	}
});
