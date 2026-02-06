/**
 * Sentry Trigger Provider
 *
 * Supports webhooks only - Sentry doesn't have a good polling API for issues.
 */

import type {
	OAuthConnection,
	ParsedEventContext,
	PollResult,
	PollState,
	SentryItem,
	SentryTriggerConfig,
	SentryWebhookPayloadInternal,
	TriggerProvider,
} from "./types";
import { registerProvider } from "./types";

/**
 * HMAC-SHA256 helper for webhook verification
 */
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

/**
 * Severity level ordering for comparison
 */
const SEVERITY_LEVELS = ["debug", "info", "warning", "error", "fatal"] as const;

function getSeverityIndex(level: string): number {
	return SEVERITY_LEVELS.indexOf(level as (typeof SEVERITY_LEVELS)[number]);
}

/**
 * Sentry provider implementation
 */
export const SentryProvider: TriggerProvider<SentryTriggerConfig, PollState, SentryItem> = {
	async poll(
		_connection: OAuthConnection,
		_config: SentryTriggerConfig,
		_lastState: PollState | null,
	): Promise<PollResult<SentryItem, PollState>> {
		// Sentry doesn't have a good polling API for issues
		// Use webhooks only for Sentry
		throw new Error(
			"Sentry only supports webhooks, not polling. Configure a webhook integration instead.",
		);
	},

	findNewItems(items: SentryItem[], _lastState: PollState | null): SentryItem[] {
		// Webhooks always deliver new items
		return items;
	},

	filter(item: SentryItem, config: SentryTriggerConfig): boolean {
		const { issue, event } = item;

		// Project filter
		if (config.projectSlug && issue.project?.slug !== config.projectSlug) {
			return false;
		}

		// Environment filter
		if (config.environments?.length) {
			// Check both issue and event tags for environment
			const issueTags = issue.tags || [];
			const eventTags = event?.tags || [];
			const allTags = [...issueTags, ...eventTags];

			const env = allTags.find((t) => t.key === "environment")?.value;
			if (!env || !config.environments.includes(env)) {
				return false;
			}
		}

		// Minimum severity level filter
		if (config.minLevel) {
			const minIdx = getSeverityIndex(config.minLevel);
			const itemLevel = issue.level ?? "error";
			const itemIdx = getSeverityIndex(itemLevel);

			// If level is unknown, treat as error (index 3)
			const effectiveIdx = itemIdx === -1 ? 3 : itemIdx;

			if (effectiveIdx < minIdx) {
				return false;
			}
		}

		return true;
	},

	parseContext(item: SentryItem): ParsedEventContext {
		const { issue, event } = item;

		// Extract stack trace files
		const relatedFiles: string[] = [];
		if (event?.exception?.values) {
			for (const exc of event.exception.values) {
				if (exc.stacktrace?.frames) {
					for (const frame of exc.stacktrace.frames) {
						if (frame.filename && !frame.filename.startsWith("<")) {
							relatedFiles.push(frame.filename);
						}
					}
				}
			}
		}

		// Format stack trace for display
		let stackTrace: string | undefined;
		if (event?.exception?.values?.[0]?.stacktrace?.frames) {
			const frames = event.exception.values[0].stacktrace.frames.slice(-10);
			stackTrace = frames
				.reverse()
				.map((f) => `  at ${f.function || "<anonymous>"} (${f.filename}:${f.lineno}:${f.colno})`)
				.join("\n");
		}

		// Get environment from tags
		const allTags = [...(issue.tags || []), ...(event?.tags || [])];
		const environment = allTags.find((t) => t.key === "environment")?.value;
		const release = allTags.find((t) => t.key === "release")?.value;

		return {
			title: issue.title || event?.title || "Sentry Error",
			description: issue.culprit,
			relatedFiles: [...new Set(relatedFiles)],
			sentry: {
				errorType: issue.metadata?.type || "Unknown",
				errorMessage: issue.metadata?.value || event?.message || "",
				stackTrace,
				issueUrl: `https://sentry.io/issues/${issue.id}/`,
				environment,
				release,
				projectSlug: issue.project?.slug,
			},
		};
	},

	async verifyWebhook(request: Request, secret: string, body: string): Promise<boolean> {
		const signature = request.headers.get("Sentry-Hook-Signature");
		if (!signature) return false;

		const expected = await hmacSha256(secret, body);
		return signature === expected;
	},

	parseWebhook(payload: unknown): SentryItem[] {
		const p = payload as SentryWebhookPayloadInternal;

		// Must have issue data
		if (!p.data?.issue) {
			return [];
		}

		return [
			{
				issue: p.data.issue,
				event: p.data.event,
				action: p.action,
			},
		];
	},

	computeDedupKey(item: SentryItem): string | null {
		// For Sentry, dedupe on event ID if available, otherwise issue ID
		const eventId = item.event?.event_id || item.issue.id;
		return `sentry:${eventId}`;
	},

	extractExternalId(item: SentryItem): string {
		return item.event?.event_id || item.issue.id;
	},

	getEventType(item: SentryItem): string {
		return item.action || "created";
	},
};

// Register the provider
registerProvider("sentry", SentryProvider as TriggerProvider<unknown, unknown, unknown>);

export default SentryProvider;
