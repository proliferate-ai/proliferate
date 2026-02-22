"use client";

import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
} from "@/components/integrations/provider-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageBackLink } from "@/components/ui/page-back-link";
import { useAutomation, useAutomationRuns } from "@/hooks/use-automations";
import { getRunStatusDisplay } from "@/lib/run-status";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { AutomationRun, AutomationRunStatus, ParsedEventContext } from "@proliferate/shared";
import { AlertCircle, Bot, ChevronRight, Inbox, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";

type RunStatusFilter = "all" | AutomationRunStatus;

const RUN_STATUS_FILTERS: Array<{ value: RunStatusFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "running", label: "Running" },
	{ value: "queued", label: "Queued" },
	{ value: "enriching", label: "Enriching" },
	{ value: "ready", label: "Ready" },
	{ value: "succeeded", label: "Succeeded" },
	{ value: "failed", label: "Failed" },
	{ value: "needs_human", label: "Needs attention" },
	{ value: "timed_out", label: "Timed out" },
	{ value: "skipped", label: "Skipped" },
	{ value: "canceled", label: "Canceled" },
];

function normalizeProvider(provider: string | null | undefined): Provider {
	switch (provider) {
		case "github":
		case "sentry":
		case "linear":
		case "posthog":
		case "slack":
		case "gmail":
		case "webhook":
		case "scheduled":
			return provider;
		default:
			return "webhook";
	}
}

function getEventTypeLabel(eventType: string | null | undefined, provider: Provider): string {
	if (eventType) {
		switch (eventType) {
			case "$rageclick":
				return "Rage click";
			case "$deadclick":
				return "Dead click";
			case "$exception":
				return "Exception";
			default:
				return eventType.replace(/^\$/, "");
		}
	}

	if (provider === "scheduled") {
		return "Schedule";
	}

	return getProviderDisplayName(provider);
}

function getSeverityDotClass(severity: string | null): string {
	switch (severity) {
		case "critical":
			return "bg-destructive";
		case "high":
			return "bg-orange-500";
		case "medium":
			return "bg-yellow-500";
		case "low":
			return "bg-emerald-500";
		default:
			return "bg-muted-foreground";
	}
}

function RunStatusPill({ status }: { status: AutomationRunStatus }) {
	const statusDisplay = getRunStatusDisplay(status);
	const StatusIcon = statusDisplay.icon;
	const shouldSpin = status === "running";

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium",
				statusDisplay.className,
			)}
		>
			<StatusIcon className={cn("h-3 w-3", shouldSpin && "animate-spin")} />
			{statusDisplay.label}
		</span>
	);
}

