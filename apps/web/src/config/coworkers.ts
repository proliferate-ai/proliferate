import type { Provider } from "@/components/integrations/provider-icon";
import { BlocksIcon, LinearIcon, SlackIcon } from "@/components/ui/icons";

export type CoworkerListTab = "all" | "active" | "paused";

export const COWORKER_LIST_TABS: { value: CoworkerListTab; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "active", label: "Active" },
	{ value: "paused", label: "Paused" },
];

type CapabilityProvider = Extract<Provider, "github" | "linear" | "sentry" | "slack" | "jira">;

export interface CapabilitySuggestion {
	capabilityKey: string;
	provider?: CapabilityProvider;
}

export const SUGGESTED_CAPABILITIES: CapabilitySuggestion[] = [
	{ capabilityKey: "source.github.read", provider: "github" },
	{ capabilityKey: "source.linear.read", provider: "linear" },
	{ capabilityKey: "source.sentry.read", provider: "sentry" },
];

export type DetailTab = "chat" | "sessions" | "configure";

export const DETAIL_TABS: { value: DetailTab; label: string }[] = [
	{ value: "chat", label: "Chat" },
	{ value: "sessions", label: "Sessions" },
	{ value: "configure", label: "Configure" },
];

export const ACTION_TOOLS = [
	{ key: "create_session" as const, label: "Agent", Icon: BlocksIcon, defaultOn: true },
	{ key: "slack_notify" as const, label: "Slack", Icon: SlackIcon },
	{ key: "create_linear_issue" as const, label: "Linear", Icon: LinearIcon },
];

export type WorkerStatus = "active" | "automations_paused" | "degraded" | "failed" | "archived";

export const WORKER_STATUS_DOT_MAP: Record<WorkerStatus, "active" | "paused" | "error"> = {
	active: "active",
	automations_paused: "paused",
	degraded: "error",
	failed: "error",
	archived: "paused",
};

export const WORKER_STATUS_LABELS: Record<WorkerStatus, string> = {
	active: "Active",
	automations_paused: "Paused",
	degraded: "Degraded",
	failed: "Failed",
	archived: "Archived",
};

// Deterministic color palette derived from name hash
export const ORB_PALETTES = [
	["#7C3AED", "#2563EB", "#06B6D4"], // violet -> blue -> cyan
	["#EC4899", "#8B5CF6", "#6366F1"], // pink -> purple -> indigo
	["#F59E0B", "#EF4444", "#EC4899"], // amber -> red -> pink
	["#10B981", "#06B6D4", "#3B82F6"], // emerald -> cyan -> blue
	["#F97316", "#F59E0B", "#EAB308"], // orange -> amber -> yellow
	["#8B5CF6", "#EC4899", "#F43F5E"], // purple -> pink -> rose
	["#14B8A6", "#10B981", "#22C55E"], // teal -> emerald -> green
	["#6366F1", "#8B5CF6", "#A855F7"], // indigo -> violet -> purple
];
