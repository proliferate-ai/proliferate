import type { Provider } from "@/components/integrations/provider-icon";

type CapabilityProvider = Extract<Provider, "github" | "linear" | "sentry" | "slack" | "jira">;

export function inferProviderFromCapabilityKey(
	capabilityKey: string,
): CapabilityProvider | undefined {
	if (capabilityKey.startsWith("source.github.") || capabilityKey.startsWith("github.")) {
		return "github";
	}
	if (capabilityKey.startsWith("source.linear.") || capabilityKey.startsWith("linear.")) {
		return "linear";
	}
	if (capabilityKey.startsWith("source.sentry.") || capabilityKey.startsWith("sentry.")) {
		return "sentry";
	}
	if (capabilityKey.startsWith("slack.")) {
		return "slack";
	}
	if (capabilityKey.startsWith("jira.")) {
		return "jira";
	}
	return undefined;
}
