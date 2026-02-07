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
import { Input } from "@/components/ui/input";
import { ItemActionsMenu } from "@/components/ui/item-actions-menu";
import { StatusDot } from "@/components/ui/status-dot";
import { useDeletePrebuild, useUpdatePrebuild } from "@/hooks/use-prebuilds";
import {
	useCreateSession,
	useDeleteSession,
	useRenameSession,
	useSnapshotSession,
} from "@/hooks/use-sessions";
import { cn, formatRelativeTime, getRepoShortName } from "@/lib/utils";
import { openEditSession, openSetupSession } from "@/stores/coding-session-store";
import { useDashboardStore } from "@/stores/dashboard";
import type { Session } from "@proliferate/shared/contracts";
import { Camera, Folder, FolderOpen, Pencil, Plus, Zap } from "lucide-react";
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
	onNavigate?: () => void;
}

export function ConfigurationGroup({
	prebuild,
	sessions,
	activeSessionId,
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

	const setupSessionId = prebuild.setupSessions?.find((s) => s.sessionType === "setup")?.id;

	const updatePrebuild = useUpdatePrebuild();
	const deletePrebuild = useDeletePrebuild();
	const createSession = useCreateSession();
	const { selectedModel, setActiveSession, clearPendingPrompt } = useDashboardStore();

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

	const handleCreateSession = async () => {
		if (createSession.isPending) return;
		const result = await createSession.mutateAsync({
			prebuildId: prebuild.id,
			sessionType: "coding",
			modelId: selectedModel,
		});
		clearPendingPrompt();
		setActiveSession(result.sessionId);
		router.push(`/dashboard/sessions/${result.sessionId}`);
		onNavigate?.();
	};

	return (
		<>
			<div className="mt-0.5">
				{/* Group header */}
				<div
					onClick={() => setIsOpen(!isOpen)}
					className="group relative flex items-center gap-[0.38rem] px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors text-muted-foreground hover:text-foreground hover:bg-accent"
				>
					{isOpen ? (
						<FolderOpen className="h-4 w-4 shrink-0" />
					) : (
						<Folder className="h-4 w-4 shrink-0" />
					)}

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
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								handleCreateSession();
							}}
							disabled={createSession.isPending}
							className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
						>
							<Plus className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>

				{/* Child sessions */}
				<div
					className={cn(
						"overflow-hidden transition-all duration-200",
						isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
					)}
				>
					{sessions.length > 0 ? (
						sessions.map((session) => (
							<ConfigSessionItem
								key={session.id}
								session={session}
								isActive={activeSessionId === session.id}
								onNavigate={onNavigate}
							/>
						))
					) : (
						<div className="pl-7 pr-3 py-1.5 text-xs text-muted-foreground/60">No sessions</div>
					)}
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
}: {
	session: Session;
	isActive: boolean;
	onNavigate?: () => void;
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
				{/* Name with optional running dot */}
				<div className="flex-1 min-w-0 flex items-center gap-1.5">
					{session.status === "running" && <StatusDot status="running" size="sm" />}
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

				{/* Trailing: timestamp (default) or actions (on hover) */}
				<div className="shrink-0 flex items-center">
					<span className="text-xs text-muted-foreground/60 group-hover:hidden">
						{formatRelativeTime(session.lastActivityAt || session.startedAt || "")}
					</span>
					<div className="hidden group-hover:flex items-center">
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
