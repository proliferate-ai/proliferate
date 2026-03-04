"use client";

import { SettingsCard, SettingsSection } from "@/components/settings/settings-row";
import { useUsageSummary } from "@/hooks/org/use-billing";

function formatCredits(n: number): string {
	return Math.round(n).toLocaleString();
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

export function UsageSummarySection() {
	const { data, isPending } = useUsageSummary();

	if (isPending) {
		return (
			<SettingsSection title="Usage This Period">
				<div className="h-20 rounded-lg bg-muted/30 animate-pulse" />
			</SettingsSection>
		);
	}

	if (!data) return null;

	const { totalCredits, computeCredits, llmCredits, eventCount, periodStart, periodEnd } = data;

	return (
		<SettingsSection title="Usage This Period">
			<SettingsCard>
				<li className="px-4 py-3">
					<div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
						<span>
							{formatDate(periodStart)} – {formatDate(periodEnd)}
						</span>
						<span>{eventCount} billable events</span>
					</div>
					<div className="grid grid-cols-3 gap-4">
						<div>
							<p className="text-xs text-muted-foreground">Total</p>
							<p className="text-lg font-semibold">{formatCredits(totalCredits)}</p>
						</div>
						<div>
							<p className="text-xs text-muted-foreground">Compute</p>
							<p className="text-sm font-medium">{formatCredits(computeCredits)}</p>
						</div>
						<div>
							<p className="text-xs text-muted-foreground">LLM</p>
							<p className="text-sm font-medium">{formatCredits(llmCredits)}</p>
						</div>
					</div>
				</li>
			</SettingsCard>
		</SettingsSection>
	);
}
