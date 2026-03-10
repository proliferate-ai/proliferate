"use client";

import { SettingsCard, SettingsSection } from "@/components/settings/settings-row";
import { useEntitlementStatus } from "@/hooks/org/use-billing";

function LimitRow({
	label,
	current,
	max,
	warningLevel,
}: {
	label: string;
	current: number;
	max: number;
	warningLevel?: string;
}) {
	const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0;
	const isWarning = warningLevel === "approaching" || percentage >= 80;
	const isCritical =
		warningLevel === "critical" || warningLevel === "exhausted" || percentage >= 95;

	return (
		<li className="px-4 py-2.5">
			<div className="flex items-center justify-between text-sm mb-1.5">
				<span className="text-muted-foreground">{label}</span>
				<span className="font-medium tabular-nums">
					{current} / {max}
				</span>
			</div>
			<div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
				<div
					className={`h-full rounded-full transition-all ${
						isCritical ? "bg-destructive" : isWarning ? "bg-accent-foreground/60" : "bg-primary"
					}`}
					style={{ width: `${percentage}%` }}
				/>
			</div>
		</li>
	);
}

export function EntitlementStatusSection() {
	const { data, isPending } = useEntitlementStatus();

	if (isPending) {
		return (
			<SettingsSection title="Plan Limits">
				<div className="h-20 rounded-lg bg-muted/30 animate-pulse" />
			</SettingsSection>
		);
	}

	if (!data) return null;

	return (
		<SettingsSection title="Plan Limits">
			<SettingsCard>
				<LimitRow
					label="Concurrent Sessions"
					current={data.concurrentSessions.current}
					max={data.concurrentSessions.max}
				/>
				<LimitRow
					label="Active Coworkers"
					current={data.activeCoworkers.current}
					max={data.activeCoworkers.max}
				/>
			</SettingsCard>
		</SettingsSection>
	);
}
