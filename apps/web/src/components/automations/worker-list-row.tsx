"use client";

import { StatusDot } from "@/components/ui/status-dot";
import { formatRelativeTime } from "@/lib/utils";
import Link from "next/link";

type WorkerStatus = "active" | "paused" | "degraded" | "failed";

interface WorkerListRowProps {
	id: string;
	name: string;
	status: WorkerStatus;
	objective: string | null;
	lastWakeAt: string | null;
	activeTaskCount: number;
	pendingApprovalCount: number;
	updatedAt: string;
}

const statusDotMap: Record<WorkerStatus, "active" | "paused" | "error"> = {
	active: "active",
	paused: "paused",
	degraded: "error",
	failed: "error",
};

const statusLabels: Record<WorkerStatus, string> = {
	active: "Active",
	paused: "Paused",
	degraded: "Degraded",
	failed: "Failed",
};

export function WorkerListRow({
	id,
	name,
	status,
	lastWakeAt,
	activeTaskCount,
	pendingApprovalCount,
	updatedAt,
}: WorkerListRowProps) {
	return (
		<Link
			href={`/coworkers/${id}`}
			className="group flex items-center gap-4 px-4 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm last:border-0"
		>
			{/* Status + Name */}
			<div className="flex items-center gap-2.5 min-w-0 flex-1">
				<StatusDot status={statusDotMap[status]} size="sm" className="shrink-0" />
				<span className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
					{name}
				</span>
			</div>

			{/* Status badge */}
			<div className="hidden sm:block w-20 shrink-0">
				<span className="inline-flex items-center rounded-md border border-border/50 bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
					{statusLabels[status]}
				</span>
			</div>

			{/* Last wake */}
			<div className="hidden md:block w-24 shrink-0">
				<span className="text-xs text-muted-foreground">
					{lastWakeAt ? formatRelativeTime(lastWakeAt) : "Never"}
				</span>
			</div>

			{/* Active tasks */}
			<div className="hidden md:block w-16 shrink-0">
				<span className="text-xs text-muted-foreground">
					{activeTaskCount > 0 ? `${activeTaskCount} tasks` : "—"}
				</span>
			</div>

			{/* Pending approvals */}
			<div className="hidden lg:block w-20 shrink-0">
				<span
					className={
						pendingApprovalCount > 0
							? "text-xs font-medium text-foreground"
							: "text-xs text-muted-foreground"
					}
				>
					{pendingApprovalCount > 0 ? `${pendingApprovalCount} pending` : "—"}
				</span>
			</div>

			{/* Updated */}
			<div className="w-16 shrink-0 text-right">
				<span className="text-xs text-muted-foreground">{formatRelativeTime(updatedAt)}</span>
			</div>
		</Link>
	);
}
