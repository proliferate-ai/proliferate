"use client";

import { RunRow } from "@/components/automations/events/run-row";
import { Button } from "@/components/ui/button";
import { PageBackLink } from "@/components/ui/page-back-link";
import { useAutomation, useAutomationRuns } from "@/hooks/automations/use-automations";
import { RUN_STATUS_FILTERS, type RunStatusFilter } from "@/lib/display/run-status";
import { cn } from "@/lib/display/utils";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { use, useEffect, useState } from "react";

export default function AutomationRunsPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id: automationId } = use(params);
	const searchParams = useSearchParams();
	const deepLinkRunId = searchParams.get("runId");

	const [statusFilter, setStatusFilter] = useState<RunStatusFilter>("all");
	const [expandedRunId, setExpandedRunId] = useState<string | null>(deepLinkRunId);

	useEffect(() => {
		if (deepLinkRunId) {
			setExpandedRunId(deepLinkRunId);
		}
	}, [deepLinkRunId]);

	const filterValue = statusFilter === "all" ? undefined : statusFilter;
	const { data: automation } = useAutomation(automationId);
	const {
		data: runsData,
		isLoading,
		error,
		refetch,
		isFetching,
	} = useAutomationRuns(automationId, { status: filterValue });

	const runs = runsData?.runs ?? [];
	const total = runsData?.total ?? 0;
	const runLabel = total === 1 ? "run" : "runs";

	function handleToggleRun(runId: string) {
		setExpandedRunId((previous) => (previous === runId ? null : runId));
	}

	return (
		<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
			<div className="w-full max-w-5xl mx-auto px-6 py-6">
				<PageBackLink href={`/coworkers/${automationId}`} label="Coworker" className="mb-3" />

				<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
					<div>
						<h1 className="text-lg font-semibold tracking-tight text-foreground">Runs</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							{automation?.name || "Coworker"} · {total} {runLabel}
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetch()}
						disabled={isFetching}
						className="h-8 gap-1.5 text-xs"
					>
						<RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
						Refresh
					</Button>
				</div>

				<div className="mb-4 flex flex-wrap gap-1">
					{RUN_STATUS_FILTERS.map((filter) => (
						<button
							key={filter.value}
							type="button"
							onClick={() => setStatusFilter(filter.value)}
							className={cn(
								"rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
								statusFilter === filter.value
									? "bg-secondary text-foreground"
									: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
							)}
						>
							{filter.label}
						</button>
					))}
				</div>

				{isLoading ? (
					<div className="rounded-xl border border-border bg-card overflow-hidden">
						{[1, 2, 3, 4].map((index) => (
							<div
								key={index}
								className="h-[68px] border-b border-border/60 last:border-b-0 animate-pulse bg-muted/30"
							/>
						))}
					</div>
				) : error ? (
					<div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
						<AlertCircle className="mx-auto h-5 w-5 text-destructive" />
						<p className="mt-3 text-sm font-medium text-foreground">Failed to load runs</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Try refreshing the page to retry the request.
						</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-4 h-8 text-xs"
							onClick={() => refetch()}
						>
							Retry
						</Button>
					</div>
				) : runs.length === 0 ? (
					<div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
						<div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
							<Inbox className="h-5 w-5 text-muted-foreground" />
						</div>
						<p className="mt-3 text-sm font-medium text-foreground">No runs yet</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Runs will appear here when this coworker is triggered.
						</p>
					</div>
				) : (
					<div className="rounded-xl border border-border bg-card overflow-hidden">
						{runs.map((run) => (
							<RunRow
								key={run.id}
								run={run}
								isExpanded={expandedRunId === run.id}
								onToggle={() => handleToggleRun(run.id)}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
