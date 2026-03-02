"use client";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Eye,
	FileText,
	GitBranch,
	Loader2,
	MessageSquare,
	Play,
	Send,
	Shield,
	StickyNote,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

// ============================================
// Types
// ============================================

export interface WorkerRunEvent {
	id: string;
	eventIndex: number;
	eventType: string;
	summaryText: string | null;
	payloadJson: unknown;
	sessionId: string | null;
	actionInvocationId: string | null;
	createdAt: string;
}

export interface ChildSession {
	id: string;
	title: string | null;
	status: string;
}

export interface WorkerRunWithEvents {
	id: string;
	workerId: string;
	status: string;
	summary: string | null;
	wakeEventId: string;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	events: WorkerRunEvent[];
	childSessions?: ChildSession[];
}

export interface PendingDirective {
	id: string;
	messageType: string;
	payloadJson: unknown;
	queuedAt: string;
	senderUserId: string | null;
}

interface WorkerActivityTabProps {
	workerId: string;
	worker: {
		status: string;
		managerSessionId: string;
		lastWakeAt: string | null;
		lastErrorCode: string | null;
	};
	runs: WorkerRunWithEvents[];
	pendingDirectives: PendingDirective[];
	activeTaskCount: number;
	pendingApprovalCount: number;
	isLoadingRuns: boolean;
	onSendDirective: (content: string) => Promise<void>;
	onLoadMore?: () => void;
	hasMore?: boolean;
	isSendingDirective?: boolean;
}

// ============================================
// Helpers
// ============================================

const EVENT_ICONS: Record<string, typeof Play> = {
	wake_started: Play,
	triage_summary: FileText,
	source_observation: Eye,
	directive_received: MessageSquare,
	task_spawned: GitBranch,
	action_requested: Shield,
	action_pending_approval: Shield,
	action_completed: CheckCircle2,
	action_failed: XCircle,
	action_denied: XCircle,
	action_expired: XCircle,
	manager_note: StickyNote,
	wake_completed: CheckCircle2,
	wake_failed: XCircle,
};

