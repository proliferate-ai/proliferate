"use client";

import { SettingsCard, SettingsSection } from "@/components/settings/settings-row";
import type { BillingInfo } from "@/types/billing";

interface CreditUsageSectionProps {
	credits: BillingInfo["credits"];
}

function formatCredits(credits: number): string {
	return credits.toLocaleString();
}

function formatDate(isoString: string | null): string {
	if (!isoString) return "N/A";
	return new Date(isoString).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function UsageBar({ used, total, label }: { used: number; total: number; label: string }) {
	const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
	const isLow = percentage > 80;

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between text-sm">
				<span className="text-muted-foreground">{label}</span>
				<span className="font-medium">
					{formatCredits(used)} / {formatCredits(total)} credits
				</span>
			</div>
			<div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
				<div
					className={`h-full rounded-full transition-all ${isLow ? "bg-amber-500" : "bg-primary"}`}
					style={{ width: `${percentage}%` }}
				/>
			</div>
		</div>
	);
}

export function CreditUsageSection({ credits }: CreditUsageSectionProps) {
	return (
		<SettingsSection title="Credit Usage">
			<SettingsCard>
				<div className="p-4 space-y-4">
					{/* Summary */}
					<div className="flex items-center justify-between pb-3 border-b border-border/60">
						<div>
							<p className="text-sm font-medium">Available Balance</p>
							<p className="text-2xl font-semibold">{formatCredits(credits.balance)} credits</p>
						</div>
						{credits.nextResetAt && (
							<div className="text-right">
								<p className="text-xs text-muted-foreground">Resets on</p>
								<p className="text-sm">{formatDate(credits.nextResetAt)}</p>
							</div>
						)}
					</div>

					{/* Usage breakdown */}
					<div className="space-y-4">
						<UsageBar used={credits.used} total={credits.included} label="Usage This Period" />
					</div>

					{/* Credit value note */}
					<p className="text-xs text-muted-foreground">
						1 credit = $0.01. Usage includes compute time and LLM API calls.
					</p>
				</div>
			</SettingsCard>
		</SettingsSection>
	);
}
