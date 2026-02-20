"use client";

import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings/settings-row";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { BillingInfo } from "@/types/billing";
import { AlertTriangle, Pause, Play } from "lucide-react";
import { useState } from "react";

interface OverageSectionProps {
	billingSettings: BillingInfo["billingSettings"];
	overage: BillingInfo["overage"];
	onUpdate?: (settings: Partial<BillingInfo["billingSettings"]>) => Promise<void>;
}

const OVERAGE_CAP_OPTIONS = [
	{ value: "5000", label: "$50" },
	{ value: "10000", label: "$100" },
	{ value: "20000", label: "$200" },
	{ value: "50000", label: "$500" },
	{ value: "unlimited", label: "Unlimited" },
];

function formatCurrency(cents: number): string {
	return (cents / 100).toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
	});
}

export function OverageSection({ billingSettings, overage, onUpdate }: OverageSectionProps) {
	const [isUpdating, setIsUpdating] = useState(false);

	const handlePolicyChange = async (policy: "pause" | "allow") => {
		if (!onUpdate) return;
		setIsUpdating(true);
		try {
			await onUpdate({ overage_policy: policy });
		} finally {
			setIsUpdating(false);
		}
	};

	const handleCapChange = async (value: string) => {
		if (!onUpdate) return;
		setIsUpdating(true);
		try {
			const cap = value === "unlimited" ? null : Number.parseInt(value, 10);
			await onUpdate({ overage_cap_cents: cap });
		} finally {
			setIsUpdating(false);
		}
	};

	const isPaused = billingSettings.overage_policy === "pause";
	const currentCap = billingSettings.overage_cap_cents?.toString() ?? "unlimited";

	return (
		<SettingsSection title="Overage Policy">
			<SettingsCard>
				<SettingsRow
					label="When credits run out"
					description="What happens when you exceed your monthly credit allowance"
				>
					<div className="flex items-center gap-2">
						<Button
							variant={isPaused ? "default" : "outline"}
							size="sm"
							className="gap-1.5"
							onClick={() => handlePolicyChange("pause")}
							disabled={isUpdating}
						>
							<Pause className="h-3.5 w-3.5" />
							Pause sessions
						</Button>
						<Button
							variant={!isPaused ? "default" : "outline"}
							size="sm"
							className="gap-1.5"
							onClick={() => handlePolicyChange("allow")}
							disabled={isUpdating}
						>
							<Play className="h-3.5 w-3.5" />
							Continue (billed)
						</Button>
					</div>
				</SettingsRow>

				{!isPaused && (
					<SettingsRow
						label="Monthly overage cap"
						description="Maximum extra spending per month beyond included credits"
					>
						<Select value={currentCap} onValueChange={handleCapChange} disabled={isUpdating}>
							<SelectTrigger className="w-32">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{OVERAGE_CAP_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsRow>
				)}

				{!isPaused && overage.usedCents > 0 && (
					<div className="px-4 py-3 bg-amber-500/10 border-t border-amber-500/20">
						<div className="flex items-center gap-2 text-sm">
							<AlertTriangle className="h-4 w-4 text-amber-500" />
							<span className="text-amber-700 dark:text-amber-400">
								Overage this month:{" "}
								<span className="font-medium">{formatCurrency(overage.usedCents)}</span>
							</span>
						</div>
					</div>
				)}
			</SettingsCard>

			{isPaused && (
				<p className="text-xs text-muted-foreground mt-2">
					Sessions will automatically pause when credits run out. You can resume them after adding
					more credits.
				</p>
			)}
		</SettingsSection>
	);
}
