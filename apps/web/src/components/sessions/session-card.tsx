"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Session } from "@proliferate/shared/contracts";
import { formatDistanceToNow } from "date-fns";
import { GitBranch, MessageSquare } from "lucide-react";
import Link from "next/link";

interface SessionCardProps {
	session: Session;
}

function getRepoShortName(fullName: string): string {
	const parts = fullName.split("/");
	return parts[parts.length - 1];
}

function getStatusColor(status: Session["status"]): string {
	switch (status) {
		case "running":
			return "bg-green-500/10 text-green-600 border-green-500/20";
		case "paused":
			return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
		case "starting":
			return "bg-blue-500/10 text-blue-600 border-blue-500/20";
		case "suspended":
		case "stopped":
			return "bg-muted text-muted-foreground";
		default:
			return "bg-muted text-muted-foreground";
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

export function SessionCard({ session }: SessionCardProps) {
	const activityDate = session.lastActivityAt || session.startedAt;
	const timeAgo = activityDate
		? formatDistanceToNow(new Date(activityDate), { addSuffix: true })
		: "unknown";

	const repoShortName = session.repo?.githubRepoName
		? getRepoShortName(session.repo.githubRepoName)
		: "unknown";

	const displayTitle =
		session.title || `${repoShortName}${session.branchName ? ` (${session.branchName})` : ""}`;

	return (
		<Link href={`/dashboard/sessions/${session.id}`}>
			<div
				className={cn(
					"group p-4 rounded-lg border border-border bg-card",
					"hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer",
				)}
			>
				{/* Header: Title + Timestamp */}
				<div className="flex items-start justify-between gap-4 mb-3">
					<div className="flex items-center gap-2 min-w-0">
						<MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
						<h3
							className={cn(
								"font-medium text-foreground group-hover:text-primary transition-colors truncate",
								!session.title && "italic",
							)}
						>
							{displayTitle}
						</h3>
					</div>
					<span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
						{timeAgo}
					</span>
				</div>

				{/* Footer: Repo + Branch + Status */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3 text-sm text-muted-foreground">
						{/* Repo name */}
						<span className="truncate">{repoShortName}</span>

						{/* Branch */}
						{session.branchName && (
							<div className="flex items-center gap-1">
								<GitBranch className="h-3.5 w-3.5" />
								<span className="truncate max-w-[150px]">{session.branchName}</span>
							</div>
						)}
					</div>

					{/* Status badge */}
					<Badge variant="secondary" className={cn("text-xs", getStatusColor(session.status))}>
						{getStatusLabel(session.status)}
					</Badge>
				</div>
			</div>
		</Link>
	);
}
