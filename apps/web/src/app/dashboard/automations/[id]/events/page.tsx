"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterButtonGroup } from "@/components/ui/filter-button-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
			return { icon: Clock, label: "Queued", className: "text-zinc-400" };
		case "failed":
			return { icon: XCircle, label: "Failed", className: "text-red-500" };
		case "needs_human":
			return { icon: Hand, label: "Needs Human", className: "text-amber-500" };
		case "timed_out":
			return { icon: Timer, label: "Timed Out", className: "text-orange-500" };
		case "canceled":
			return { icon: XCircle, label: "Canceled", className: "text-zinc-400" };
		case "skipped":
			return { icon: AlertCircle, label: "Skipped", className: "text-zinc-400" };
		case "filtered":
			return { icon: Filter, label: "Filtered", className: "text-yellow-500" };
		default:
			return { icon: Clock, label: status, className: "text-zinc-400" };
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
// Run Detail Dialog
// ============================================

function RunDetailDialog({
	run,
	open,
	onOpenChange,
}: {
	run: AutomationRun | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	if (!run) return null;

	const parsedContext = run.trigger_event?.parsed_context as ParsedEventContext | null;
	const statusInfo = getRunStatusInfo(run.status);
	const StatusIcon = statusInfo.icon;

	const analysis = (parsedContext as Record<string, unknown> | null)?.llm_analysis_result as {
		severity: string;
		summary: string;
		rootCause?: string;
		recommendedActions: string[];
	} | null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<StatusIcon className={cn("h-4 w-4", statusInfo.className)} />
						<span className="truncate">{parsedContext?.title || "Run"}</span>
					</DialogTitle>
				</DialogHeader>

				<Tabs defaultValue="overview" className="mt-4">
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="overview">Overview</TabsTrigger>
						<TabsTrigger value="analysis" disabled={!analysis}>
							Analysis
						</TabsTrigger>
					</TabsList>

					<TabsContent value="overview" className="mt-4 space-y-4">
						<div>
							<Text variant="small" color="muted" className="mb-1">
								Status
							</Text>
							<Badge
								variant={run.status === "succeeded" ? "default" : "secondary"}
								className="capitalize"
							>
								{statusInfo.label}
							</Badge>
						</div>

						{run.error_message && (
							<div>
								<Text variant="small" color="muted" className="mb-1">
									Error
								</Text>
								<Text variant="small" color="destructive">
									{run.error_message}
								</Text>
							</div>
						)}

						{run.status_reason && (
							<div>
								<Text variant="small" color="muted" className="mb-1">
									Reason
								</Text>
								<Text variant="small">{run.status_reason}</Text>
							</div>
						)}

						{run.assignee && (
							<div>
								<Text variant="small" color="muted" className="mb-1">
									Assignee
								</Text>
								<div className="flex items-center gap-2">
									<Avatar className="h-5 w-5">
										<AvatarImage src={run.assignee.image ?? undefined} />
										<AvatarFallback className="text-[10px]">
											{run.assignee.name?.[0]?.toUpperCase() ?? "?"}
										</AvatarFallback>
									</Avatar>
									<Text variant="small">{run.assignee.name}</Text>
								</div>
							</div>
						)}

						{parsedContext && (
							<div>
								<Text variant="small" color="muted" className="mb-1">
									Event Context
								</Text>
								<pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-64">
									{JSON.stringify(parsedContext, null, 2)}
								</pre>
							</div>
						)}
					</TabsContent>

					<TabsContent value="analysis" className="mt-4 space-y-4">
						{analysis ? (
							<>
								<div className="flex items-center gap-4">
									<div>
										<Text variant="small" color="muted" className="mb-1">
											Severity
										</Text>
										<div className="flex items-center gap-2">
											<div
												className={cn("w-3 h-3 rounded-full", getSeverityColor(analysis.severity))}
											/>
											<Text variant="body" className="capitalize font-medium">
												{analysis.severity}
											</Text>
										</div>
									</div>
								</div>

								<div>
									<Text variant="small" color="muted" className="mb-1">
										Summary
									</Text>
									<Text variant="body">{analysis.summary}</Text>
								</div>

								{analysis.rootCause && (
									<div>
										<Text variant="small" color="muted" className="mb-1">
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
										<div className="flex flex-wrap gap-2">
											{analysis.recommendedActions.map((action) => (
												<Badge key={action} variant="outline">
													{action}
												</Badge>
											))}
										</div>
									</div>
								)}
							</>
						) : (
							<Text variant="small" color="muted">
								No analysis available
							</Text>
						)}
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}

// ============================================
// Run Row
// ============================================

function RunRow({
	run,
	onClick,
}: {
	run: AutomationRun;
	onClick: () => void;
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
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"w-full grid grid-cols-[minmax(0,1fr)_120px_100px_36px_120px_24px] items-center gap-3",
				"px-4 py-3 border-b border-slate-950/[0.075] last:border-b-0",
				"hover:bg-slate-950/[0.043] transition-colors cursor-pointer text-left",
			)}
		>
			{/* Summary */}
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-zinc-900 truncate">{title}</span>
					{hasSession && (
						<span className="inline-flex items-center gap-0.5 rounded-full border border-slate-950/[0.1] px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
							<Bot className="w-2.5 h-2.5" />
							Session
						</span>
					)}
				</div>
				<span className="text-xs text-gray-950/[0.53] truncate block">{eventType}</span>
			</div>

			{/* Run Status */}
			<div className="flex items-center gap-1.5">
				<StatusIcon className={cn("w-3.5 h-3.5", statusInfo.className)} />
				<span className="text-sm text-zinc-600">{statusInfo.label}</span>
			</div>

			{/* Assignee */}
			<div className="flex items-center justify-center">
				{run.assignee ? (
					<Avatar className="h-6 w-6">
						<AvatarImage src={run.assignee.image ?? undefined} />
						<AvatarFallback className="text-[10px] bg-zinc-100 text-zinc-600">
							{run.assignee.name?.[0]?.toUpperCase() ?? "?"}
						</AvatarFallback>
					</Avatar>
				) : (
					<span className="text-xs text-gray-950/[0.3]">--</span>
				)}
			</div>

			{/* Spacer */}
			<span />

			{/* Time */}
			<span className="text-sm text-gray-950/[0.53]" title={exactTime}>
				{timeAgo}
			</span>

			{/* Chevron */}
			<ChevronRight className="w-4 h-4 text-zinc-300" />
		</button>
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
	const [selectedRun, setSelectedRun] = useState<AutomationRun | null>(null);

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

	return (
		<div className="flex-1 flex justify-center">
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
							<h1 className="text-lg font-semibold text-zinc-900">Runs</h1>
							<p className="text-sm text-gray-950/[0.53]">
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
					<div className="rounded-2xl border-2 border-slate-950/[0.1] bg-white overflow-hidden">
						<div className="space-y-0">
							{[1, 2, 3].map((i) => (
								<div
									key={i}
									className="h-16 border-b border-slate-950/[0.075] last:border-b-0 animate-pulse bg-zinc-50"
								/>
							))}
						</div>
					</div>
				) : error ? (
					<div className="text-center py-12 rounded-2xl border-2 border-slate-950/[0.1] bg-zinc-50">
						<Text variant="body" color="destructive">
							Failed to load runs
						</Text>
					</div>
				) : runsList.length === 0 ? (
					<div className="text-center py-12 rounded-2xl border-2 border-slate-950/[0.1] bg-zinc-50">
						<div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center mx-auto mb-3">
							<Inbox className="w-5 h-5 text-zinc-400" />
						</div>
						<Text variant="body" className="font-medium text-zinc-700 mb-1">
							No runs yet
						</Text>
						<Text variant="small" color="muted">
							Runs will appear here when your triggers fire
						</Text>
					</div>
				) : (
					<div className="rounded-2xl border-2 border-slate-950/[0.1] bg-white overflow-hidden">
						{/* Table Header */}
						<div
							className={cn(
								"grid grid-cols-[minmax(0,1fr)_120px_100px_36px_120px_24px] items-center gap-3",
								"px-4 py-2 bg-zinc-50 border-b-2 border-slate-950/[0.075]",
								"sticky top-0 z-10",
							)}
						>
							<span className="text-sm font-medium text-gray-950/[0.53]">Summary</span>
							<span className="text-sm font-medium text-gray-950/[0.53]">Status</span>
							<span className="text-sm font-medium text-gray-950/[0.53] text-center">Assignee</span>
							<span />
							<span className="text-sm font-medium text-gray-950/[0.53]">Time</span>
							<span />
						</div>

						{/* Table Body */}
						<div>
							{runsList.map((run) => (
								<RunRow key={run.id} run={run} onClick={() => setSelectedRun(run)} />
							))}
						</div>
					</div>
				)}

				{/* Run Detail Dialog */}
				<RunDetailDialog
					run={selectedRun}
					open={!!selectedRun}
					onOpenChange={(open) => !open && setSelectedRun(null)}
				/>
			</div>
		</div>
	);
}
