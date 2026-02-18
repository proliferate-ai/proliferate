"use client";

import { AutomationsIcon, BlocksIcon, BlocksLoadingIcon, SlackIcon } from "@/components/ui/icons";
import { usePrefetchSession } from "@/hooks/use-sessions";
import type { PendingRunSummary } from "@proliferate/shared";
import type { Session } from "@proliferate/shared/contracts";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, GitBranch, Terminal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SessionListRowProps {
	session: Session;
	pendingRun?: PendingRunSummary;
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

function OriginBadge({ session }: { session: Session }) {
	const router = useRouter();

	if (session.automationId && session.automation) {
		return (
			<button
				type="button"
				className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					router.push(`/dashboard/automations/${session.automation!.id}/events`);
				}}
			>
				<AutomationsIcon className="h-3 w-3" />
				<span className="truncate max-w-[100px]">{session.automation.name}</span>
			</button>
		);
	}

	if (session.origin === "slack" || session.clientType === "slack") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
				<SlackIcon className="h-3 w-3" />
				<span>Slack</span>
			</span>
		);
	}

	if (session.origin === "cli" || session.clientType === "cli") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
				<Terminal className="h-3 w-3" />
				<span>CLI</span>
			</span>
		);
	}

	return null;
}

export function SessionListRow({ session, pendingRun }: SessionListRowProps) {
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

	const href = pendingRun
		? `/workspace/${session.id}?runId=${pendingRun.id}`
		: `/workspace/${session.id}`;

	return (
		<Link href={href}>
			<div
				className="flex items-center px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm cursor-pointer last:border-0 gap-3"
				onMouseEnter={() => prefetchSession(session.id)}
			>
				{pendingRun && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}

				<span className="font-medium text-foreground truncate min-w-0 flex-1">{displayTitle}</span>

				{session.branchName && (
					<div className="flex items-center gap-1 text-muted-foreground flex-shrink-0">
						<GitBranch className="h-3 w-3" />
						<span className="text-xs truncate max-w-[120px]">{session.branchName}</span>
					</div>
				)}

				<OriginBadge session={session} />

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
