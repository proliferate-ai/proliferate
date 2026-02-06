"use client";

import { type Provider, ProviderIcon } from "@/components/integrations/provider-icon";
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
import { FolderMinusIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { ItemActionsMenu } from "@/components/ui/item-actions-menu";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeletePrebuild, useUpdatePrebuild } from "@/hooks/use-prebuilds";
import { openEditSession, openSetupSession } from "@/stores/coding-session-store";
import {
	useCreateSession,
	useDeleteSession,
	useRenameSession,
	useSnapshotSession,
} from "@/hooks/use-sessions";
import { cn, getRepoShortName } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { Session } from "@proliferate/shared/contracts";
import { Camera, ChevronRight, MessageCircle, Pencil, Plus, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface Prebuild {
	id: string;
	name: string | null;
	snapshotId: string | null;
	createdAt: string;
	type?: "manual" | "managed";
	prebuildRepos?: Array<{
		repo: { id: string; githubRepoName: string } | null;
	}>;
	setupSessions?: Array<{
		id: string;
		sessionType: string;
	}>;
}

interface ConfigurationGroupProps {
	prebuild: Prebuild;
	sessions: Session[];
	activeSessionId: string | null | undefined;
	claimedSessionProviders: Map<string, string>;
	onNavigate?: () => void;
}

export function ConfigurationGroup({
	prebuild,
	sessions,
	activeSessionId,
	claimedSessionProviders,
	onNavigate,
}: ConfigurationGroupProps) {
	const [isOpen, setIsOpen] = useState(sessions.length > 0);
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(prebuild.name || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const router = useRouter();

	const isFinalized = prebuild.snapshotId !== null;
	const isManaged = prebuild.type === "managed";

	const firstRepo = prebuild.prebuildRepos?.[0]?.repo;
	const repoShortName = firstRepo?.githubRepoName
		? getRepoShortName(firstRepo.githubRepoName)
		: "Untitled";
	const displayName = prebuild.name || repoShortName;

	const setupSessionId = prebuild.setupSessions?.find(
		(s) => s.sessionType === "setup",
	)?.id;

	const updatePrebuild = useUpdatePrebuild();
	const deletePrebuild = useDeletePrebuild();
	const createSession = useCreateSession();
	const { setActiveSession, clearPendingPrompt } = useDashboardStore();

	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	const handleRename = () => {
		setEditValue(prebuild.name || displayName);
		setIsEditing(true);
	};

	const handleSave = () => {
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== prebuild.name) {
			updatePrebuild.mutate(prebuild.id, { name: trimmed });
		}
		setIsEditing(false);
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSave();
		} else if (e.key === "Escape") {
			setIsEditing(false);
			setEditValue(prebuild.name || "");
		}
	};

	const handleDelete = async () => {
		await deletePrebuild.mutateAsync(prebuild.id);
	};

	const handleEditEnvironment = () => {
		if (isFinalized && setupSessionId && prebuild.snapshotId) {
			openEditSession({
				sessionId: setupSessionId,
				snapshotId: prebuild.snapshotId,
				snapshotName: displayName,
				prebuildId: prebuild.id,
			});
		} else {
			openSetupSession(prebuild.id);
		}
	};

	const handleCreateSession = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!isFinalized || createSession.isPending) return;
		const result = await createSession.mutateAsync({
			prebuildId: prebuild.id,
			sessionType: "coding",
		});
		clearPendingPrompt();
		setActiveSession(result.sessionId);
		router.push(`/dashboard/sessions/${result.sessionId}`);
		onNavigate?.();
	};

	const newSessionButton = (
		<button
			type="button"
			onClick={handleCreateSession}
			disabled={!isFinalized || createSession.isPending}
			className={cn(
				"shrink-0 p-0.5 rounded transition-colors",
				isFinalized
					? "text-muted-foreground hover:text-foreground"
					: "text-muted-foreground/30 cursor-not-allowed",
			)}
		>
			<Plus className="h-3.5 w-3.5" />
		</button>
	);

	return (
		<>
			<div className="mt-0.5">
				{/* Group header */}
				<div
					onClick={() => setIsOpen(!isOpen)}
					className="group relative flex items-center gap-[0.38rem] px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors text-muted-foreground hover:text-foreground hover:bg-accent"
				>
					<ChevronRight
						className={cn("h-3 w-3 shrink-0 transition-transform", isOpen && "rotate-90")}
					/>
					<FolderMinusIcon className="h-4 w-4 shrink-0" />

					<div className="flex-1 min-w-0 flex items-center gap-1.5">
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
								className="text-sm"
							/>
						) : (
							<span className="truncate">{displayName}</span>
						)}
						{isManaged && <Zap className="h-3 w-3 text-yellow-500 shrink-0" />}
					</div>

					<div className="shrink-0 flex items-center gap-0.5">
						{isFinalized ? (
							newSessionButton
						) : (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>{newSessionButton}</TooltipTrigger>
									<TooltipContent side="top" className="max-w-[200px]">
										<p className="text-xs">Finish setting up this configuration to start sessions from it</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						)}
						<div className="opacity-0 group-hover:opacity-100 transition-opacity">
							<ItemActionsMenu
								onRename={handleRename}
								onDelete={() => setDeleteDialogOpen(true)}
								customActions={[
									{
										label: "Edit environment",
										icon: <Pencil className="h-4 w-4" />,
										onClick: handleEditEnvironment,
									},
								]}
							/>
						</div>
					</div>
				</div>

				{/* Child sessions */}
				<div
					className={cn(
						"overflow-hidden transition-all duration-200",
						isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
					)}
				>
					{sessions.map((session) => (
						<ConfigSessionItem
							key={session.id}
							session={session}
							isActive={activeSessionId === session.id}
							onNavigate={onNavigate}
							triggerProvider={claimedSessionProviders.get(session.id)}
						/>
					))}
				</div>
			</div>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Configuration</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete &quot;{displayName}&quot; and its configuration. This
							action cannot be undone.
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

