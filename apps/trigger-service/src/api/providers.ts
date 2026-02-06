import { WebhookTrigger, registry } from "@proliferate/triggers";
import { type IRouter, Router } from "express";
import { zodToJsonSchema } from "zod-to-json-schema";

export const providersRouter: IRouter = Router();

// GET /providers - List all available trigger providers
providersRouter.get("/", (_req, res) => {
	const providers: Record<
		string,
		{
			id: string;
			provider: string;
			triggerType: "webhook" | "polling";
			metadata: unknown;
			configSchema: unknown;
		}
	> = {};

	for (const provider of registry.all()) {
		providers[provider.id] = {
			id: provider.id,
			provider: provider.provider,
			triggerType: provider instanceof WebhookTrigger ? "webhook" : "polling",
			metadata: provider.metadata,
			configSchema: zodToJsonSchema(provider.configSchema),
		};
	}

	res.json({ providers });
});

// GET /providers/:id - Get specific provider
providersRouter.get("/:id", (req, res) => {
	const provider = registry.getWebhook(req.params.id) ?? registry.getPolling(req.params.id);

	if (!provider) {
		return res.status(404).json({ error: "Provider not found" });
	}

	res.json({
		id: provider.id,
		provider: provider.provider,
		triggerType: provider instanceof WebhookTrigger ? "webhook" : "polling",
		metadata: provider.metadata,
		configSchema: zodToJsonSchema(provider.configSchema),
	});
});
