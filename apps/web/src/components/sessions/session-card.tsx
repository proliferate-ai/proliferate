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
import { AutomationsIcon, BlocksIcon, BlocksLoadingIcon, SlackIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { ItemActionsMenu } from "@/components/ui/item-actions-menu";
import { useHasSlackInstallation } from "@/hooks/integrations/use-integrations";
import {
	useDeleteSession,
	usePrefetchSession,
	useRenameSession,
	useSessionNotificationSubscription,
	useSubscribeNotifications,
	useUnsubscribeNotifications,
} from "@/hooks/sessions/use-sessions";
import { DISPLAY_STATUS_CONFIG, formatConfigurationLabel } from "@/lib/display/session-display";
import { cn } from "@/lib/display/utils";
import type { PendingRunSummary } from "@proliferate/shared";
import type { Session } from "@proliferate/shared/contracts";
import { type DisplayStatus, deriveDisplayStatus } from "@proliferate/shared/sessions";
import { formatDistanceToNow } from "date-fns";
import { Bell, BellOff, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface SessionListRowProps {
	session: Session;
	pendingRun?: PendingRunSummary;
	isNew?: boolean;
	onClick?: (sessionId: string) => void;
}

function getRepoShortName(fullName: string): string {
	const parts = fullName.split("/");
	return parts[parts.length - 1];
}

/**
 * Attention indicator dot based on operator status.
 */
function AttentionCell({
	session,
	pendingRun,
}: { session: Session; pendingRun?: PendingRunSummary }) {
	const operatorStatus = session.operatorStatus;

	if (pendingRun) {
		return (
			<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
				<span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
				Pending
			</span>
		);
	}

	if (operatorStatus === "waiting_for_approval") {
		return (
			<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
				<span className="h-1.5 w-1.5 rounded-full bg-foreground/60 shrink-0" />
				Approval
			</span>
		);
	}

	if (operatorStatus === "needs_input") {
		return (
			<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
				<span className="h-1.5 w-1.5 rounded-full bg-foreground/40 shrink-0" />
				Input
			</span>
		);
	}

	if (operatorStatus === "errored") {
		return (
			<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
				<span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
				Error
			</span>
		);
	}

	return <span className="text-xs text-muted-foreground/50">&mdash;</span>;
}

/**
 * Origin label for the table cell.
 */
function OriginCell({ session }: { session: Session }) {
	if (session.automationId && session.automation) {
		return (
			<span className="text-xs text-muted-foreground truncate block">
				{session.automation.name}
			</span>
		);
	}

	if (session.origin === "slack" || session.clientType === "slack") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
				<SlackIcon className="h-3 w-3" />
				Slack
			</span>
		);
	}

	if (session.origin === "cli" || session.clientType === "cli") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
				<Terminal className="h-3 w-3" />
				CLI
			</span>
		);
	}

	return <span className="text-xs text-muted-foreground">Ad-hoc</span>;
}

/**
 * Creator column: show initials from createdBy or a dash.
 */
function CreatorCell({ createdBy }: { createdBy: string | null }) {
	if (!createdBy) return <span className="text-xs text-muted-foreground/50">&mdash;</span>;
	// Show first 2 chars as initials (user IDs are UUIDs, but we show a short identifier)
	return (
		<span className="text-xs text-muted-foreground truncate block" title={createdBy}>
			{createdBy.slice(0, 8)}
		</span>
	);
}

