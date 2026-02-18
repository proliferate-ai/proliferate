"use client";

import { BlocksIcon, BlocksLoadingIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { formatRelativeTime, getRepoShortName } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
	running: "text-emerald-500",
	starting: "text-muted-foreground",
	paused: "text-amber-500",
	suspended: "text-orange-500",
	stopped: "text-muted-foreground/50",
};

interface SessionRowProps {
	title: string | null;
	repoName: string | null;
	branchName: string | null;
	status: string | null;
	lastActivityAt: string | null;
	startedAt: string | null;
	className?: string;
}

/**
 * Display-only session row component.
 * Used in sidebar and command search for consistent display.
 */
export function SessionRow({
	title,
	repoName,
	branchName,
	status,
	lastActivityAt,
	startedAt,
	className,
}: SessionRowProps) {
	const repoShortName = repoName ? getRepoShortName(repoName) : "unknown";
	const activityDate = lastActivityAt || startedAt;
	const relativeTime = activityDate ? formatRelativeTime(activityDate) : "unknown";
	const displayTitle = title || `${repoShortName}${branchName ? ` (${branchName})` : ""}`;

	return (
		<div className={cn("flex items-start min-w-0", className)}>
			<div className="flex-1 min-w-0">
				<p className={cn("text-sm truncate", title ? "font-medium" : "font-normal italic")}>
					{displayTitle}
				</p>
				<p className="text-xs text-muted-foreground truncate">
					{relativeTime} · {repoShortName}
					{branchName && ` · ${branchName}`}
				</p>
			</div>
			{status &&
				(() => {
					const isAnimated = status === "running" || status === "starting";
					const Icon = isAnimated ? BlocksLoadingIcon : BlocksIcon;
					const color = STATUS_COLORS[status] ?? STATUS_COLORS.stopped;
					return <Icon className={`h-3.5 w-3.5 mt-0.5 ml-2 flex-shrink-0 ${color}`} />;
				})()}
		</div>
	);
}
