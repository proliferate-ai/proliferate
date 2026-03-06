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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BlocksIcon, BlocksLoadingIcon, SlackIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { ItemActionsMenu } from "@/components/ui/item-actions-menu";
import { OVERALL_WORK_STATE_DISPLAY, type OverallWorkStateDisplayConfig } from "@/config/sessions";
import { useHasSlackInstallation } from "@/hooks/integrations/use-integrations";
import { useOverallWorkState } from "@/hooks/sessions/use-overall-work-state";
import {
	useDeleteSession,
	usePrefetchSession,
	useRenameSession,
	useSessionNotificationSubscription,
	useSubscribeNotifications,
	useUnsubscribeNotifications,
} from "@/hooks/sessions/use-sessions";
import { cn } from "@/lib/display/utils";
import type { PendingRunSummary } from "@proliferate/shared/contracts/automations";
import type { Session } from "@proliferate/shared/contracts/sessions";
import { formatDistanceToNowStrict } from "date-fns";
import { Bell, BellOff, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
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

function Column({ className, children }: { className: string; children: ReactNode }) {
	return <div className={className}>{children}</div>;
}

function formatCompactTimeAgo(date: Date): string {
	const distance = formatDistanceToNowStrict(date);
	const [value, unit] = distance.split(" ");
	const unitKey = unit?.toLowerCase() ?? "";

	if (unitKey.startsWith("second")) return `${value}s ago`;
	if (unitKey.startsWith("minute")) return `${value}m ago`;
	if (unitKey.startsWith("hour")) return `${value}h ago`;
	if (unitKey.startsWith("day")) return `${value}d ago`;
	if (unitKey.startsWith("month")) return `${value}mo ago`;
	if (unitKey.startsWith("year")) return `${value}y ago`;
	return `${distance} ago`;
}

/**
 * Attention indicator dot based on operator status.
 */
function AttentionCell({
	pendingRun,
	requiresHumanReview,
}: {
	pendingRun?: PendingRunSummary;
	requiresHumanReview?: boolean;
}) {
	if (pendingRun) {
		return (
			<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
				<span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
				Pending
			</span>
		);
	}

	if (requiresHumanReview) {
		return (
			<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
				<span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
				Review
			</span>
		);
	}

	return null;
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

function RepoCell({ repoShortName }: { repoShortName: string | null }) {
	return (
		<span className="text-xs text-muted-foreground truncate block">
			{repoShortName || "No repo"}
		</span>
	);
}

function BranchCell({ branchName }: { branchName: string | null }) {
	return <span className="text-xs text-muted-foreground truncate block">{branchName}</span>;
}

function StatusCell({ config }: { config: OverallWorkStateDisplayConfig }) {
	const Icon = config.animated ? BlocksLoadingIcon : BlocksIcon;
	return (
		<>
			<Icon className={cn("h-3.5 w-3.5 shrink-0", config.colorClassName)} />
			<span className="text-[11px] font-medium text-muted-foreground">{config.label}</span>
		</>
	);
}

function UpdatedCell({ timeAgo }: { timeAgo: string | null }) {
	return (
		<span className="text-xs text-muted-foreground whitespace-nowrap block">
			{timeAgo || "\u2014"}
		</span>
	);
}

/**
 * Creator column: show initials from createdBy or a dash.
 */
function getInitials(value: string): string {
	const normalized = value.trim();
	if (!normalized) return "?";
	const parts = normalized.split(/\s+/).filter(Boolean);
	if (parts.length >= 2) {
		return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
	}
	return normalized.slice(0, 2).toUpperCase();
}

function CreatorCell({
	createdBy,
	creator,
}: {
	createdBy: string | null;
	creator?: { id: string; name: string; image: string | null } | null;
}) {
	if (!createdBy || createdBy === "system") {
		return (
			<Avatar className="h-5 w-5" title="System">
				<AvatarFallback className="text-[9px]">S</AvatarFallback>
			</Avatar>
		);
	}

	const displayName = creator?.name || createdBy.slice(0, 8);
	return (
		<Avatar className="h-5 w-5" title={displayName}>
			<AvatarImage src={creator?.image ?? undefined} alt={displayName} />
			<AvatarFallback className="text-[9px]">{getInitials(displayName)}</AvatarFallback>
		</Avatar>
	);
}

export function SessionListRow({ session, pendingRun, isNew, onClick }: SessionListRowProps) {
	const prefetchSession = usePrefetchSession();
	const renameSession = useRenameSession();
	const deleteSession = useDeleteSession();

	const sandboxState =
		typeof session.status === "object" && session.status !== null
			? session.status.sandboxState
			: session.status;
	const canSubscribe = sandboxState === "running" || sandboxState === "provisioning";
	const { data: isSubscribed } = useSessionNotificationSubscription(session.id, canSubscribe);
	const subscribeNotifications = useSubscribeNotifications();
	const unsubscribeNotifications = useUnsubscribeNotifications();
	const { hasSlack } = useHasSlackInstallation();

	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(session.title || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const { overallWorkState } = useOverallWorkState(session, pendingRun);
	const config = OVERALL_WORK_STATE_DISPLAY[overallWorkState];

	const repoShortName = session.repo?.githubRepoName
		? getRepoShortName(session.repo.githubRepoName)
		: null;

	const displayTitle = session.title || session.promptSnippet || repoShortName || "Untitled";
	const hasUnreadUpdate = session.hasUnreadUpdate ?? session.unread ?? false;

	const activityDate = session.lastActivityAt || session.startedAt;
	const timeAgo = activityDate ? formatCompactTimeAgo(new Date(activityDate)) : null;

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
				<div className="flex-1 min-w-[140px]">
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
						<span className="inline-flex items-center gap-1.5 min-w-0">
							{hasUnreadUpdate ? (
								<span
									className="h-1.5 w-1.5 rounded-full bg-primary shrink-0"
									aria-label="Unread update"
									title="Unread update"
								/>
							) : null}
							<span className="font-medium text-foreground truncate block">{displayTitle}</span>
						</span>
					)}
				</div>

				{/* Repo (w-24, hidden on mobile) */}
				<Column className="w-24 shrink-0 hidden md:block">
					<RepoCell repoShortName={repoShortName} />
				</Column>

				{/* Branch (w-28, hidden on mobile) */}
				<Column className="w-24 shrink-0 hidden md:block">
					<BranchCell branchName={session.branchName} />
				</Column>

				{/* Status (w-20) */}
				<Column className="w-20 shrink-0 flex items-center gap-1.5">
					<StatusCell config={config} />
				</Column>

				{/* Attention (w-24) */}
				<Column className="w-20 shrink-0">
					<AttentionCell
						pendingRun={pendingRun}
						requiresHumanReview={session.status.requiresHumanReview}
					/>
				</Column>

				{/* Origin (w-20, hidden on mobile) */}
				<Column className="w-16 shrink-0 hidden md:block">
					<OriginCell session={session} />
				</Column>

				{/* Creator avatar (w-8, hidden on mobile) */}
				<Column className="w-8 shrink-0 hidden md:flex items-center">
					<CreatorCell createdBy={session.createdBy} creator={session.creator} />
				</Column>

				{/* Updated (w-20) */}
				<Column className="w-14 shrink-0 text-right">
					<UpdatedCell timeAgo={timeAgo} />
				</Column>

				{/* Actions overlay (w-6) */}
				<div className="w-5 shrink-0 relative flex items-center justify-center">
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
