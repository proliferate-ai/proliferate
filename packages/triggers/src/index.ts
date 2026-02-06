/**
 * Trigger Provider Exports
 *
 * Import this module to get access to all trigger providers.
 */

// Types
export type {
	TriggerProvider,
	PollState,
	OAuthConnection,
	PollResult,
	ParsedEventContext,
	SentryParsedContext,
	LinearParsedContext,
	GitHubParsedContext,
	GmailParsedContext,
	PostHogParsedContext,
	LinearTriggerConfig,
	SentryTriggerConfig,
	GitHubTriggerConfig,
	GmailTriggerConfig,
	PostHogTriggerConfig,
	ProviderConfig,
	LinearIssue,
	LinearWebhookPayloadInternal,
	SentryIssue,
	SentryEvent,
	SentryWebhookPayloadInternal,
	SentryItem,
	GitHubItem,
	GitHubWebhookPayload,
	PostHogWebhookPayload,
	PostHogItem,
	TriggerProviderType,
} from "./types";

// Registry functions
export { getProvider, registerProvider, getProviderRegistry } from "./types";

// Provider implementations (importing registers them)
export { LinearProvider, filterLinearByAction } from "./linear";
export { SentryProvider } from "./sentry";
export { GitHubProvider } from "./github";
export { PostHogProvider } from "./posthog";

// Trigger-service definitions and adapters
export * from "./service";

import { GitHubProvider } from "./github";
// Re-export for convenience
import { LinearProvider } from "./linear";
import { PostHogProvider } from "./posthog";
import { SentryProvider } from "./sentry";
import type { TriggerProvider, TriggerProviderType } from "./types";

/**
 * Map of provider type to implementation
 */
export const providers: Record<
	"linear" | "sentry" | "github" | "posthog",
	TriggerProvider<unknown, unknown, unknown>
> = {
	linear: LinearProvider,
	sentry: SentryProvider,
	github: GitHubProvider,
	posthog: PostHogProvider,
};

/**
 * Get provider by type with type safety
 */
export function getProviderByType(
	type: TriggerProviderType,
): TriggerProvider<unknown, unknown, unknown> | null {
	switch (type) {
		case "linear":
			return LinearProvider;
		case "sentry":
			return SentryProvider;
		case "github":
			return GitHubProvider;
		case "posthog":
			return PostHogProvider;
		case "gmail":
			return null;
		default:
			return null;
	}
}
