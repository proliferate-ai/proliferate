/**
 * Trigger Provider Exports
 */

// Public contract types
export type { TriggerProvider, TriggerProviderType, ParsedEventContext } from "./types";

// Provider implementations
export { LinearProvider, filterLinearByAction } from "./linear";
export { SentryProvider } from "./sentry";
export { GitHubProvider } from "./github";
export { PostHogProvider } from "./posthog";

// Trigger-service definitions and adapters
export * from "./service";

// Provider map and factory
import { GitHubProvider } from "./github";
import { LinearProvider } from "./linear";
import { PostHogProvider } from "./posthog";
import { SentryProvider } from "./sentry";
import type { TriggerProvider, TriggerProviderType } from "./types";

export const providers: Record<
	"linear" | "sentry" | "github" | "posthog",
	TriggerProvider<unknown, unknown, unknown>
> = {
	linear: LinearProvider,
	sentry: SentryProvider,
	github: GitHubProvider,
	posthog: PostHogProvider,
};

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
