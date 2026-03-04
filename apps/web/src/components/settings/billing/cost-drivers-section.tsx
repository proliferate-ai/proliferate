"use client";

import { SettingsCard, SettingsSection } from "@/components/settings/settings-row";
import { useCostDrivers } from "@/hooks/org/use-billing";

function formatCredits(n: number): string {
	return Math.round(n).toLocaleString();
}

export function CostDriversSection() {
	const { data, isPending } = useCostDrivers(5);

	if (isPending) {
		return (
			<SettingsSection title="Top Cost Drivers">
				<div className="h-20 rounded-lg bg-muted/30 animate-pulse" />
			</SettingsSection>
		);
	}

	if (!data || data.length === 0) return null;

	return (
		<SettingsSection title="Top Cost Drivers">
			<SettingsCard>
				{data.map((driver) => (
					<li
						key={driver.entityId}
						className="flex items-center justify-between px-4 py-2.5 text-sm"
					>
						<div className="flex items-center gap-2 min-w-0">
							<span className="truncate">{driver.label}</span>
							<span className="text-xs text-muted-foreground">{driver.eventCount} events</span>
						</div>
						<div className="flex items-center gap-3 shrink-0">
							<span className="text-xs text-muted-foreground">{driver.percentage.toFixed(1)}%</span>
							<span className="font-medium tabular-nums">{formatCredits(driver.credits)}</span>
						</div>
					</li>
				))}
			</SettingsCard>
		</SettingsSection>
	);
}
