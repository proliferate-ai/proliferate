import { runtimeEnv } from "@proliferate/environment/runtime";
import { getRawBody, parseNangoForwardWebhook, verifyNangoSignature } from "@proliferate/triggers";
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
	verifyNangoWebhookSignature(req);
	const forward = parseNangoForwardWebhook(req);
	if (!forward) return null;

	const providerKey = forward.providerConfigKey || forward.from;

	return {
		integrationProvider: "nango",
		provider: providerKey,
		connectionId: forward.connectionId,
	};
}

function verifyNangoWebhookSignature(req: Request): void {
	const secret = runtimeEnv.NANGO_SECRET_KEY;
	if (!secret) return;

	const headerValue = req.headers["x-nango-hmac-sha256"];
	const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue;
	if (!signature) {
		throw new Error("Invalid signature");
	}

	const rawBody = getRawBody(req);
	if (!verifyNangoSignature(rawBody, signature, secret)) {
		throw new Error("Invalid signature");
	}
}
