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

// 12 orb palettes: [base, accent, highlight, structure].
// structure: "nebula" (3 blobs), "glow" (centered radial), "split" (two-tone sweep).
// Designed for max hue separation and rich saturation on dark backgrounds.
export const ORB_PALETTES: [string, string, string, "nebula" | "glow" | "split"][] = [
	["#6366F1", "#06B6D4", "#A5F3FC", "nebula"], // 0  indigo-cyan
	["#F43F5E", "#FB923C", "#FDE68A", "glow"], // 1  rose-gold
	["#10B981", "#34D399", "#A7F3D0", "split"], // 2  emerald-mint
	["#8B5CF6", "#D946EF", "#F0ABFC", "nebula"], // 3  violet-fuchsia
	["#F59E0B", "#DC2626", "#FCA5A5", "glow"], // 4  amber-crimson
	["#0EA5E9", "#3B82F6", "#BFDBFE", "split"], // 5  sky-blue
	["#EC4899", "#A855F7", "#E9D5FF", "glow"], // 6  pink-purple
	["#14B8A6", "#059669", "#6EE7B7", "nebula"], // 7  teal-emerald
	["#F97316", "#FACC15", "#FEF9C3", "split"], // 8  orange-gold
	["#7C3AED", "#2563EB", "#93C5FD", "glow"], // 9  purple-blue
	["#84CC16", "#22C55E", "#BBF7D0", "nebula"], // 10 lime-green
	["#E11D48", "#BE185D", "#FBCFE8", "split"], // 11 crimson-rose
];

export interface WorkerSession {
	id: string;
	title: string | null;
	status: string;
	repoId: string | null;
	branchName: string | null;
	agentState: string | null;
	terminalState: string | null;
	updatedAt: string;
	startedAt: string | null;
}
