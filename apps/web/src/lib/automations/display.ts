import { type Provider, getProviderDisplayName } from "@/components/integrations/provider-icon";

export function normalizeProvider(provider: string | null | undefined): Provider {
	switch (provider) {
		case "github":
		case "sentry":
		case "linear":
		case "posthog":
		case "slack":
		case "gmail":
		case "webhook":
		case "scheduled":
			return provider;
		default:
			return "webhook";
	}
}

export function getEventTypeLabel(
	eventType: string | null | undefined,
	provider: Provider,
): string {
	if (eventType) {
		switch (eventType) {
			case "$rageclick":
				return "Rage click";
			case "$deadclick":
				return "Dead click";
			case "$exception":
				return "Exception";
			default:
				return eventType.replace(/^\$/, "");
		}
	}

	if (provider === "scheduled") {
		return "Schedule";
	}

	return getProviderDisplayName(provider);
}

export function getSeverityDotClass(severity: string | null): string {
	switch (severity) {
		case "critical":
			return "bg-destructive";
		case "high":
			return "bg-warning";
		case "medium":
			return "bg-warning";
		case "low":
			return "bg-success";
		default:
			return "bg-muted-foreground";
	}
}