function eventLabel(type: string): string {
	return type
		.split("_")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

function runSourceLabel(events: WorkerRunEvent[]): string {
	const wakeStarted = events.find((e) => e.eventType === "wake_started");
	if (!wakeStarted) return "Run";
	const payload = wakeStarted.payloadJson as Record<string, unknown> | null;
	const source = payload?.source as string | undefined;
	switch (source) {
		case "tick":
			return "Scheduled";
		case "webhook":
			return "Webhook";
		case "manual":
			return "Manual";
		case "manual_message":
			return "Directive";
		default:
			return "Run";
	}
}

function runStatusDot(status: string): "active" | "paused" | "running" | "stopped" | "error" {
	switch (status) {
		case "running":
		case "queued":
			return "active";
		case "completed":
			return "stopped";
		case "failed":
		case "cancelled":
		case "health_degraded":
			return "error";
		default:
			return "paused";
	}
}

function directivePreview(directive: PendingDirective): string {
	const payload = directive.payloadJson as Record<string, unknown> | null;
	const content = payload?.content as string | undefined;
	if (content) return content.length > 120 ? `${content.slice(0, 120)}...` : content;
	return directive.messageType;
}

// ============================================
// Component
// ============================================

export function WorkerActivityTab({
	runs,
	pendingDirectives,
	activeTaskCount,
	pendingApprovalCount,
	isLoadingRuns,
	onSendDirective,
	onLoadMore,
	hasMore,
	isSendingDirective,
	worker,
}: WorkerActivityTabProps) {
	const [directiveContent, setDirectiveContent] = useState("");
	const [expandedRuns, setExpandedRuns] = useState<Set<string>>(() => {
		if (runs.length > 0) return new Set([runs[0].id]);
		return new Set();
	});

	const toggleRun = (runId: string) => {
		setExpandedRuns((prev) => {
			const next = new Set(prev);
			if (next.has(runId)) next.delete(runId);
			else next.add(runId);
			return next;
		});
	};

	const handleSendDirective = async () => {
		const content = directiveContent.trim();
		if (!content) return;
		await onSendDirective(content);
		setDirectiveContent("");
	};

	const hasActiveRun = runs.some((r) => r.status === "running" || r.status === "queued");

	return (
		<div className="flex flex-col gap-6">
			{/* Summary strip */}
			<div className="flex items-center gap-6 flex-wrap">
				<div>
					<p className="text-xs text-muted-foreground">Status</p>
					<div className="flex items-center gap-1.5 mt-0.5">
						<StatusDot
							status={
								worker.status === "active"
									? "active"
									: worker.status === "paused"
										? "paused"
										: "error"
							}
							size="sm"
						/>
						<span className="text-sm font-medium capitalize">{worker.status}</span>
					</div>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Active tasks</p>
					<p className="text-sm font-medium mt-0.5 tabular-nums">{activeTaskCount}</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Pending approvals</p>
					<p
						className={cn(
							"text-sm mt-0.5 tabular-nums",
							pendingApprovalCount > 0 ? "font-medium text-foreground" : "text-muted-foreground",
						)}
					>
						{pendingApprovalCount}
					</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Last wake</p>
					<p className="text-sm text-muted-foreground mt-0.5">
						{worker.lastWakeAt ? formatRelativeTime(worker.lastWakeAt) : "Never"}
					</p>
				</div>
				{worker.lastErrorCode && (
					<div>
						<p className="text-xs text-muted-foreground">Last error</p>
						<p className="text-sm text-destructive mt-0.5">{worker.lastErrorCode}</p>
					</div>
				)}
			</div>

			{/* Directive composer */}
			<div className="rounded-lg border border-border overflow-hidden">
				<Textarea
					value={directiveContent}
					onChange={(e) => setDirectiveContent(e.target.value)}
					placeholder="Send a directive to this coworker..."
					className="w-full text-sm border-none resize-none px-4 py-3 bg-transparent rounded-none min-h-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
					style={{ minHeight: "72px" }}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							handleSendDirective();
						}
					}}
				/>
				<div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/30">
					{hasActiveRun ? (
						<p className="text-xs text-muted-foreground">
							Manager is busy — directive will be queued
						</p>
					) : (
						<p className="text-xs text-muted-foreground">Press Cmd+Enter to send</p>
					)}
					<Button
						size="sm"
						className="h-7 gap-1.5"
						onClick={handleSendDirective}
						disabled={!directiveContent.trim() || isSendingDirective}
					>
						{isSendingDirective ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<Send className="h-3 w-3" />
						)}
						Send
					</Button>
				</div>
			</div>

			{/* Pending directives */}
			{pendingDirectives.length > 0 && (
				<div>
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
						Pending directives
					</p>
					<div className="rounded-lg border border-border divide-y divide-border/50">
						{pendingDirectives.map((d) => (
							<div key={d.id} className="px-4 py-2.5 text-sm">
								<p className="text-foreground truncate">{directivePreview(d)}</p>
								<p className="text-xs text-muted-foreground mt-0.5">
									Queued {formatRelativeTime(d.queuedAt)}
								</p>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Worker run timeline */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Run history
				</p>

				{isLoadingRuns ? (
					<div className="rounded-lg border border-border">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-12 border-b border-border/50 last:border-0 animate-pulse bg-muted/30"
							/>
						))}
					</div>
				) : runs.length === 0 ? (
					<div className="text-center py-8 rounded-lg border border-border">
						<p className="text-sm text-muted-foreground">No activity yet</p>
					</div>
				) : (
					<div className="rounded-lg border border-border divide-y divide-border/50">
						{runs.map((run) => {
							const isExpanded = expandedRuns.has(run.id);
							return (
								<div key={run.id}>
									{/* Run header */}
									<button
										type="button"
										onClick={() => toggleRun(run.id)}
										className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
									>
										{isExpanded ? (
											<ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
										) : (
											<ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
										)}
										<StatusDot status={runStatusDot(run.status)} size="sm" className="shrink-0" />
										<span className="font-medium text-foreground">
											{runSourceLabel(run.events)}
										</span>
										<span className="inline-flex items-center rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
											{run.status}
										</span>
										{run.summary && (
											<span className="text-xs text-muted-foreground truncate flex-1 text-left">
												{run.summary}
											</span>
										)}
										<span className="text-xs text-muted-foreground shrink-0 ml-auto">
											{formatRelativeTime(run.createdAt)}
										</span>
									</button>

									{/* Expanded: events */}
									{isExpanded && (
										<div className="px-4 pb-3">
											<div className="ml-6 border-l border-border/50 pl-4 space-y-1.5">
												{run.events.map((event) => {
													const Icon = EVENT_ICONS[event.eventType] || FileText;
													return (
														<div key={event.id} className="flex items-start gap-2 py-1">
															<Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
															<div className="min-w-0 flex-1">
																<div className="flex items-center gap-2">
																	<span className="text-xs font-medium text-foreground">
																		{eventLabel(event.eventType)}
																	</span>
																	<span className="text-xs text-muted-foreground">
																		{formatRelativeTime(event.createdAt)}
																	</span>
																</div>
																{event.summaryText && (
																	<p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
																		{event.summaryText}
																	</p>
																)}
																{/* Inline child session reference */}
																{event.sessionId && event.eventType === "task_spawned" && (
																	<Link
																		href={`/workspace/${event.sessionId}`}
																		className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 transition-colors"
																	>
																		<GitBranch className="h-3 w-3" />
																		View task session
																	</Link>
																)}
															</div>
														</div>
													);
												})}
											</div>

											{/* Child sessions for this run */}
											{run.childSessions && run.childSessions.length > 0 && (
												<div className="ml-6 mt-2 pl-4">
													<p className="text-xs text-muted-foreground mb-1">Tasks spawned</p>
													<div className="space-y-1">
														{run.childSessions.map((session) => (
															<Link
																key={session.id}
																href={`/workspace/${session.id}`}
																className="flex items-center gap-2 text-xs hover:text-foreground text-muted-foreground transition-colors"
															>
																<StatusDot
																	status={
																		session.status === "running"
																			? "active"
																			: session.status === "failed"
																				? "error"
																				: "stopped"
																	}
																	size="sm"
																/>
																<span className="truncate">{session.title || "Untitled task"}</span>
															</Link>
														))}
													</div>
												</div>
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}

				{hasMore && (
					<div className="mt-3 text-center">
						<Button variant="ghost" size="sm" onClick={onLoadMore} className="text-xs">
							Load more
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