export function SessionListRow({ session, pendingRun, isNew, onClick }: SessionListRowProps) {
	const prefetchSession = usePrefetchSession();
	const renameSession = useRenameSession();
	const deleteSession = useDeleteSession();

	const canSubscribe = session.status === "running" || session.status === "starting";
	const { data: isSubscribed } = useSessionNotificationSubscription(session.id, canSubscribe);
	const subscribeNotifications = useSubscribeNotifications();
	const unsubscribeNotifications = useUnsubscribeNotifications();
	const { hasSlack } = useHasSlackInstallation();

	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(session.title || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const displayStatus = deriveDisplayStatus(session.status, session.pauseReason);
	const config = DISPLAY_STATUS_CONFIG[displayStatus];
	const Icon = config.animated ? BlocksLoadingIcon : BlocksIcon;

	const repoShortName = session.repo?.githubRepoName
		? getRepoShortName(session.repo.githubRepoName)
		: null;

	const displayTitle = session.title || session.promptSnippet || repoShortName || "Untitled";

	const activityDate = session.lastActivityAt || session.startedAt;
	const timeAgo = activityDate
		? formatDistanceToNow(new Date(activityDate), { addSuffix: true })
		: null;

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
		if (onClick) {
			onClick(session.id);
		} else {
			router.push(`/workspace/${session.id}`);
		}
	};

	return (
		<>
			<div
				role="link"
				tabIndex={0}
				className={cn(
					"group flex items-center px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm cursor-pointer last:border-0",
					isNew && "animate-in fade-in slide-in-from-top-2 duration-300 bg-primary/5",
				)}
				onMouseEnter={() => prefetchSession(session.id)}
				onClick={handleRowClick}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !isEditing) handleRowClick();
				}}
			>
				{/* Title (flex-1) */}
				<div className="flex-1 min-w-[180px]">
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
					) : session.titleStatus === "generating" ? (
						<span className="inline-block h-4 w-40 rounded bg-muted-foreground/20 animate-pulse" />
					) : (
						<span className="font-medium text-foreground truncate block">{displayTitle}</span>
					)}
				</div>

				{/* Repo (w-24, hidden on mobile) */}
				<div className="w-24 shrink-0 hidden md:block">
					<span className="text-xs text-muted-foreground truncate block">
						{repoShortName || "\u2014"}
					</span>
				</div>

				{/* Branch (w-28, hidden on mobile) */}
				<div className="w-28 shrink-0 hidden md:block">
					<span className="text-xs text-muted-foreground truncate block">
						{session.branchName || "\u2014"}
					</span>
				</div>

				{/* Status (w-20) */}
				<div className="w-20 shrink-0 flex items-center gap-1.5">
					<Icon className={cn("h-3.5 w-3.5 shrink-0", config.colorClassName)} />
					<span className="text-[11px] font-medium text-muted-foreground">{config.label}</span>
				</div>

				{/* Attention (w-24) */}
				<div className="w-24 shrink-0">
					<AttentionCell session={session} pendingRun={pendingRun} />
				</div>

				{/* Origin (w-20, hidden on mobile) */}
				<div className="w-20 shrink-0 hidden md:block">
					<OriginCell session={session} />
				</div>

				{/* Creator (w-20, hidden on mobile) */}
				<div className="w-20 shrink-0 hidden md:block">
					<CreatorCell createdBy={session.createdBy} />
				</div>

				{/* Updated (w-20) */}
				<div className="w-20 shrink-0">
					<span className="text-xs text-muted-foreground truncate block">
						{timeAgo || "\u2014"}
					</span>
				</div>

				{/* Actions overlay (w-6) */}
				<div className="w-6 shrink-0 relative flex items-center justify-center">
					<div
						className={cn("hidden group-hover:flex items-center", menuOpen && "flex")}
						onClick={(e) => e.stopPropagation()}
					>
						<ItemActionsMenu
							onRename={handleRename}
							onDelete={() => setDeleteDialogOpen(true)}
							customActions={
								canSubscribe
									? [
											{
												label: isSubscribed ? "Notifications on" : "Notify me",
												icon: isSubscribed ? (
													<BellOff className="h-4 w-4" />
												) : (
													<Bell className="h-4 w-4" />
												),
												onClick: async () => {
													try {
														if (isSubscribed) {
															await unsubscribeNotifications.mutateAsync({
																sessionId: session.id,
															});
															toast.success("Notifications turned off");
														} else {
															await subscribeNotifications.mutateAsync({
																sessionId: session.id,
															});
															toast.success("You'll be notified when this session completes");
														}
													} catch (err) {
														const message =
															err instanceof Error ? err.message : "Failed to update notifications";
														toast.error(message);
													}
												},
												disabled: !hasSlack,
												description: !hasSlack ? "Connect Slack in Settings" : undefined,
											},
										]
									: undefined
							}
							onOpenChange={setMenuOpen}
						/>
					</div>
				</div>
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