/** Session item nested under a configuration group — indented with pl-7 */
function ConfigSessionItem({
	session,
	isActive,
	onNavigate,
	triggerProvider,
}: {
	session: Session;
	isActive: boolean;
	onNavigate?: () => void;
	triggerProvider?: string;
}) {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(session.title || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const router = useRouter();
	const { setActiveSession, clearPendingPrompt } = useDashboardStore();

	const renameSession = useRenameSession();
	const deleteSession = useDeleteSession();
	const snapshotSession = useSnapshotSession();

	const handleSnapshot = async () => {
		const toastId = toast.loading("Preparing snapshot...");
		const stages = [
			{ delay: 3000, message: "Capturing filesystem..." },
			{ delay: 10000, message: "Compressing data..." },
			{ delay: 25000, message: "Almost done..." },
		];
		const timeouts = stages.map(({ delay, message }) =>
			setTimeout(() => toast.loading(message, { id: toastId }), delay),
		);
		try {
			await snapshotSession.mutateAsync(session.id);
			toast.success("Snapshot saved", { id: toastId });
		} catch {
			toast.error("Failed to save snapshot", { id: toastId });
		} finally {
			timeouts.forEach(clearTimeout);
		}
	};

	const snapshotAction =
		session.status === "running"
			? [
					{
						label: snapshotSession.isPending ? "Saving..." : "Save Snapshot",
						icon: <Camera className="h-4 w-4" />,
						onClick: handleSnapshot,
					},
				]
			: undefined;

	const handleDelete = async () => {
		await deleteSession.mutateAsync(session.id);
		if (isActive) {
			router.push("/dashboard");
		}
	};

	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	const handleClick = () => {
		clearPendingPrompt();
		setActiveSession(session.id);
		router.push(`/dashboard/sessions/${session.id}`);
		onNavigate?.();
	};

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

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSave();
		} else if (e.key === "Escape") {
			setIsEditing(false);
			setEditValue(session.title || "");
		}
	};

	const repoShortName = session.repo?.githubRepoName
		? getRepoShortName(session.repo.githubRepoName)
		: "unknown";
	const branchName = session.branchName || "";
	const displayTitle = session.title || `${repoShortName}${branchName ? ` (${branchName})` : ""}`;

	return (
		<>
			<div
				className={cn(
					"group relative flex items-center gap-[0.38rem] pl-7 pr-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors",
					isActive
						? "bg-muted text-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-accent",
				)}
				onClick={handleClick}
			>
				{/* Icon */}
				<div className="flex items-center justify-center shrink-0">
					{triggerProvider ? (
						<ProviderIcon provider={triggerProvider as Provider} size="sm" />
					) : (
						<MessageCircle className="h-4 w-4" />
					)}
				</div>

				{/* Name */}
				<div className="flex-1 min-w-0 flex items-center">
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
							className="text-sm"
						/>
					) : (
						<span className="truncate">{displayTitle}</span>
					)}
				</div>

				{/* Trailing: running indicator or actions on hover */}
				<div className="shrink-0 flex items-center">
					{session.status === "running" && <StatusDot status="running" className="mr-1" />}
					<div className="opacity-0 group-hover:opacity-100 transition-opacity">
						<ItemActionsMenu
							onRename={handleRename}
							onDelete={() => setDeleteDialogOpen(true)}
							customActions={snapshotAction}
							isVisible={isActive}
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
