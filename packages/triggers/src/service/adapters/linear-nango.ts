import type { Request } from "express";
import { z } from "zod";
import { LinearProvider, filterLinearByAction } from "../../linear";
import type { LinearIssue } from "../../types";
import type { LinearTriggerConfig } from "../../types";
import { type TriggerEvent, WebhookTrigger } from "../base";
import { getRawBody, parseNangoForwardWebhook, verifyNangoSignature } from "./nango";

const linearConfigSchema = z
	.object({
		triggerMethod: z.enum(["webhook", "polling"]).optional(),
		teamId: z.string().optional(),
		stateFilters: z.array(z.string()).optional(),
		priorityFilters: z.array(z.number()).optional(),
		labelFilters: z.array(z.string()).optional(),
		assigneeIds: z.array(z.string()).optional(),
		projectIds: z.array(z.string()).optional(),
		actionFilters: z.array(z.enum(["create", "update"])).optional(),
	})
	.passthrough();

export interface LinearNangoTriggerOptions {
	nangoSecret?: string;
	allowedIntegrationIds?: string[];
}

export class LinearNangoTrigger extends WebhookTrigger<"linear_event", LinearTriggerConfig> {
	readonly id = "linear_event" as const;
	readonly provider = "linear" as const;
	readonly metadata = {
		name: "Linear Event",
		description: "Linear events forwarded via Nango",
		icon: "linear",
	};
	readonly configSchema = linearConfigSchema;

	private readonly nangoSecret?: string;
	private readonly allowedIntegrationIds: Set<string>;

	constructor(options: LinearNangoTriggerOptions = {}) {
		super();
		this.nangoSecret = options.nangoSecret;
		this.allowedIntegrationIds = new Set(
			(options.allowedIntegrationIds ?? ["linear"]).filter(Boolean),
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

		const items = LinearProvider.parseWebhook(forward.payload);
		if (!items.length) return [];

		return items.map((item) =>
			this.toEvent(item as LinearIssue, forward.connectionId, forward.providerConfigKey),
		);
	}

	filter(event: TriggerEvent, config: LinearTriggerConfig): boolean {
		const item = event.payload as LinearIssue;
		if (!LinearProvider.filter(item, config)) return false;
		return filterLinearByAction(item, config.actionFilters);
	}

	idempotencyKey(event: TriggerEvent): string {
		const item = event.payload as LinearIssue;
		const dedup = LinearProvider.computeDedupKey(item);
		return dedup ?? `linear:${event.externalId}`;
	}

	context(event: TriggerEvent): Record<string, unknown> {
		return LinearProvider.parseContext(event.payload as LinearIssue) as unknown as Record<
			string,
			unknown
		>;
	}

	private toEvent(item: LinearIssue, connectionId: string, providerKey: string): TriggerEvent {
		return {
			type: this.id,
			externalId: LinearProvider.extractExternalId(item),
			timestamp: new Date(),
			payload: item,
			connectionId,
			providerKey,
		};
	}
}
