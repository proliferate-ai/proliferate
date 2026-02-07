import { integrations, triggers as triggerService } from "@proliferate/services";
import { type IRouter, Router } from "express";
import { logger as rootLogger } from "../lib/logger.js";
import { processTriggerEvents } from "../lib/trigger-processor.js";
import { dispatchIntegrationWebhook } from "../lib/webhook-dispatcher.js";

const logger = rootLogger.child({ module: "webhooks" });

export const webhookRouter: IRouter = Router();

// POST /webhooks/nango
webhookRouter.post("/nango", async (req, res) => {
	try {
		const dispatch = await dispatchIntegrationWebhook("nango", req);
		if (!dispatch || dispatch.matches.length === 0) {
			return res.json({ processed: 0, skipped: 0 });
		}

		let processed = 0;
		let skipped = 0;

		const integration = await integrations.findByConnectionIdAndProvider(
			dispatch.connectionId,
			"nango",
		);

		if (!integration) {
			logger.info({ connectionId: dispatch.connectionId }, "Integration not found for connection");
			return res.json({ processed: 0, skipped: 0 });
		}

		const triggerRows = await triggerService.findActiveWebhookTriggers(integration.id);
		if (triggerRows.length === 0) {
			return res.json({ processed: 0, skipped: 0 });
		}

		for (const match of dispatch.matches) {
			if (match.events.length === 0) continue;

			for (const triggerRow of triggerRows) {
				if (triggerRow.provider !== match.triggerDef.provider) continue;
				const result = await processTriggerEvents(match.triggerDef, triggerRow, match.events);
				processed += result.processed;
				skipped += result.skipped;
			}
		}

		res.json({ processed, skipped });
	} catch (error) {
		if (error instanceof Error && error.message === "Invalid signature") {
			return res.status(401).json({ error: "Invalid signature" });
		}
		logger.error({ err: error }, "Webhook error");
		res.status(500).json({ error: "Internal server error" });
	}
});

// POST /webhooks/:provider (reserved)
webhookRouter.post("/:provider", (_req, res) => {
	res.status(404).json({ error: "Unsupported webhook provider" });
});
