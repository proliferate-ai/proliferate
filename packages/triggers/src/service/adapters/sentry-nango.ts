import type { Request } from "express";
import { z } from "zod";
import { SentryProvider } from "../../sentry";
import type { SentryItem, SentryTriggerConfig } from "../../types";
import { type TriggerEvent, WebhookTrigger } from "../base";
import { getRawBody, parseNangoForwardWebhook, verifyNangoSignature } from "./nango";

const sentryConfigSchema = z
	.object({
		triggerMethod: z.enum(["webhook"]).optional(),
		projectSlug: z.string().optional(),
		environments: z.array(z.string()).optional(),
		minLevel: z.enum(["debug", "info", "warning", "error", "fatal"]).optional(),
	})
	.passthrough();

export interface SentryNangoTriggerOptions {
	nangoSecret?: string;
	allowedIntegrationIds?: string[];
}

export class SentryNangoTrigger extends WebhookTrigger<"sentry_event", SentryTriggerConfig> {
	readonly id = "sentry_event" as const;
	readonly provider = "sentry" as const;
	readonly metadata = {
		name: "Sentry Event",
		description: "Sentry events forwarded via Nango",
		icon: "sentry",
	};
	readonly configSchema = sentryConfigSchema;

	private readonly nangoSecret?: string;
	private readonly allowedIntegrationIds: Set<string>;

	constructor(options: SentryNangoTriggerOptions = {}) {
		super();
		this.nangoSecret = options.nangoSecret;
		this.allowedIntegrationIds = new Set(
			(options.allowedIntegrationIds ?? ["sentry"]).filter(Boolean),
		);
	}

	async webhook(req: Request): Promise<TriggerEvent[]> {
		const rawBody = getRawBody(req);
		if (this.nangoSecret) {
			const signature = req.headers["x-nango-hmac-sha256"] as string | undefined;
			if (!signature || !verifyNangoSignature(rawBody, signature, this.nangoSecret)) {
				throw new Error("Invalid signature");
			}
		}

		const forward = parseNangoForwardWebhook(req);
		if (!forward) return [];
		if (!this.allowedIntegrationIds.has(forward.providerConfigKey)) return [];

		const items = SentryProvider.parseWebhook(forward.payload);
		if (!items.length) return [];

		return items.map((item) =>
			this.toEvent(item as SentryItem, forward.connectionId, forward.providerConfigKey),
		);
	}

	filter(event: TriggerEvent, config: SentryTriggerConfig): boolean {
		return SentryProvider.filter(event.payload as SentryItem, config);
	}

	idempotencyKey(event: TriggerEvent): string {
		const item = event.payload as SentryItem;
		const dedup = SentryProvider.computeDedupKey(item);
		return dedup ?? `sentry:${event.externalId}`;
	}

	context(event: TriggerEvent): Record<string, unknown> {
		return SentryProvider.parseContext(event.payload as SentryItem) as unknown as Record<
			string,
			unknown
		>;
	}

	private toEvent(item: SentryItem, connectionId: string, providerKey: string): TriggerEvent {
		return {
			type: this.id,
			externalId: SentryProvider.extractExternalId(item),
			timestamp: new Date(),
			payload: item,
			connectionId,
			providerKey,
		};
	}
}
