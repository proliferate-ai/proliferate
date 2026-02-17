"use client";

import { StatusDot } from "@/components/ui/status-dot";
import { usePrefetchSession } from "@/hooks/use-sessions";
import type { Session } from "@proliferate/shared/contracts";
import { formatDistanceToNow } from "date-fns";
import { GitBranch } from "lucide-react";
import Link from "next/link";

interface SessionListRowProps {
	session: Session;
}

function getRepoShortName(fullName: string): string {
	const parts = fullName.split("/");
	return parts[parts.length - 1];
}

function getStatusDotType(
	status: Session["status"],
): "running" | "active" | "paused" | "stopped" | "error" {
	switch (status) {
		case "running":
			return "running";
		case "starting":
			return "active";
		case "paused":
			return "paused";
		default:
			return "stopped";
	}
}

function getStatusLabel(status: Session["status"]): string {
	switch (status) {
		case "running":
			return "Running";
		case "paused":
			return "Paused";
		case "starting":
			return "Starting";
		case "suspended":
			return "Suspended";
		case "stopped":
			return "Stopped";
		default:
			return status ?? "Unknown";
	}
}

export function SessionListRow({ session }: SessionListRowProps) {
	const prefetchSession = usePrefetchSession();
	const activityDate = session.lastActivityAt || session.startedAt;
	const timeAgo = activityDate
		? formatDistanceToNow(new Date(activityDate), { addSuffix: true })
		: null;

	const repoShortName = session.repo?.githubRepoName
		? getRepoShortName(session.repo.githubRepoName)
		: null;

	const displayTitle =
		session.title ||
		`${repoShortName ?? "Untitled"}${session.branchName ? ` (${session.branchName})` : ""}`;

	const metaParts: string[] = [];
	if (repoShortName) metaParts.push(repoShortName);
	if (timeAgo) metaParts.push(timeAgo);

	return (
		<Link href={`/workspace/${session.id}`}>
			<div
				className="flex items-center px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm cursor-pointer last:border-0 gap-3"
				onMouseEnter={() => prefetchSession(session.id)}
			>
				<StatusDot status={getStatusDotType(session.status)} size="sm" className="flex-shrink-0" />

				<span className="font-medium text-foreground truncate min-w-0 flex-1">{displayTitle}</span>

				{session.branchName && (
					<div className="flex items-center gap-1 text-muted-foreground flex-shrink-0">
						<GitBranch className="h-3 w-3" />
						<span className="text-xs truncate max-w-[120px]">{session.branchName}</span>
					</div>
				)}

				<span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
					{metaParts.join(" · ")}
				</span>

				<span className="inline-flex items-center rounded-md border border-border/50 bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground flex-shrink-0">
					{getStatusLabel(session.status)}
				</span>
			</div>
		</Link>
	);
}
