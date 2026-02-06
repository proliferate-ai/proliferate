import type { TriggerEvent, WebhookTrigger } from "@proliferate/triggers";
import { parseNangoForwardWebhook, registry } from "@proliferate/triggers";
import type { Request } from "express";

export interface WebhookDispatchResult {
	integrationProvider: string;
	provider: string;
	connectionId: string;
	matches: Array<{
		triggerDef: WebhookTrigger;
		events: TriggerEvent[];
	}>;
}

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

async function dispatchNangoWebhook(req: Request): Promise<WebhookDispatchResult | null> {
	const forward = parseNangoForwardWebhook(req);
	if (!forward) return null;

	const providerKey = forward.providerConfigKey || forward.from;
	const triggerDefs = registry.webhooksByProvider(providerKey);
	if (triggerDefs.length === 0) {
		return {
			integrationProvider: "nango",
			provider: providerKey,
			connectionId: forward.connectionId,
			matches: [],
		};
	}

	const matches: WebhookDispatchResult["matches"] = [];
	for (const triggerDef of triggerDefs) {
		const events = await triggerDef.webhook(req);
		if (events.length > 0) {
			matches.push({ triggerDef, events });
		}
	}

	return {
		integrationProvider: "nango",
		provider: providerKey,
		connectionId: forward.connectionId,
		matches,
	};
}
