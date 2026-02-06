import type { Request } from "express";
import { z } from "zod";
import { GitHubProvider } from "../../github";
import type { GitHubItem } from "../../types";
import type { GitHubTriggerConfig } from "../../types";
import { type TriggerEvent, WebhookTrigger } from "../base";
import { getRawBody, parseNangoForwardWebhook, verifyNangoSignature } from "./nango";

const githubConfigSchema = z
	.object({
		triggerMethod: z.enum(["webhook"]).optional(),
		eventTypes: z
			.array(z.enum(["issues", "pull_request", "push", "check_suite", "check_run", "workflow_run"]))
			.optional(),
		actionFilters: z.array(z.string()).optional(),
		branchFilters: z.array(z.string()).optional(),
		labelFilters: z.array(z.string()).optional(),
		repoFilters: z.array(z.string()).optional(),
		conclusionFilters: z
			.array(z.enum(["success", "failure", "cancelled", "skipped", "timed_out", "action_required"]))
			.optional(),
	})
	.passthrough();

export interface GitHubNangoTriggerOptions {
	nangoSecret?: string;
	allowedIntegrationIds?: string[];
}

export class GitHubNangoTrigger extends WebhookTrigger<"github_event", GitHubTriggerConfig> {
	readonly id = "github_event" as const;
	readonly provider = "github" as const;
	readonly metadata = {
		name: "GitHub Event",
		description: "GitHub events forwarded via Nango",
		icon: "github",
	};
	readonly configSchema = githubConfigSchema;

	private readonly nangoSecret?: string;
	private readonly allowedIntegrationIds: Set<string>;

	constructor(options: GitHubNangoTriggerOptions = {}) {
		super();
		this.nangoSecret = options.nangoSecret;
		this.allowedIntegrationIds = new Set(
			(options.allowedIntegrationIds ?? ["github"]).filter(Boolean),
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

		const items = GitHubProvider.parseWebhook(forward.payload);
		if (!items.length) return [];

		return items.map((item) => this.toEvent(item, forward.connectionId, forward.providerConfigKey));
	}

	filter(event: TriggerEvent, config: GitHubTriggerConfig): boolean {
		return GitHubProvider.filter(event.payload as GitHubItem, config);
	}

	idempotencyKey(event: TriggerEvent): string {
		const item = event.payload as GitHubItem;
		const dedup = GitHubProvider.computeDedupKey(item);
		return dedup ?? `github:${event.externalId}`;
	}

	context(event: TriggerEvent): Record<string, unknown> {
		return GitHubProvider.parseContext(event.payload as GitHubItem) as unknown as Record<
			string,
			unknown
		>;
	}

	private toEvent(item: GitHubItem, connectionId: string, providerKey: string): TriggerEvent {
		return {
			type: this.id,
			externalId: GitHubProvider.extractExternalId(item),
			timestamp: new Date(),
			payload: item,
			connectionId,
			providerKey,
		};
	}
}
