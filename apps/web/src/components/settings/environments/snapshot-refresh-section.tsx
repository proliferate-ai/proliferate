"use client";

import { Label } from "@/components/ui/label";
import { LoadingDots } from "@/components/ui/loading-dots";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConfiguration, useUpdateRefreshSettings } from "@/hooks/sessions/use-configurations";
import { formatDateWithYear } from "@/lib/display/format";

const INTERVAL_OPTIONS = [
	{ value: "60", label: "Every hour" },
	{ value: "180", label: "Every 3 hours" },
	{ value: "360", label: "Every 6 hours" },
	{ value: "720", label: "Every 12 hours" },
	{ value: "1440", label: "Every day" },
	{ value: "4320", label: "Every 3 days" },
	{ value: "10080", label: "Every week" },
];

interface SnapshotRefreshSectionProps {
	configurationId: string;
}

export function SnapshotRefreshSection({ configurationId }: SnapshotRefreshSectionProps) {
	const { data: configuration, isLoading } = useConfiguration(configurationId);
	const updateRefresh = useUpdateRefreshSettings();

	if (isLoading) {
		return (
			<section>
				<h2 className="text-sm font-medium mb-3">Snapshot Refresh</h2>
				<LoadingDots size="sm" className="text-muted-foreground" />
			</section>
		);
	}

	if (!configuration || configuration.status !== "ready") {
		return null;
	}

	const refreshEnabled = configuration.refreshEnabled ?? false;
	const refreshInterval = configuration.refreshIntervalMinutes ?? 360;

	return (
		<section>
			<h2 className="text-sm font-medium mb-3">Snapshot Refresh</h2>
			<div className="rounded-lg border border-border/80 bg-background p-4 space-y-3">
				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
						<Label htmlFor={`refresh-toggle-${configurationId}`} className="text-sm">
							Auto-refresh snapshot
						</Label>
						<p className="text-xs text-muted-foreground">
							Periodically pull latest code and rebuild the snapshot so new sessions start fresh.
						</p>
					</div>
					<Switch
						id={`refresh-toggle-${configurationId}`}
						checked={refreshEnabled}
						disabled={updateRefresh.isPending}
						onCheckedChange={(checked) => {
							updateRefresh.mutate({
								configurationId,
								refreshEnabled: checked,
								refreshIntervalMinutes: refreshInterval,
							});
						}}
					/>
				</div>

				{refreshEnabled && (
					<>
						<div className="flex items-center gap-3 pt-1">
							<Label className="text-xs text-muted-foreground shrink-0">Interval</Label>
							<Select
								value={String(refreshInterval)}
								onValueChange={(value) => {
									updateRefresh.mutate({
										configurationId,
										refreshEnabled: true,
										refreshIntervalMinutes: Number(value),
									});
								}}
								disabled={updateRefresh.isPending}
							>
								<SelectTrigger className="h-8 w-44 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{INTERVAL_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{configuration.lastRefreshedAt && (
							<p className="text-xs text-muted-foreground">
								Last refreshed: {formatDateWithYear(configuration.lastRefreshedAt)}
							</p>
						)}
					</>
				)}
			</div>
		</section>
	);
}
