/**
 * PostHog Trigger Provider
 *
 * Supports webhooks only - PostHog event delivery uses webhook destinations.
 */

import type {
	OAuthConnection,
	ParsedEventContext,
	PollResult,
	PollState,
	PostHogItem,
	PostHogTriggerConfig,
	PostHogWebhookPayload,
	TriggerProvider,
} from "./types";
import { registerProvider } from "./types";

async function hmacSha256(secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return Array.from(new Uint8Array(signatureBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function normalizeItem(payload: PostHogWebhookPayload): PostHogItem | null {
	const eventField = payload.event;
	let eventName: string | undefined;
	let distinctId: string | undefined;
	let timestamp: string | undefined;
	let uuid: string | undefined;
	let eventUrl: string | undefined;
	let properties: Record<string, unknown> | undefined;

	if (typeof eventField === "string") {
		eventName = eventField;
		distinctId = payload.distinct_id;
		timestamp = payload.timestamp;
		properties = payload.properties as Record<string, unknown> | undefined;
	} else if (eventField && typeof eventField === "object") {
		const eventObj = eventField as Record<string, unknown>;
		eventName = typeof eventObj.event === "string" ? eventObj.event : undefined;
		distinctId =
			(typeof eventObj.distinct_id === "string" ? eventObj.distinct_id : undefined) ??
			payload.distinct_id;
		timestamp =
			(typeof eventObj.timestamp === "string" ? eventObj.timestamp : undefined) ??
			payload.timestamp;
		uuid = typeof eventObj.uuid === "string" ? eventObj.uuid : undefined;
		eventUrl = typeof eventObj.url === "string" ? eventObj.url : undefined;
		properties =
			(eventObj.properties as Record<string, unknown> | undefined) ??
			(payload.properties as Record<string, unknown> | undefined);
	}

	if (!eventName) return null;

	return {
		event: eventName,
		distinctId,
		timestamp,
		uuid,
		eventUrl,
		properties,
		person: payload.person,
		raw: payload,
	};
}

export const PostHogProvider: TriggerProvider<PostHogTriggerConfig, PollState, PostHogItem> = {
	async poll(
		_connection: OAuthConnection,
		_config: PostHogTriggerConfig,
		_lastState: PollState | null,
	): Promise<PollResult<PostHogItem, PollState>> {
		throw new Error("PostHog only supports webhooks, not polling.");
	},

	findNewItems(items: PostHogItem[], _lastState: PollState | null): PostHogItem[] {
		return items;
	},

	filter(item: PostHogItem, config: PostHogTriggerConfig): boolean {
		if (config.eventNames?.length && !config.eventNames.includes(item.event)) {
			return false;
		}

		if (config.propertyFilters) {
			const props = item.properties ?? {};
			for (const [key, value] of Object.entries(config.propertyFilters)) {
				if (String(props[key] ?? "") !== value) {
					return false;
				}
			}
		}

		return true;
	},

	parseContext(item: PostHogItem): ParsedEventContext {
		const url =
			item.eventUrl ??
			(typeof item.properties?.$current_url === "string"
				? item.properties.$current_url
				: undefined);

		return {
			title: `PostHog: ${item.event}`,
			description: url,
			posthog: {
				event: item.event,
				distinctId: item.distinctId,
				timestamp: item.timestamp,
				eventUrl: url,
				properties: item.properties,
				person: item.person,
			},
		};
	},

	async verifyWebhook(request: Request, secret: string, body: string): Promise<boolean> {
		const signature = request.headers.get("X-PostHog-Signature");
		if (signature) {
			const expected = await hmacSha256(secret, body);
			return signature === expected;
		}

		const token =
			request.headers.get("X-PostHog-Token") ||
			request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

		if (!token) return false;
		return token === secret;
	},

	parseWebhook(payload: unknown): PostHogItem[] {
		const item = normalizeItem(payload as PostHogWebhookPayload);
		return item ? [item] : [];
	},

	computeDedupKey(item: PostHogItem): string | null {
		if (item.uuid) return `posthog:${item.uuid}`;
		const parts = [item.event, item.distinctId ?? "unknown", item.timestamp ?? ""].join(":");
		return `posthog:${parts}`;
	},

	extractExternalId(item: PostHogItem): string {
		return item.uuid ?? item.distinctId ?? item.event;
	},

	getEventType(item: PostHogItem): string {
		return item.event;
	},
};

registerProvider("posthog", PostHogProvider as TriggerProvider<unknown, unknown, unknown>);

export default PostHogProvider;
