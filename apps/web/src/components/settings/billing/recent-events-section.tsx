"use client";

import { SettingsCard, SettingsSection } from "@/components/settings/settings-row";
import { useRecentEvents } from "@/hooks/org/use-billing";

function formatCredits(n: number): string {
	return Math.round(n).toLocaleString();
}

function formatTime(iso: string): string {
	const d = new Date(iso);
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffMin = Math.floor(diffMs / 60000);

	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;

	const diffHours = Math.floor(diffMin / 60);
	if (diffHours < 24) return `${diffHours}h ago`;

	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays}d ago`;

	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function RecentEventsSection() {
	const { data, isPending, isError } = useRecentEvents(10);

	if (isPending) {
		return (
			<SettingsSection title="Recent Billing Events">
				<div className="h-20 rounded-lg bg-muted/30 animate-pulse" />
			</SettingsSection>
		);
	}

	if (isError) {
		return (
			<SettingsSection title="Recent Billing Events">
				<p className="text-sm text-muted-foreground py-4">Failed to load billing events.</p>
			</SettingsSection>
		);
	}

	if (!data || data.events.length === 0) {
		return (
			<SettingsSection title="Recent Billing Events">
				<p className="text-sm text-muted-foreground py-4">No billing events yet.</p>
			</SettingsSection>
		);
	}

	return (
		<SettingsSection title="Recent Billing Events">
			<SettingsCard>
				{data.events.map((event) => (
					<li key={event.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
						<div className="flex items-center gap-2 min-w-0">
							<span className="inline-flex items-center rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
								{event.eventType}
							</span>
							{event.sessionIds && event.sessionIds.length > 0 && (
								<span className="text-xs text-muted-foreground truncate">
									{event.sessionIds.length === 1
										? `Session ${event.sessionIds[0].slice(0, 8)}`
										: `${event.sessionIds.length} sessions`}
								</span>
							)}
						</div>
						<div className="flex items-center gap-3 shrink-0">
							<span className="text-xs text-muted-foreground">{formatTime(event.createdAt)}</span>
							<span className="font-medium tabular-nums">{formatCredits(event.credits)}</span>
						</div>
					</li>
				))}
			</SettingsCard>
			{data.total > 10 && (
				<p className="text-xs text-muted-foreground mt-1">Showing 10 of {data.total} events</p>
			)}
		</SettingsSection>
	);
}
