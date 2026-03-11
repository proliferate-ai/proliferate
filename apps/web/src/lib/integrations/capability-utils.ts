import type { Provider } from "@/components/integrations/provider-icon";

type CapabilityProvider = Extract<
	Provider,
	| "github"
	| "linear"
	| "sentry"
	| "slack"
	| "jira"
	| "posthog"
	| "mysql"
	| "mongodb"
	| "grafana"
	| "gmail"
	| "webhook"
>;

const PREFIX_TO_PROVIDER: [string, CapabilityProvider][] = [
	["source.github.", "github"],
	["github.", "github"],
	["source.linear.", "linear"],
	["linear.", "linear"],
	["source.sentry.", "sentry"],
	["sentry.", "sentry"],
	["slack.", "slack"],
	["jira.", "jira"],
	["posthog.", "posthog"],
	["mysql.", "mysql"],
	["mongodb.", "mongodb"],
	["grafana.", "grafana"],
	["gmail.", "gmail"],
	["webhook.", "webhook"],
];

export function inferProviderFromCapabilityKey(
	capabilityKey: string,
): CapabilityProvider | undefined {
	for (const [prefix, provider] of PREFIX_TO_PROVIDER) {
		if (capabilityKey.startsWith(prefix)) return provider;
	}
	return undefined;
}

/** Map an integration identifier (e.g. "github", "sentry") to its Provider icon key. */
export function getProviderForIntegration(integration: string): Provider | null {
	if (integration === "github" || integration === "jira" || integration === "linear") {
		return integration;
	}
	if (integration === "posthog" || integration === "sentry" || integration === "slack") {
		return integration;
	}
	return null;
}
