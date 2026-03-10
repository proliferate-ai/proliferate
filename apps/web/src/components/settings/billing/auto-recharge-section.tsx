"use client";

import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings/settings-row";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AUTO_RECHARGE_CAP_OPTIONS } from "@/config/billing";
import type { BillingInfo } from "@/types/billing";
import { useState } from "react";

interface AutoRechargeSectionProps {
	billingSettings: BillingInfo["billingSettings"];
	onUpdate?: (settings: Partial<BillingInfo["billingSettings"]>) => Promise<void>;
}

export function AutoRechargeSection({ billingSettings, onUpdate }: AutoRechargeSectionProps) {
	const [isUpdating, setIsUpdating] = useState(false);

	const handleToggle = async (enabled: boolean) => {
		if (!onUpdate) return;
		setIsUpdating(true);
		try {
			await onUpdate({ auto_recharge_enabled: enabled });
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

	const isEnabled = billingSettings.auto_recharge_enabled;
	const currentCap = billingSettings.overage_cap_cents?.toString() ?? "unlimited";

	return (
		<SettingsSection title="Auto-Recharge">
			<SettingsCard>
				<SettingsRow
					label="Auto-recharge credits"
					description="Automatically purchase credits when your balance runs low"
				>
					<Switch checked={isEnabled} onCheckedChange={handleToggle} disabled={isUpdating} />
				</SettingsRow>

				{isEnabled && (
					<SettingsRow
						label="Spending cap"
						description="Maximum auto-recharge spending per billing cycle"
					>
						<Select value={currentCap} onValueChange={handleCapChange} disabled={isUpdating}>
							<SelectTrigger className="w-32">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{AUTO_RECHARGE_CAP_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsRow>
				)}
			</SettingsCard>

			{!isEnabled && (
				<p className="text-xs text-muted-foreground mt-2">
					Sessions will automatically pause when credits run out. You can resume them after
					purchasing more credits.
				</p>
			)}
		</SettingsSection>
	);
}
