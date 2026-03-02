import { parseNangoForwardWebhook } from "@proliferate/triggers";
import type { Request } from "express";

export interface WebhookDispatchResult {
	integrationProvider: string;
	provider: string;
	connectionId: string;
}

/**
 * Extract routing metadata from an integration webhook.
 *
 * This is the fast-ack path — it only extracts provider + connectionId
 * for inbox storage. Full event parsing happens in the inbox worker.
 */
export async function dispatchIntegrationWebhook(
	integrationProvider: string,
	req: Request,
): Promise<WebhookDispatchResult | null> {
	switch (integrationProvider) {
		case "nango":
			return dispatchNangoWebhook(req);
		default:
			return null;
	}
}

function dispatchNangoWebhook(req: Request): WebhookDispatchResult | null {
	const forward = parseNangoForwardWebhook(req);
	if (!forward) return null;

	const providerKey = forward.providerConfigKey || forward.from;

	return {
		integrationProvider: "nango",
		provider: providerKey,
		connectionId: forward.connectionId,
	};
}
