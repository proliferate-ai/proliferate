/**
 * Session display helpers.
 *
 * Pure formatting functions for session telemetry data,
 * used by session list rows, peek drawer, and my-work pages.
 */

/** Format activeSeconds → "12 min" or "1h 23m" or "< 1 min" */
export function formatActiveTime(seconds: number): string {
	if (seconds < 60) return "< 1 min";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/** Build compact metrics string → "28 tools · 12 min" */
export function formatCompactMetrics(metrics: {
	toolCalls: number;
	activeSeconds: number;
}): string {
	const parts: string[] = [];
	if (metrics.toolCalls > 0) {
		parts.push(`${metrics.toolCalls} tool${metrics.toolCalls !== 1 ? "s" : ""}`);
	}
	if (metrics.activeSeconds > 0) {
		parts.push(formatActiveTime(metrics.activeSeconds));
	}
	return parts.join(" · ");
}

/** Outcome display label + style class */
export function getOutcomeDisplay(outcome: string): { label: string; className: string } {
	switch (outcome) {
		case "succeeded":
			return { label: "Succeeded", className: "text-emerald-500" };
		case "failed":
			return { label: "Failed", className: "text-destructive" };
		case "needs_human":
			return { label: "Needs attention", className: "text-amber-500" };
		case "completed":
			return { label: "Completed", className: "text-muted-foreground" };
		default:
			return { label: outcome, className: "text-muted-foreground" };
	}
}

/** Shared display status config used by session rows and peek drawer. */
import type { DisplayStatus } from "@proliferate/shared/sessions";

export const DISPLAY_STATUS_CONFIG: Record<
	DisplayStatus,
	{ animated: boolean; label: string; colorClassName: string }
> = {
	active: { animated: true, label: "Running", colorClassName: "text-foreground" },
	idle: { animated: false, label: "Idle", colorClassName: "text-muted-foreground" },
	paused: { animated: false, label: "Paused", colorClassName: "text-muted-foreground" },
	blocked: { animated: false, label: "Blocked", colorClassName: "text-destructive" },
	recovering: { animated: true, label: "Reconnecting", colorClassName: "text-muted-foreground" },
	completed: {
		animated: false,
		label: "Completed",
		colorClassName: "text-muted-foreground/50",
	},
	failed: { animated: false, label: "Failed", colorClassName: "text-destructive" },
};

/** Returns true if `url` uses the https protocol. */
export function isHttpsUrl(url: string): boolean {
	return url.startsWith("https://");
}

/**
 * Extract repo name and PR number from a GitHub PR URL.
 * e.g. "https://github.com/acme/repo/pull/42" → { repo: "acme/repo", number: 42 }
 */
export function parsePrUrl(url: string): { repo: string; number: number } | null {
	const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
	if (!match) return null;
	return { repo: match[1], number: Number.parseInt(match[2], 10) };
}
