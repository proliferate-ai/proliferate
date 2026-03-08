"use client";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { formatRelativeTime } from "@/lib/display/utils";
import {
	CheckCircle2,
	Clock,
	Eye,
	FileText,
	GitBranch,
	Loader2,
	MessageSquare,
	Send,
	Shield,
	StickyNote,
	Timer,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// ============================================
// Types
// ============================================

export interface ChatEvent {
	id: string;
	eventType: string;
	summaryText: string | null;
	payloadJson: unknown;
	sessionId: string | null;
	actionInvocationId: string | null;
	createdAt: string;
	/** Source of the run that owns this event (tick, webhook, manual, manual_message) */
	runSource: string | null;
	runId: string;
	runStatus: string;
}

export interface ChatDirective {
	id: string;
	messageType: string;
	payloadJson: unknown;
	queuedAt: string;
	senderUserId: string | null;
}

interface WorkerChatTabProps {
	events: ChatEvent[];
	pendingDirectives: ChatDirective[];
	isLoading: boolean;
	onSendDirective: (content: string) => Promise<void>;
	isSendingDirective?: boolean;
	workerStatus: string;
}

// ============================================
// Helpers
// ============================================

const EVENT_ICONS: Record<string, typeof FileText> = {
	wake_started: Timer,
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

function getEventStatusColor(eventType: string): string {
	if (eventType.includes("completed") || eventType.includes("wake_completed")) {
		return "text-success";
	}
	if (
		eventType.includes("failed") ||
		eventType.includes("denied") ||
		eventType.includes("expired")
	) {
		return "text-destructive";
	}
	return "text-muted-foreground";
}

// ============================================
// Component
// ============================================

export function WorkerChatTab({
	events,
	pendingDirectives,
	isLoading,
	onSendDirective,
	isSendingDirective,
	workerStatus,
}: WorkerChatTabProps) {
	const [directiveContent, setDirectiveContent] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when new events arrive
	// biome-ignore lint/correctness/useExhaustiveDependencies: events.length is an intentional trigger
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [events.length]);

	const handleSendDirective = async () => {
		const content = directiveContent.trim();
		if (!content) return;
		await onSendDirective(content);
		setDirectiveContent("");
	};

	return (
		<div className="flex flex-col gap-0 -mx-6 -mb-6" style={{ height: "calc(100vh - 240px)" }}>
			{/* Chat messages area */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
				{isLoading ? (
					<div className="space-y-4">
						{[1, 2, 3].map((i) => (
							<div key={i} className="h-16 animate-pulse bg-muted/30 rounded-lg" />
						))}
					</div>
				) : events.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full text-center">
						<MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-3" />
						<p className="text-sm text-muted-foreground">No activity yet</p>
						<p className="text-xs text-muted-foreground/60 mt-1">
							Send a message or wait for the next scheduled wake
						</p>
					</div>
				) : (
					<div className="space-y-1">
						{events.map((event, idx) => {
							const prevEvent = idx > 0 ? events[idx - 1] : null;
							const showRunDivider = prevEvent && prevEvent.runId !== event.runId;

							return (
								<div key={event.id}>
									{showRunDivider && (
										<div className="flex items-center gap-3 py-3">
											<div className="flex-1 border-t border-border/30" />
											<span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
												New run
											</span>
											<div className="flex-1 border-t border-border/30" />
										</div>
									)}
									<ChatMessage event={event} />
								</div>
							);
						})}

						{/* Pending directives shown as queued */}
						{pendingDirectives.map((d) => (
							<div key={d.id} className="flex items-start gap-3 py-2 px-3 rounded-lg">
								<div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
									<Clock className="h-3 w-3 text-primary" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="text-xs font-medium text-primary">Queued</span>
										<span className="text-[10px] text-muted-foreground">
											{formatRelativeTime(d.queuedAt)}
										</span>
									</div>
									<p className="text-sm text-foreground/80 mt-0.5">{directivePreview(d)}</p>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Composer */}
			<div className="shrink-0 border-t border-border bg-background px-6 py-3">
				<div className="rounded-lg border border-border overflow-hidden focus-within:border-foreground/30 transition-colors">
					<Textarea
						value={directiveContent}
						onChange={(e) => setDirectiveContent(e.target.value)}
						placeholder={
							workerStatus === "paused"
								? "Coworker is paused — resume to send messages"
								: "Send a message to this coworker..."
						}
						disabled={workerStatus === "paused"}
						className="w-full text-sm border-none resize-none px-4 py-3 bg-transparent rounded-none min-h-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
						style={{ minHeight: "52px", maxHeight: "120px" }}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								handleSendDirective();
							}
						}}
					/>
					<div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/30">
						<p className="text-xs text-muted-foreground">
							{isSendingDirective ? "Sending..." : "Press Cmd+Enter to send"}
						</p>
						<Button
							size="sm"
							className="h-7 gap-1.5"
							onClick={handleSendDirective}
							disabled={!directiveContent.trim() || isSendingDirective || workerStatus === "paused"}
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
			</div>
		</div>
	);
}

// ============================================
// Sub-components
// ============================================

function ChatMessage({ event }: { event: ChatEvent }) {
	const Icon = EVENT_ICONS[event.eventType] || FileText;
	const isUserDirective =
		event.eventType === "directive_received" && event.runSource === "manual_message";
	const isCronWake = event.eventType === "wake_started" && event.runSource === "tick";
	const isWebhookWake = event.eventType === "wake_started" && event.runSource === "webhook";

	// User directive messages
	if (isUserDirective) {
		const payload = event.payloadJson as Record<string, unknown> | null;
		const content = (payload?.content as string) || event.summaryText || "Directive sent";
		return (
			<div className="flex items-start gap-3 py-2 px-3 rounded-lg">
				<div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5">
					<span className="text-[10px] font-bold text-primary-foreground">U</span>
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium text-foreground">You</span>
						<span className="text-[10px] text-muted-foreground">
							{formatRelativeTime(event.createdAt)}
						</span>
					</div>
					<p className="text-sm text-foreground mt-0.5">{content}</p>
				</div>
			</div>
		);
	}

	// Cron/webhook wake — show as a system message
	if (isCronWake || isWebhookWake) {
		return (
			<div className="flex items-start gap-3 py-2 px-3 rounded-lg">
				<div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
					<Timer className="h-3 w-3 text-muted-foreground" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium text-muted-foreground">
							{isCronWake ? "Scheduled check" : "Webhook trigger"}
						</span>
						<span className="text-[10px] text-muted-foreground">
							{formatRelativeTime(event.createdAt)}
						</span>
					</div>
					{event.summaryText && (
						<p className="text-xs text-muted-foreground/70 mt-0.5">{event.summaryText}</p>
					)}
				</div>
			</div>
		);
	}

	// Agent event — show as agent message
	return (
		<div className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors">
			<div className="w-6 h-6 rounded-full bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
				<Icon className={`h-3 w-3 ${getEventStatusColor(event.eventType)}`} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-foreground">{eventLabel(event.eventType)}</span>
					<span className="text-[10px] text-muted-foreground">
						{formatRelativeTime(event.createdAt)}
					</span>
				</div>
				{event.summaryText && (
					<p className="text-sm text-foreground/80 mt-0.5">{event.summaryText}</p>
				)}
				{/* Link to spawned session */}
				{event.sessionId && event.eventType === "task_spawned" && (
					<Link
						href={`/workspace/${event.sessionId}`}
						className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-1.5 transition-colors"
					>
						<GitBranch className="h-3 w-3" />
						View task session
					</Link>
				)}
			</div>
			{/* Run status indicator for terminal events */}
			{(event.eventType === "wake_completed" || event.eventType === "wake_failed") && (
				<StatusDot
					status={event.eventType === "wake_completed" ? "stopped" : "error"}
					size="sm"
					className="mt-1.5"
				/>
			)}
		</div>
	);
}

function directivePreview(directive: ChatDirective): string {
	const payload = directive.payloadJson as Record<string, unknown> | null;
	const content = payload?.content as string | undefined;
	if (content) return content.length > 200 ? `${content.slice(0, 200)}...` : content;
	return directive.messageType;
}
