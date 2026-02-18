"use client";

import {
	ActivityIllustration,
	InfoBadge,
	PageEmptyState,
} from "@/components/dashboard/page-empty-state";
import { PageShell } from "@/components/dashboard/page-shell";
import { AutomationsIcon } from "@/components/ui/icons";
import { useOrgActivity } from "@/hooks/use-org-activity";
import { getRunStatusDisplay } from "@/lib/run-status";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { AutomationRunStatus } from "@proliferate/shared";
import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const STATUS_FILTERS: { value: AutomationRunStatus | "all"; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "running", label: "Running" },
	{ value: "succeeded", label: "Succeeded" },
	{ value: "failed", label: "Failed" },
	{ value: "needs_human", label: "Needs Attention" },
];

export default function ActivityPage() {
	const [statusFilter, setStatusFilter] = useState<AutomationRunStatus | "all">("all");
	const [offset, setOffset] = useState(0);
	const limit = 25;

	const { runs, total, isLoading } = useOrgActivity({
		status: statusFilter === "all" ? undefined : statusFilter,
		limit,
		offset,
	});

	const hasMore = offset + limit < total;

	return (
		<PageShell title="Activity">
			{/* Status filter pills */}
			<div className="flex items-center gap-1 mb-4">
				{STATUS_FILTERS.map((filter) => (
					<button
						key={filter.value}
						type="button"
						onClick={() => {
							setStatusFilter(filter.value);
							setOffset(0);
						}}
						className={cn(
							"px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
							statusFilter === filter.value
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
						)}
					>
						{filter.label}
					</button>
				))}
			</div>

			{/* Content */}
			{isLoading ? (
				<div className="flex items-center justify-center py-16">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			) : runs.length === 0 ? (
				<PageEmptyState
					illustration={<ActivityIllustration />}
					badge={<InfoBadge />}
					title="No activity yet"
					description="Automation runs across your organization will appear here as they complete."
				/>
			) : (
				<>
					<div className="rounded-lg border border-border bg-card overflow-hidden">
						{runs.map((run) => {
							const statusDisplay = getRunStatusDisplay(run.status);
							const StatusIcon = statusDisplay.icon;
							const timeAgo = run.completed_at
								? formatRelativeTime(run.completed_at)
								: formatRelativeTime(run.queued_at);

							return (
								<Link
									key={run.id}
									href={
										run.session_id
											? `/workspace/${run.session_id}?runId=${run.id}`
											: `/dashboard/automations/${run.automation_id}/events`
									}
								>
									<div className="flex items-center px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm cursor-pointer last:border-0 gap-3">
										<StatusIcon
											className={cn(
												"h-3.5 w-3.5 shrink-0",
												statusDisplay.className,
												run.status === "running" && "animate-spin",
											)}
										/>
										<div className="flex items-center gap-1.5 min-w-0 flex-1">
											<AutomationsIcon className="h-3 w-3 text-muted-foreground shrink-0" />
											<span className="font-medium text-foreground truncate">Automation run</span>
										</div>
										{run.trigger?.provider && (
											<span className="text-xs text-muted-foreground shrink-0">
												{run.trigger.provider}
											</span>
										)}
										<span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
											{timeAgo}
										</span>
										<span
											className={cn(
												"inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-[11px] font-medium shrink-0",
												statusDisplay.className,
											)}
										>
											{statusDisplay.label}
										</span>
										<ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0" />
									</div>
								</Link>
							);
						})}
					</div>

					{/* Pagination */}
					{(offset > 0 || hasMore) && (
						<div className="flex items-center justify-between mt-4">
							<button
								type="button"
								onClick={() => setOffset(Math.max(0, offset - limit))}
								disabled={offset === 0}
								className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
							>
								Previous
							</button>
							<span className="text-xs text-muted-foreground">
								{offset + 1}–{Math.min(offset + limit, total)} of {total}
							</span>
							<button
								type="button"
								onClick={() => setOffset(offset + limit)}
								disabled={!hasMore}
								className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
							>
								Next
							</button>
						</div>
					)}
				</>
			)}
		</PageShell>
	);
}
