"use client";

import { StatusDot } from "@/components/ui/status-dot";
import { formatRelativeTime } from "@/lib/utils";
import Link from "next/link";

export interface WorkerSession {
	id: string;
	title: string | null;
	status: string;
	repoId: string | null;
	branchName: string | null;
	operatorStatus: string | null;
	updatedAt: string;
	startedAt: string | null;
}

interface WorkerSessionsTabProps {
	sessions: WorkerSession[];
	isLoading: boolean;
}

function sessionStatusDot(status: string): "active" | "paused" | "stopped" | "error" {
	switch (status) {
		case "running":
		case "starting":
			return "active";
		case "paused":
			return "paused";
		case "completed":
			return "stopped";
		case "failed":
		case "cancelled":
			return "error";
		default:
			return "stopped";
	}
}

export function WorkerSessionsTab({ sessions, isLoading }: WorkerSessionsTabProps) {
	if (isLoading) {
		return (
			<div className="rounded-lg border border-border overflow-hidden">
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="h-12 border-b border-border/50 last:border-0 animate-pulse bg-muted/30"
					/>
				))}
			</div>
		);
	}

	if (sessions.length === 0) {
		return (
			<div className="text-center py-8 rounded-lg border border-border">
				<p className="text-sm text-muted-foreground">No task sessions yet</p>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
				<div className="flex-1 min-w-0">Title</div>
				<div className="hidden md:block w-20 shrink-0">Status</div>
				<div className="hidden md:block w-32 shrink-0">Branch</div>
				<div className="w-20 shrink-0 text-right">Updated</div>
			</div>

			{sessions.map((session) => (
				<Link
					key={session.id}
					href={`/workspace/${session.id}`}
					className="group flex items-center gap-4 px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm last:border-0"
				>
					{/* Title */}
					<div className="flex items-center gap-2.5 min-w-0 flex-1">
						<StatusDot status={sessionStatusDot(session.status)} size="sm" className="shrink-0" />
						<span className="text-foreground truncate group-hover:text-primary transition-colors">
							{session.title || "Untitled session"}
						</span>
					</div>

					{/* Status */}
					<div className="hidden md:block w-20 shrink-0">
						<span className="text-xs text-muted-foreground capitalize">{session.status}</span>
					</div>

					{/* Branch */}
					<div className="hidden md:block w-32 shrink-0">
						<span className="text-xs text-muted-foreground truncate">
							{session.branchName || "—"}
						</span>
					</div>

					{/* Updated */}
					<div className="w-20 shrink-0 text-right">
						<span className="text-xs text-muted-foreground">
							{formatRelativeTime(session.updatedAt)}
						</span>
					</div>
				</Link>
			))}
		</div>
	);
}
