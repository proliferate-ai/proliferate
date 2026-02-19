"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	AutomationsIcon,
	BlocksIcon,
	BlocksLoadingIcon,
	SlackIcon,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { ItemActionsMenu } from "@/components/ui/item-actions-menu";
import { useDeleteSession, usePrefetchSession, useRenameSession } from "@/hooks/use-sessions";
import { cn } from "@/lib/utils";
import type { PendingRunSummary } from "@proliferate/shared";
import type { Session } from "@proliferate/shared/contracts";
import {
	type DisplayStatus,
	deriveDisplayStatus,
	getBlockedReasonText,
} from "@proliferate/shared/sessions";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, GitBranch, RotateCcw, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface SessionListRowProps {
	session: Session;
	pendingRun?: PendingRunSummary;
	isNew?: boolean;
}

function getRepoShortName(fullName: string): string {
	const parts = fullName.split("/");
	return parts[parts.length - 1];
}

const DISPLAY_STATUS_CONFIG: Record<
	DisplayStatus,
	{ animated: boolean; label: string; colorClassName: string }
> = {
	active: {
		animated: true,
		label: "Running",
		colorClassName: "text-foreground",
	},
	idle: {
		animated: false,
		label: "Idle",
		colorClassName: "text-muted-foreground",
	},
	paused: {
		animated: false,
		label: "Paused",
		colorClassName: "text-muted-foreground",
	},
	blocked: {
		animated: false,
		label: "Blocked",
		colorClassName: "text-destructive",
	},
	recovering: {
		animated: true,
		label: "Reconnecting",
		colorClassName: "text-muted-foreground",
	},
	completed: {
		animated: false,
		label: "Completed",
		colorClassName: "text-muted-foreground/50",
	},
	failed: {
		animated: false,
		label: "Failed",
		colorClassName: "text-destructive",
	},
};

/**
 * Build context subtitle based on display status.
 */
function getContextSubtitle(session: Session, displayStatus: DisplayStatus): string | null {
	switch (displayStatus) {
		case "idle":
			return session.promptSnippet ?? null;
		case "blocked":
			return getBlockedReasonText(session.pauseReason, session.status);
		case "recovering":
			return "Reconnecting...";
		case "completed":
		case "failed": {
			const endDate = session.endedAt ?? session.lastActivityAt;
			if (!endDate) return null;
			return formatDistanceToNow(new Date(endDate), { addSuffix: true });
		}
		default:
			return null;
	}
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

export function SessionListRow({ session, pendingRun, isNew }: SessionListRowProps) {
	const prefetchSession = usePrefetchSession();
	const renameSession = useRenameSession();
	const deleteSession = useDeleteSession();

	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(session.title || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const displayStatus = deriveDisplayStatus(session.status, session.pauseReason);
	const config = DISPLAY_STATUS_CONFIG[displayStatus];
	const Icon = config.animated ? BlocksLoadingIcon : BlocksIcon;
	const isResumable =
		session.snapshotId != null && (displayStatus === "idle" || displayStatus === "paused");

	const repoShortName = session.repo?.githubRepoName
		? getRepoShortName(session.repo.githubRepoName)
		: null;

	const repoAndBranch = `${repoShortName ?? "Untitled"}${session.branchName ? ` (${session.branchName})` : ""}`;
	const displayTitle = session.title || session.promptSnippet || repoAndBranch;

	const contextSubtitle = getContextSubtitle(session, displayStatus);

	const activityDate = session.lastActivityAt || session.startedAt;
	const timeAgo = activityDate
		? formatDistanceToNow(new Date(activityDate), { addSuffix: true })
		: null;

	const metaParts: string[] = [];
	if (repoShortName) metaParts.push(repoShortName);
	if (!contextSubtitle && timeAgo) metaParts.push(timeAgo);

	const href = pendingRun
		? `/workspace/${session.id}?runId=${pendingRun.id}`
		: `/workspace/${session.id}`;

	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	const handleRename = () => {
		setEditValue(session.title || "Untitled session");
		setIsEditing(true);
	};

	const handleSave = () => {
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== session.title) {
			renameSession.mutate(session.id, trimmed);
		}
		setIsEditing(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSave();
		} else if (e.key === "Escape") {
			setIsEditing(false);
			setEditValue(session.title || "");
		}
	};

	const handleDelete = async () => {
		await deleteSession.mutateAsync(session.id);
	};

	const router = useRouter();

	const handleRowClick = () => {
		if (isEditing) return;
		router.push(href);
	};

	return (
		<>
			<div
				role="link"
				tabIndex={0}
				className={cn(
					"group flex items-center px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm cursor-pointer last:border-0 gap-3",
					isNew && "animate-in fade-in slide-in-from-top-2 duration-300 bg-primary/5",
				)}
				onMouseEnter={() => prefetchSession(session.id)}
				onClick={handleRowClick}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !isEditing) handleRowClick();
				}}
			>
				{pendingRun && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}

				<div className="min-w-0 flex-1">
					<div className="font-medium text-foreground truncate">
						{isEditing ? (
							<Input
								ref={inputRef}
								type="text"
								variant="inline"
								size="auto"
								value={editValue}
								onChange={(e) => setEditValue(e.target.value)}
								onBlur={handleSave}
								onKeyDown={handleKeyDown}
								onClick={(e) => e.stopPropagation()}
								className="text-sm font-medium"
							/>
						) : (
							<span className="truncate block">{displayTitle}</span>
						)}
					</div>
					{contextSubtitle && (
						<span className="text-xs text-muted-foreground truncate block mt-0.5">
							{contextSubtitle}
						</span>
					)}
				</div>

				{session.branchName && (
					<div className="flex items-center gap-1 text-muted-foreground flex-shrink-0">
						<GitBranch className="h-3 w-3" />
						<span className="text-xs truncate max-w-[120px]">{session.branchName}</span>
					</div>
				)}

				<OriginBadge session={session} />

				{/* Trailing: metadata (default) or actions menu (on hover) */}
				<div className="shrink-0 flex items-center">
					<span
						className={cn(
							"text-xs text-muted-foreground whitespace-nowrap group-hover:hidden",
							menuOpen && "hidden",
						)}
					>
						{metaParts.join(" · ")}
					</span>
					<div
						className={cn("hidden group-hover:flex items-center", menuOpen && "flex")}
						onClick={(e) => e.stopPropagation()}
					>
						<ItemActionsMenu
							onRename={handleRename}
							onDelete={() => setDeleteDialogOpen(true)}
							onOpenChange={setMenuOpen}
						/>
					</div>
				</div>

				{isResumable && (
					<RotateCcw className="h-3 w-3 text-muted-foreground/50 shrink-0" aria-label="Resumable" />
				)}

				<span
					className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground flex-shrink-0"
					aria-label={`Status: ${config.label}`}
				>
					<Icon className={`h-3.5 w-3.5 ${config.colorClassName}`} />
					{config.label}
				</span>
			</div>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Session</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this session. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
