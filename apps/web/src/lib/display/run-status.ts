import { type Provider, getProviderDisplayName } from "@/components/integrations/provider-icon";
import type { AutomationRunStatus } from "@proliferate/shared";
import {
	AlertCircle,
	Ban,
	CheckCircle2,
	Clock,
	Hand,
	Loader2,
	SkipForward,
	Timer,
	XCircle,
} from "lucide-react";

export function getRunStatusDisplay(status: string) {
	switch (status) {
		case "succeeded":
			return { icon: CheckCircle2, label: "Succeeded", className: "text-emerald-500" };
		case "failed":
			return { icon: XCircle, label: "Failed", className: "text-destructive" };
		case "needs_human":
			return { icon: Hand, label: "Needs attention", className: "text-amber-500" };
		case "timed_out":
			return { icon: Timer, label: "Timed out", className: "text-orange-500" };
		case "canceled":
			return { icon: Ban, label: "Canceled", className: "text-muted-foreground" };
		case "skipped":
			return { icon: SkipForward, label: "Skipped", className: "text-muted-foreground" };
		case "running":
			return { icon: Loader2, label: "Running", className: "text-emerald-500" };
		case "queued":
		case "enriching":
		case "ready":
			return {
				icon: Clock,
				label: status.charAt(0).toUpperCase() + status.slice(1),
				className: "text-muted-foreground",
			};
		default:
			return { icon: AlertCircle, label: status, className: "text-muted-foreground" };
	}
}

export type RunStatusFilter = "all" | AutomationRunStatus;

export const RUN_STATUS_FILTERS: Array<{ value: RunStatusFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "running", label: "Running" },
	{ value: "queued", label: "Queued" },
	{ value: "enriching", label: "Enriching" },
	{ value: "ready", label: "Ready" },
	{ value: "succeeded", label: "Succeeded" },
	{ value: "failed", label: "Failed" },
	{ value: "needs_human", label: "Needs attention" },
	{ value: "timed_out", label: "Timed out" },
	{ value: "skipped", label: "Skipped" },
	{ value: "canceled", label: "Canceled" },
];

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
			return "bg-orange-500";
		case "medium":
			return "bg-yellow-500";
		case "low":
			return "bg-emerald-500";
		default:
			return "bg-muted-foreground";
	}
}