function RunDetailSection({ run }: { run: AutomationRun }) {
	const parsedContext = run.trigger_event?.parsed_context as ParsedEventContext | null;
	const provider = normalizeProvider(run.trigger?.provider);
	const eventType = getEventTypeLabel(run.trigger_event?.provider_event_type, provider);

	const rawAnalysis = (parsedContext as Record<string, unknown> | null)
		?.llm_analysis_result as Record<string, unknown> | null;
	const analysis = rawAnalysis
		? {
				severity: typeof rawAnalysis.severity === "string" ? rawAnalysis.severity : null,
				summary: typeof rawAnalysis.summary === "string" ? rawAnalysis.summary : null,
				rootCause: typeof rawAnalysis.rootCause === "string" ? rawAnalysis.rootCause : null,
				recommendedActions: Array.isArray(rawAnalysis.recommendedActions)
					? rawAnalysis.recommendedActions.filter(
							(action): action is string => typeof action === "string",
						)
					: [],
			}
		: null;

	const contextParts = useMemo(() => {
		const parts: string[] = [];
		if (parsedContext?.title) {
			parts.push(parsedContext.title);
		}

		const context = parsedContext as Record<string, unknown> | null;
		if (context?.posthog) {
			const posthog = context.posthog as Record<string, unknown>;
			if (posthog.current_url) parts.push(`URL: ${posthog.current_url}`);
			if (posthog.person) {
				const person = posthog.person as Record<string, unknown>;
				parts.push(`User: ${person.name || person.email || "Anonymous"}`);
			}
		}

		if (context?.sentry) {
			const sentry = context.sentry as Record<string, unknown>;
			if (sentry.issue_title) parts.push(`Issue: ${sentry.issue_title}`);
			if (sentry.project) parts.push(`Project: ${sentry.project}`);
		}

		if (context?.github) {
			const github = context.github as Record<string, unknown>;
			if (github.repo) parts.push(`Repo: ${github.repo}`);
			if (github.title) parts.push(`Title: ${github.title}`);
		}

		return parts;
	}, [parsedContext]);

	return (
		<div className="border-t border-border/60 bg-muted/20 px-4 py-4">
			<div className="grid gap-4 md:grid-cols-2">
				<section className="space-y-2">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Trigger
					</p>
					<div className="flex items-center gap-2">
						<ProviderIcon provider={provider} size="sm" />
						<span className="text-sm font-medium text-foreground">
							{getProviderDisplayName(provider)}
						</span>
						<Badge variant="outline" className="text-[10px] font-medium">
							{eventType}
						</Badge>
					</div>
					{contextParts.length > 0 && (
						<div className="space-y-1">
							{contextParts.map((part) => (
								<p key={part} className="text-xs text-muted-foreground">
									{part}
								</p>
							))}
						</div>
					)}
				</section>

				{analysis && (
					<section className="space-y-2">
						<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Analysis
						</p>
						<div className="flex items-center gap-2">
							<span
								className={cn("h-2.5 w-2.5 rounded-full", getSeverityDotClass(analysis.severity))}
							/>
							<span className="text-sm font-medium capitalize text-foreground">
								{analysis.severity || "Unknown"}
							</span>
						</div>
						{analysis.summary && <p className="text-sm text-foreground">{analysis.summary}</p>}
						{analysis.rootCause && (
							<p className="text-xs text-muted-foreground">
								<span className="font-medium text-foreground">Root cause:</span>{" "}
								{analysis.rootCause}
							</p>
						)}
						{analysis.recommendedActions.length > 0 && (
							<div className="flex flex-wrap gap-1.5">
								{analysis.recommendedActions.map((action) => (
									<Badge key={action} variant="outline">
										{action}
									</Badge>
								))}
							</div>
						)}
					</section>
				)}
			</div>

			{run.session_id && (
				<div className="mt-4">
					<Link href={`/workspace/${run.session_id}`}>
						<Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
							<Bot className="h-3.5 w-3.5" />
							View agent session
						</Button>
					</Link>
				</div>
			)}

			{(run.status_reason || run.error_message) && (
				<div className="mt-4 space-y-1.5">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Status info
					</p>
					{run.status_reason && (
						<p className="text-xs text-muted-foreground">
							<span className="font-medium text-foreground">Reason:</span> {run.status_reason}
						</p>
					)}
					{run.error_message && (
						<p className="text-xs text-destructive">
							<span className="font-medium">Error:</span> {run.error_message}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function RunRow({
	run,
	isExpanded,
	onToggle,
}: {
	run: AutomationRun;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	const parsedContext = run.trigger_event?.parsed_context as ParsedEventContext | null;
	const provider = normalizeProvider(run.trigger?.provider);
	const eventType = getEventTypeLabel(run.trigger_event?.provider_event_type, provider);

	const title = parsedContext?.title || run.trigger?.name || "Automation run";
	const timeAgo = run.queued_at ? formatRelativeTime(run.queued_at) : "unknown";
	const exactTime = run.queued_at ? new Date(run.queued_at).toLocaleString() : "";
	const hasSession = !!run.session_id;

	return (
		<div className="border-b border-border/60 last:border-b-0">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={isExpanded}
				aria-controls={`run-${run.id}-details`}
				className={cn(
					"w-full px-4 py-3 text-left transition-colors hover:bg-muted/40",
					isExpanded && "bg-muted/30",
				)}
			>
				<div className="flex w-full items-start gap-3">
					<div className="mt-0.5 text-muted-foreground">
						<ProviderIcon provider={provider} size="sm" />
					</div>

					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="truncate text-sm font-medium text-foreground">{title}</span>
							{hasSession && (
								<Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
									<Bot className="mr-1 h-2.5 w-2.5" />
									Session
								</Badge>
							)}
							{run.assignee && (
								<Avatar className="h-5 w-5">
									<AvatarImage src={run.assignee.image ?? undefined} />
									<AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
										{run.assignee.name?.[0]?.toUpperCase() ?? "?"}
									</AvatarFallback>
								</Avatar>
							)}
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
							<span className="truncate">{eventType}</span>
							<span>·</span>
							<span title={exactTime}>{timeAgo}</span>
						</div>
					</div>

					<div className="flex shrink-0 items-center gap-2 pl-2">
						<RunStatusPill status={run.status} />
						<ChevronRight
							className={cn(
								"h-4 w-4 text-muted-foreground/60 transition-transform",
								isExpanded && "rotate-90",
							)}
						/>
					</div>
				</div>
			</button>

			{isExpanded && (
				<div id={`run-${run.id}-details`}>
					<RunDetailSection run={run} />
				</div>
			)}
		</div>
	);
}

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
				<PageBackLink
					href={`/dashboard/automations/${automationId}`}
					label="Automation"
					className="mb-3"
				/>

				<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
					<div>
						<h1 className="text-lg font-semibold tracking-tight text-foreground">Runs</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							{automation?.name || "Automation"} · {total} {runLabel}
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
							Runs will appear here when this automation is triggered.
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
