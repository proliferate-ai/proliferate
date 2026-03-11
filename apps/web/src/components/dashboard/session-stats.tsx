"use client";

import type { Session } from "@proliferate/shared/contracts/sessions";

/**
 * Compact activity summary for returning users.
 * Shows as a single text line — no stat cards (per design system rules).
 */
export function ActivitySummary({ sessions }: { sessions: Session[] }) {
	if (sessions.length === 0) return null;

	const now = new Date();
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	const recentCount = sessions.filter(
		(s) => s.startedAt && new Date(s.startedAt) >= weekAgo,
	).length;
	const activeCount = sessions.filter((s) => s.status.sandboxState === "running").length;

	const parts: string[] = [];
	if (recentCount > 0) {
		parts.push(`${recentCount} session${recentCount === 1 ? "" : "s"} this week`);
	}
	if (activeCount > 0) {
		parts.push(`${activeCount} running now`);
	}

	if (parts.length === 0) return null;

	return <p className="text-sm text-muted-foreground">{parts.join(" · ")}</p>;
}
