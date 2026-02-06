"use client";

import { type Provider, ProviderIcon } from "@/components/integrations/provider-icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

interface AutomationCardProps {
	id: string;
	name: string;
	description?: string | null;
	enabled: boolean;
	updatedAt: string;
	triggerCount: number;
	scheduleCount: number;
	activeProviders: string[];
}

export function AutomationCard({
	id,
	name,
	description,
	enabled,
	updatedAt,
	triggerCount,
	scheduleCount,
	activeProviders,
}: AutomationCardProps) {
	const timeAgo = formatDistanceToNow(new Date(updatedAt), { addSuffix: true });

	return (
		<Link href={`/dashboard/automations/${id}`}>
			<div
				className={cn(
					"group p-4 rounded-lg border border-border bg-card",
					"hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer",
				)}
			>
				{/* Header: Name + Timestamp */}
				<div className="flex items-start justify-between gap-4 mb-3">
					<h3 className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
						{name}
					</h3>
					<span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
						{timeAgo}
					</span>
				</div>

				{/* Description (optional) */}
				{description && (
					<p className="text-sm text-muted-foreground mb-3 line-clamp-2">{description}</p>
				)}

				{/* Footer: Provider icons + Status */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{/* Provider icons */}
						{activeProviders.length > 0 ? (
							<div className="flex items-center gap-1">
								{activeProviders.map((provider) => (
									<div key={provider} className="p-1.5 rounded bg-muted">
										<ProviderIcon provider={provider as Provider} className="h-4 w-4" />
									</div>
								))}
							</div>
						) : null}

						{/* Counts */}
						<span className="text-xs text-muted-foreground">
							{triggerCount} {triggerCount === 1 ? "trigger" : "triggers"}
							{scheduleCount > 0 && (
								<>
									{" "}
									· {scheduleCount} {scheduleCount === 1 ? "schedule" : "schedules"}
								</>
							)}
						</span>
					</div>

					{/* Status badge */}
					<Badge
						variant={enabled ? "default" : "secondary"}
						className={cn(
							"text-xs",
							enabled
								? "bg-green-500/10 text-green-600 border-green-500/20"
								: "bg-muted text-muted-foreground",
						)}
					>
						{enabled ? "Active" : "Paused"}
					</Badge>
				</div>
			</div>
		</Link>
	);
}
