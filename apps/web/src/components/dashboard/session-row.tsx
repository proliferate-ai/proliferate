"use client";

import { BlocksIcon, BlocksLoadingIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { formatRelativeTime, getRepoShortName } from "@/lib/utils";
import { deriveDisplayStatus } from "@proliferate/shared/sessions";

interface SessionRowProps {
	title: string | null;
	promptSnippet?: string | null;
	repoName: string | null;
	branchName: string | null;
	status: string | null;
	pauseReason?: string | null;
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
	promptSnippet,
	repoName,
	branchName,
	status,
	pauseReason,
	lastActivityAt,
	startedAt,
	className,
}: SessionRowProps) {
	const repoShortName = repoName ? getRepoShortName(repoName) : "unknown";
	const activityDate = lastActivityAt || startedAt;
	const relativeTime = activityDate ? formatRelativeTime(activityDate) : "unknown";
	const repoAndBranch = `${repoShortName}${branchName ? ` (${branchName})` : ""}`;
	const displayTitle = title || promptSnippet || repoAndBranch;

	const displayStatus = deriveDisplayStatus(status, pauseReason);
	const isAnimated = displayStatus === "active" || displayStatus === "recovering";
	const Icon = isAnimated ? BlocksLoadingIcon : BlocksIcon;
	const color =
		displayStatus === "blocked" || displayStatus === "failed"
			? "text-destructive"
			: displayStatus === "active"
				? "text-foreground"
				: "text-muted-foreground/50";

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
			{status && <Icon className={`h-3.5 w-3.5 mt-0.5 ml-2 flex-shrink-0 ${color}`} />}
		</div>
	);
}
