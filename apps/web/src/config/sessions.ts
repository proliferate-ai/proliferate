import type { DisplayStatus } from "@proliferate/shared/sessions";
import type { OverallWorkState } from "@proliferate/shared/sessions";

export type FilterTab = "in_progress" | "needs_attention" | "paused" | "completed";

export type OriginFilter = "all" | "manual" | "automation" | "coworker" | "slack" | "cli";

export type CreatorFilter = "all" | "mine";

export interface OverallWorkStateDisplayConfig {
	label: string;
	colorClassName: string;
	animated: boolean;
}

export const OVERALL_WORK_STATE_DISPLAY: Record<OverallWorkState, OverallWorkStateDisplayConfig> = {
	working: {
		label: "Working",
		colorClassName: "text-foreground",
		animated: true,
	},
	needs_input: {
		label: "Needs input",
		colorClassName: "text-muted-foreground",
		animated: false,
	},
	dormant: {
		label: "Dormant",
		colorClassName: "text-muted-foreground",
		animated: false,
	},
	done: {
		label: "Done",
		colorClassName: "text-muted-foreground",
		animated: false,
	},
};

export const TABS: { value: FilterTab; label: string }[] = [
	{ value: "in_progress", label: "In Progress" },
	{ value: "needs_attention", label: "Needs Attention" },
	{ value: "paused", label: "Paused" },
	{ value: "completed", label: "Completed" },
];

export const IN_PROGRESS_STATUSES: Set<DisplayStatus> = new Set(["active", "idle"]);
export const NEEDS_ATTENTION_STATUSES: Set<DisplayStatus> = new Set([
	"blocked",
	"failed",
	"recovering",
]);
export const LIVE_STATUSES: Set<DisplayStatus> = new Set([
	"active",
	"idle",
	"recovering",
	"blocked",
]);

export const DASHBOARD_ORIGIN_OPTIONS: { value: OriginFilter; label: string }[] = [
	{ value: "all", label: "All Origins" },
	{ value: "manual", label: "Manual" },
	{ value: "automation", label: "Coworker" },
	{ value: "slack", label: "Slack" },
	{ value: "cli", label: "CLI" },
];

export const SESSIONS_ORIGIN_OPTIONS: { value: OriginFilter; label: string }[] = [
	{ value: "all", label: "All Origins" },
	{ value: "manual", label: "Manual" },
	{ value: "coworker", label: "Coworker" },
	{ value: "slack", label: "Slack" },
	{ value: "cli", label: "CLI" },
];
