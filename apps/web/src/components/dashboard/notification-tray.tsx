"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOrgActions } from "@/hooks/actions/use-actions";
import { useOrgPendingRuns } from "@/hooks/automations/use-automations";
import type { PendingRunSummary } from "@proliferate/shared";
import { formatDistanceToNow } from "date-fns";
import { Bell, ExternalLink, Hand, Shield, Timer, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

// ============================================
// Types
// ============================================

interface NotificationItem {
	id: string;
	category: "approval" | "failed" | "needs_human" | "timed_out";
	title: string;
	detail?: string;
	href: string;
	timestamp: number;
}

// ============================================
// Helpers
// ============================================

function getCategoryIcon(category: NotificationItem["category"]) {
	switch (category) {
		case "approval":
			return Shield;
		case "failed":
			return XCircle;
		case "needs_human":
			return Hand;
		case "timed_out":
			return Timer;
	}
}

function getCategoryLabel(category: NotificationItem["category"]) {
	switch (category) {
		case "approval":
			return "Approval required";
		case "failed":
			return "Failed";
		case "needs_human":
			return "Needs input";
		case "timed_out":
			return "Timed out";
	}
}

function runToItem(run: PendingRunSummary): NotificationItem {
	const category =
		run.status === "failed" ? "failed" : run.status === "timed_out" ? "timed_out" : "needs_human";

	return {
		id: `run-${run.id}`,
		category,
		title: run.automation_name,
		detail: run.error_message?.slice(0, 80) || run.status_reason?.slice(0, 80),
		href: run.session_id
			? `/workspace/${run.session_id}`
			: `/coworkers/${run.automation_id}/events?runId=${run.id}`,
		timestamp: run.completed_at
			? new Date(run.completed_at).getTime()
			: new Date(run.queued_at).getTime(),
	};
}

// ============================================
// Component
// ============================================

export function NotificationTray() {
	const { data: orgActions } = useOrgActions({ status: "pending", limit: 20 });
	const { data: pendingRuns } = useOrgPendingRuns({ limit: 20 });

	const items = useMemo(() => {
		const result: NotificationItem[] = [];

		// Pending action approvals
		if (orgActions?.invocations) {
			for (const inv of orgActions.invocations) {
				result.push({
					id: `approval-${inv.id}`,
					category: "approval",
					title: `${inv.integration}/${inv.action}`,
					detail: inv.sessionTitle || undefined,
					href: inv.sessionId ? `/workspace/${inv.sessionId}` : "/sessions",
					timestamp: inv.createdAt ? new Date(inv.createdAt).getTime() : Date.now(),
				});
			}
		}

		// Pending runs (failed, needs_human, timed_out)
		if (pendingRuns) {
			for (const run of pendingRuns) {
				result.push(runToItem(run));
			}
		}

		result.sort((a, b) => b.timestamp - a.timestamp);
		return result;
	}, [orgActions, pendingRuns]);

	const totalCount = items.length;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="relative h-8 w-8 rounded-lg text-muted-foreground"
				>
					<Bell className="h-3.5 w-3.5" />
					{totalCount > 0 && (
						<span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
					)}
					<span className="sr-only">Notifications</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
					<span className="text-sm font-medium text-foreground">Notifications</span>
					{totalCount > 0 && <span className="text-xs text-muted-foreground">{totalCount}</span>}
				</div>
				{totalCount === 0 ? (
					<div className="flex flex-col items-center justify-center py-10 px-4">
						<Bell className="h-5 w-5 text-muted-foreground/50 mb-2" />
						<p className="text-sm text-muted-foreground">No notifications</p>
					</div>
				) : (
					<div className="max-h-80 overflow-y-auto">
						{items.slice(0, 20).map((item) => (
							<NotificationRow key={item.id} item={item} />
						))}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

// ============================================
// Row
// ============================================

function NotificationRow({ item }: { item: NotificationItem }) {
	const Icon = getCategoryIcon(item.category);
	const label = getCategoryLabel(item.category);
	const timeAgo = formatDistanceToNow(new Date(item.timestamp), { addSuffix: true });

	return (
		<Link
			href={item.href}
			className="group flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
		>
			<Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
			<div className="flex-1 min-w-0">
				<span className="text-sm font-medium text-foreground truncate block group-hover:text-primary transition-colors">
					{item.title}
				</span>
				<span className="text-xs text-muted-foreground">
					{label} {item.detail ? `\u00B7 ${item.detail}` : ""} {`\u00B7 ${timeAgo}`}
				</span>
			</div>
			<ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
		</Link>
	);
}
