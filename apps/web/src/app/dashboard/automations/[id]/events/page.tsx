"use client";

import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
} from "@/components/integrations/provider-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterButtonGroup } from "@/components/ui/filter-button-group";
import { Text } from "@/components/ui/text";
import { useAutomation, useAutomationRuns } from "@/hooks/use-automations";
import { cn } from "@/lib/utils";
import type { AutomationRun, AutomationRunStatus, ParsedEventContext } from "@proliferate/shared";
import { formatDistanceToNow } from "date-fns";
import {
	AlertCircle,
	ArrowLeft,
	Bot,
	CheckCircle2,
	ChevronRight,
	Clock,
	Filter,
	Hand,
	Inbox,
	Loader2,
	RefreshCw,
	Timer,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";

// ============================================
// Helpers
// ============================================

const STATUS_FILTERS = [
	{ value: "all" as const, label: "All" },
	{ value: "succeeded" as const, label: "Succeeded" },
	{ value: "running" as const, label: "Running" },
	{ value: "queued" as const, label: "Queued" },
	{ value: "failed" as const, label: "Failed" },
	{ value: "needs_human" as const, label: "Needs Human" },
	{ value: "timed_out" as const, label: "Timed Out" },
	{ value: "skipped" as const, label: "Skipped" },
	{ value: "filtered" as const, label: "Filtered" },
];

function getRunStatusInfo(status: string): {
	icon: React.ElementType;
	label: string;
	className: string;
} {
	switch (status) {
		case "succeeded":
			return { icon: CheckCircle2, label: "Succeeded", className: "text-emerald-600" };
		case "running":
			return { icon: Loader2, label: "Running", className: "text-blue-500 animate-spin" };
		case "enriching":
			return { icon: Loader2, label: "Enriching", className: "text-blue-400 animate-spin" };
		case "ready":
			return { icon: Clock, label: "Ready", className: "text-blue-400" };
		case "queued":
			return { icon: Clock, label: "Queued", className: "text-muted-foreground" };
		case "failed":
			return { icon: XCircle, label: "Failed", className: "text-red-500" };
		case "needs_human":
			return { icon: Hand, label: "Needs Human", className: "text-amber-500" };
		case "timed_out":
			return { icon: Timer, label: "Timed Out", className: "text-orange-500" };
		case "canceled":
			return { icon: XCircle, label: "Canceled", className: "text-muted-foreground" };
		case "skipped":
			return { icon: AlertCircle, label: "Skipped", className: "text-muted-foreground" };
		case "filtered":
			return { icon: Filter, label: "Filtered", className: "text-yellow-500" };
		default:
			return { icon: Clock, label: status, className: "text-muted-foreground" };
	}
}

function getEventTypeLabel(eventType: string | null | undefined, provider: string): string {
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
	switch (provider) {
		case "linear":
			return "Linear";
		case "sentry":
			return "Sentry";
		case "github":
			return "GitHub";
		case "posthog":
			return "PostHog";
		case "custom":
		case "webhook":
			return "Webhook";
		default:
			return provider;
	}
}

function getSeverityColor(severity: string) {
	switch (severity) {
		case "critical":
			return "bg-red-500";
		case "high":
			return "bg-orange-500";
		case "medium":
			return "bg-yellow-500";
		case "low":
			return "bg-green-500";
		default:
			return "bg-muted";
	}
}

// ============================================
// Inline Detail Section
// ============================================

function RunDetailSection({ run }: { run: AutomationRun }) {
	const parsedContext = run.trigger_event?.parsed_context as ParsedEventContext | null;
	const provider = (run.trigger?.provider || "webhook") as Provider;
	const eventType = getEventTypeLabel(run.trigger_event?.provider_event_type, provider);

	const analysis = (parsedContext as Record<string, unknown> | null)?.llm_analysis_result as {
		severity: string;
		summary: string;
		rootCause?: string;
		recommendedActions: string[];
	} | null;

	// Build a context summary from provider-specific data
	const contextParts: string[] = [];
	if (parsedContext?.title) {
		contextParts.push(parsedContext.title);
	}
	const ctx = parsedContext as Record<string, unknown> | null;
	if (ctx?.posthog) {
		const ph = ctx.posthog as Record<string, unknown>;
		if (ph.current_url) contextParts.push(`URL: ${ph.current_url}`);
		if (ph.person) {
			const person = ph.person as Record<string, unknown>;
			contextParts.push(`User: ${person.name || person.email || "Anonymous"}`);
		}
	}
	if (ctx?.sentry) {
		const s = ctx.sentry as Record<string, unknown>;
		if (s.issue_title) contextParts.push(`Issue: ${s.issue_title}`);
		if (s.project) contextParts.push(`Project: ${s.project}`);
	}
	if (ctx?.github) {
		const gh = ctx.github as Record<string, unknown>;
		if (gh.repo) contextParts.push(`Repo: ${gh.repo}`);
		if (gh.title) contextParts.push(`Title: ${gh.title}`);
	}

	return (
		<div className="bg-muted border-b border-border px-6 py-4 space-y-4">
			{/* Trigger Source */}
			<div>
				<Text variant="small" color="muted" className="mb-1.5 font-medium uppercase tracking-wide">
					Trigger Source
				</Text>
				<div className="flex items-center gap-2 mb-1">
					<ProviderIcon provider={provider} size="sm" />
					<Text variant="body" className="font-medium">
						{getProviderDisplayName(provider)}
					</Text>
					<Badge variant="outline" className="text-xs">
						{eventType}
					</Badge>
				</div>
				{contextParts.length > 0 && (
					<div className="text-sm text-muted-foreground mt-1 space-y-0.5">
						{contextParts.map((part) => (
							<div key={part}>{part}</div>
						))}
					</div>
				)}
			</div>

			{/* Analysis */}
			{analysis && (
				<div>
					<Text
						variant="small"
						color="muted"
						className="mb-1.5 font-medium uppercase tracking-wide"
					>
						Analysis
					</Text>
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<div
								className={cn("w-2.5 h-2.5 rounded-full", getSeverityColor(analysis.severity))}
							/>
							<Text variant="body" className="capitalize font-medium">
								{analysis.severity}
							</Text>
						</div>
						{analysis.summary && (
							<Text variant="body" className="text-foreground">
								{analysis.summary}
							</Text>
						)}
						{analysis.rootCause && (
							<div>
								<Text variant="small" color="muted" className="mb-0.5">
									Root Cause
								</Text>
								<Text variant="body">{analysis.rootCause}</Text>
							</div>
						)}
						{analysis.recommendedActions?.length > 0 && (
							<div>
								<Text variant="small" color="muted" className="mb-1">
									Recommended Actions
								</Text>
								<div className="flex flex-wrap gap-1.5">
									{analysis.recommendedActions.map((action) => (
										<Badge key={action} variant="outline">
											{action}
										</Badge>
									))}
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Agent Session Link */}
			{run.session_id && (
				<div>
					<Text
						variant="small"
						color="muted"
						className="mb-1.5 font-medium uppercase tracking-wide"
					>
						Agent Session
					</Text>
					<Link href={`/dashboard/sessions/${run.session_id}`}>
						<Button variant="outline" size="sm" className="gap-1.5">
							<Bot className="w-3.5 h-3.5" />
							View agent session
						</Button>
					</Link>
				</div>
			)}

			{/* Status Info */}
			{(run.status_reason || run.error_message) && (
				<div>
					<Text
						variant="small"
						color="muted"
						className="mb-1.5 font-medium uppercase tracking-wide"
					>
						Status Info
					</Text>
					{run.status_reason && (
						<div className="mb-1">
							<Text variant="small" color="muted" className="mb-0.5">
								Reason
							</Text>
							<Text variant="body">{run.status_reason}</Text>
						</div>
					)}
					{run.error_message && (
						<div>
							<Text variant="small" color="muted" className="mb-0.5">
								Error
							</Text>
							<Text variant="small" color="destructive">
								{run.error_message}
							</Text>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ============================================
// Run Row
// ============================================

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
	const provider = run.trigger?.provider || "unknown";
	const statusInfo = getRunStatusInfo(run.status);
	const StatusIcon = statusInfo.icon;

	const title = parsedContext?.title || "Run";
	const eventType = getEventTypeLabel(run.trigger_event?.provider_event_type, provider);

	const queuedAt = run.queued_at ? new Date(run.queued_at) : null;
	const timeAgo = queuedAt ? formatDistanceToNow(queuedAt, { addSuffix: true }) : "Unknown";
	const exactTime = queuedAt ? queuedAt.toLocaleString() : "";

	const hasSession = !!run.session_id;

	return (
		<>
			<button
				type="button"
				onClick={onToggle}
				className={cn(
					"w-full grid grid-cols-[minmax(0,1fr)_120px_100px_36px_120px_24px] items-center gap-3",
					"px-4 py-3 border-b border-border last:border-b-0",
					"hover:bg-accent transition-colors cursor-pointer text-left",
					isExpanded && "bg-accent",
				)}
			>
				{/* Summary */}
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium text-foreground truncate">{title}</span>
						{hasSession && (
							<span className="inline-flex items-center gap-0.5 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
								<Bot className="w-2.5 h-2.5" />
								Session
							</span>
						)}
					</div>
					<span className="text-xs text-muted-foreground truncate block">{eventType}</span>
				</div>

				{/* Run Status */}
				<div className="flex items-center gap-1.5">
					<StatusIcon className={cn("w-3.5 h-3.5", statusInfo.className)} />
					<span className="text-sm text-muted-foreground">{statusInfo.label}</span>
				</div>

				{/* Assignee */}
				<div className="flex items-center justify-center">
					{run.assignee ? (
						<Avatar className="h-6 w-6">
							<AvatarImage src={run.assignee.image ?? undefined} />
							<AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
								{run.assignee.name?.[0]?.toUpperCase() ?? "?"}
							</AvatarFallback>
						</Avatar>
					) : (
						<span className="text-xs text-muted-foreground/50">--</span>
					)}
				</div>

				{/* Spacer */}
				<span />

				{/* Time */}
				<span className="text-sm text-muted-foreground" title={exactTime}>
					{timeAgo}
				</span>

				{/* Chevron */}
				<ChevronRight
					className={cn(
						"w-4 h-4 text-muted-foreground/50 transition-transform duration-200",
						isExpanded && "rotate-90",
					)}
				/>
			</button>

			{/* Expanded Detail Section */}
			{isExpanded && <RunDetailSection run={run} />}
		</>
	);
}

// ============================================
// Page Component
// ============================================

export default function AutomationRunsPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id: automationId } = use(params);
	const [statusFilter, setStatusFilter] = useState<string[]>(["all"]);
	const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

	const filterValue = statusFilter.includes("all")
		? undefined
		: (statusFilter[0] as AutomationRunStatus);

	const { data: automation } = useAutomation(automationId);

	const {
		data: runsData,
		isLoading,
		error,
		refetch,
		isFetching,
	} = useAutomationRuns(automationId, {
		status: filterValue,
	});

	const runsList = runsData?.runs ?? [];
	const total = runsData?.total ?? 0;

	function handleToggleRun(runId: string) {
		setExpandedRunId((prev) => (prev === runId ? null : runId));
	}

	return (
		<div className="flex-1 overflow-y-auto flex max-h-screen justify-center">
			<div className="w-full max-w-4xl p-6 py-8">
				{/* Header */}
				<header className="flex items-center justify-between mb-6">
					<div className="flex items-center gap-3">
						<Link href={`/dashboard/automations/${automationId}`}>
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<ArrowLeft className="h-4 w-4" />
							</Button>
						</Link>
						<div>
							<h1 className="text-lg font-semibold text-foreground">Runs</h1>
							<p className="text-sm text-muted-foreground">
								{automation?.name || "Automation"} · {total} {total === 1 ? "run" : "runs"}
							</p>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetch()}
						disabled={isFetching}
						className="h-8"
					>
						<RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
						Refresh
					</Button>
				</header>

				{/* Filters */}
				<div className="mb-6">
					<FilterButtonGroup
						items={STATUS_FILTERS}
						selected={statusFilter}
						onChange={setStatusFilter}
						size="sm"
					/>
				</div>

				{/* Table */}
				{isLoading ? (
					<div className="rounded-2xl border-2 border-border bg-card overflow-hidden">
						<div className="space-y-0">
							{[1, 2, 3].map((i) => (
								<div
									key={i}
									className="h-16 border-b border-border last:border-b-0 animate-pulse bg-muted"
								/>
							))}
						</div>
					</div>
				) : error ? (
					<div className="text-center py-12 rounded-2xl border-2 border-border bg-muted">
						<Text variant="body" color="destructive">
							Failed to load runs
						</Text>
					</div>
				) : runsList.length === 0 ? (
					<div className="text-center py-12 rounded-2xl border-2 border-border bg-muted">
						<div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
							<Inbox className="w-5 h-5 text-muted-foreground" />
						</div>
						<Text variant="body" className="font-medium text-foreground mb-1">
							No runs yet
						</Text>
						<Text variant="small" color="muted">
							Runs will appear here when your triggers fire
						</Text>
					</div>
				) : (
					<div className="rounded-2xl border-2 border-border bg-card overflow-hidden">
						{/* Table Header */}
						<div
							className={cn(
								"grid grid-cols-[minmax(0,1fr)_120px_100px_36px_120px_24px] items-center gap-3",
								"px-4 py-2 bg-muted border-b-2 border-border",
								"sticky top-0 z-10",
							)}
						>
							<span className="text-sm font-medium text-muted-foreground">Summary</span>
							<span className="text-sm font-medium text-muted-foreground">Status</span>
							<span className="text-sm font-medium text-muted-foreground text-center">
								Assignee
							</span>
							<span />
							<span className="text-sm font-medium text-muted-foreground">Time</span>
							<span />
						</div>

						{/* Table Body */}
						<div>
							{runsList.map((run) => (
								<RunRow
									key={run.id}
									run={run}
									isExpanded={expandedRunId === run.id}
									onToggle={() => handleToggleRun(run.id)}
								/>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
