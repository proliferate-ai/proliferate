"use client";

import { WorkerOrb } from "@/components/automations/worker-card";
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
import { Badge } from "@/components/ui/badge";
import {
	BlocksIcon,
	BlocksLoadingIcon,
	GithubIcon,
	OpenCodeIcon,
	SlackIcon,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { ItemActionsMenu } from "@/components/ui/item-actions-menu";
import { OVERALL_WORK_STATE_DISPLAY, type OverallWorkStateDisplayConfig } from "@/config/sessions";
import { useHasSlackInstallation } from "@/hooks/integrations/use-integrations";
import { useOverallWorkState } from "@/hooks/sessions/use-overall-work-state";
import {
	useArchiveSession,
	useDeleteSession,
	usePrefetchSession,
	useRenameSession,
	useSessionNotificationSubscription,
	useSubscribeNotifications,
	useUnsubscribeNotifications,
} from "@/hooks/sessions/use-sessions";
import { parsePrUrl } from "@/lib/display/session-display";
import { cn } from "@/lib/display/utils";
import type { PendingRunSummary } from "@proliferate/shared/contracts/automations";
import type { Session } from "@proliferate/shared/contracts/sessions";
import { formatDistanceToNowStrict } from "date-fns";
import { Archive, Bell, BellOff, GitPullRequestArrow, Settings, Terminal } from "lucide-react";
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

function OriginCell({ session }: { session: Session }) {
	const name =
		session.automationId && session.automation
			? session.automation.name
			: (session.workerName ?? null);

	if (name) {
		return (
			<span className="inline-flex items-center gap-1.5" title={name}>
				<WorkerOrb name={name} size={16} />
			</span>
		);
	}

	if (session.origin === "slack" || session.clientType === "slack") {
		return (
			<span className="inline-flex items-center" title="Slack">
				<SlackIcon className="h-4 w-4" />
			</span>
		);
	}

	if (session.origin === "cli" || session.clientType === "cli") {
		return (
			<span className="inline-flex items-center" title="CLI">
				<Terminal className="h-4 w-4 text-muted-foreground" />
			</span>
		);
	}

	return (
		<span className="inline-flex items-center" title="OpenCode">
			<OpenCodeIcon className="h-4 w-4" />
		</span>
	);
}

function RepoCell({
	repoShortName,
	prUrls,
}: {
	repoShortName: string | null;
	prUrls: string[] | null | undefined;
}) {
	const firstPr = prUrls?.[0] ? parsePrUrl(prUrls[0]) : null;

	return (
		<span className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate min-w-0">
			{repoShortName ? (
				<>
					<GithubIcon className="h-3 w-3 shrink-0 -translate-y-px" />
					<span className="truncate">{repoShortName}</span>
				</>
			) : null}
			{firstPr && (
				<a
					href={prUrls![0]}
					target="_blank"
					rel="noopener noreferrer"
					onClick={(e) => e.stopPropagation()}
					className="inline-flex items-center gap-0.5 text-primary hover:underline shrink-0"
				>
					<GitPullRequestArrow className="h-3 w-3" />
					<span>#{firstPr.number}</span>
				</a>
			)}
		</span>
	);
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
		return null;
	}

	if (!creator) {
		return (
			<Avatar className="h-5 w-5">
				<AvatarFallback className="text-[9px]" />
			</Avatar>
		);
	}

	return (
		<Avatar className="h-5 w-5" title={creator.name}>
			<AvatarImage src={creator.image ?? undefined} alt={creator.name} />
			<AvatarFallback className="text-[9px]">{getInitials(creator.name)}</AvatarFallback>
		</Avatar>
	);
}

export function SessionListRow({ session, pendingRun, isNew, onClick }: SessionListRowProps) {
	const prefetchSession = usePrefetchSession();
	const renameSession = useRenameSession();
	const deleteSession = useDeleteSession();
	const archiveSession = useArchiveSession();

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

	const { overallWorkState, needsUrgentAttention } = useOverallWorkState(session, pendingRun);
	const config = OVERALL_WORK_STATE_DISPLAY[overallWorkState];
	const isWorking = overallWorkState === "working";

	const repoShortName = session.repo?.githubRepoName
		? getRepoShortName(session.repo.githubRepoName)
		: null;

	const displayTitle = session.title || session.promptSnippet || repoShortName || "Untitled";
	const isSetup = session.kind === "setup" || session.sessionType === "setup";

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
					isWorking && "bg-primary/[0.03] border-l-2 border-l-primary/40",
				)}
				onMouseEnter={() => prefetchSession(session.id)}
				onClick={handleRowClick}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !isEditing) handleRowClick();
				}}
			>
				{/* Agent icon */}
				<div className="w-6 shrink-0 flex items-center justify-center relative">
					<OriginCell session={session} />
					{needsUrgentAttention && (
						<span
							className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary"
							aria-label="Needs attention"
							title="Needs attention"
						/>
					)}
				</div>

				{/* Title (flex-1) */}
				<div className="flex-1 min-w-[140px] flex items-center gap-1.5 ml-1.5">
					{isSetup && (
						<Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0 gap-0.5">
							<Settings className="h-2.5 w-2.5" />
							Setup
						</Badge>
					)}
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

				{/* Repo + PR (w-32, hidden on mobile) */}
				<Column className="w-32 shrink-0 hidden md:block">
					<RepoCell repoShortName={repoShortName} prUrls={session.prUrls} />
				</Column>

				{/* Status (w-20) */}
				<Column className="w-20 shrink-0 flex items-center gap-1.5">
					<StatusCell config={config} />
				</Column>

				{/* Creator avatar (w-8, hidden on mobile) */}
				<Column className="w-8 shrink-0 hidden md:flex items-center">
					<CreatorCell createdBy={session.createdBy} creator={session.creator} />
				</Column>

				{/* Updated (w-14) */}
				<Column className="w-14 shrink-0 text-right">
					<UpdatedCell timeAgo={timeAgo} />
				</Column>

				{/* Actions overlay (w-5) */}
				<div className="w-5 shrink-0 relative flex items-center justify-center">
					<div
						className={cn("hidden group-hover:flex items-center", menuOpen && "flex")}
						onClick={(e) => e.stopPropagation()}
					>
						<ItemActionsMenu
							onRename={handleRename}
							onDelete={() => setDeleteDialogOpen(true)}
							customActions={[
								...(canSubscribe
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
									: []),
								{
									label: "Archive",
									icon: <Archive className="h-4 w-4" />,
									onClick: async () => {
										try {
											await archiveSession.mutateAsync(session.id);
											toast.success("Session archived");
										} catch (err) {
											toast.error(err instanceof Error ? err.message : "Failed to archive session");
										}
									},
								},
							]}
							onOpenChange={setMenuOpen}
						/>
					</div>
				</div>
			</div>

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
