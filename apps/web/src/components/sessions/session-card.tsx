"use client";

import { BlocksIcon, BlocksLoadingIcon } from "@/components/ui/icons";
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

const STATUS_CONFIG: Record<string, { animated: boolean; label: string; colorClassName: string }> =
	{
		running: {
			animated: true,
			label: "Running",
			colorClassName: "text-emerald-500",
		},
		starting: {
			animated: true,
			label: "Starting",
			colorClassName: "text-muted-foreground",
		},
		paused: {
			animated: false,
			label: "Paused",
			colorClassName: "text-amber-500",
		},
		suspended: {
			animated: false,
			label: "Suspended",
			colorClassName: "text-orange-500",
		},
		stopped: {
			animated: false,
			label: "Stopped",
			colorClassName: "text-muted-foreground/50",
		},
	};

function getStatusConfig(status: Session["status"]) {
	return STATUS_CONFIG[status ?? "stopped"] ?? STATUS_CONFIG.stopped;
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

	const config = getStatusConfig(session.status);
	const Icon = config.animated ? BlocksLoadingIcon : BlocksIcon;

	return (
		<Link href={`/workspace/${session.id}`}>
			<div
				className="flex items-center px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm cursor-pointer last:border-0 gap-3"
				onMouseEnter={() => prefetchSession(session.id)}
			>
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

				<span className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground flex-shrink-0">
					<Icon className={`h-3.5 w-3.5 ${config.colorClassName}`} />
					{config.label}
				</span>
			</div>
		</Link>
	);
}
