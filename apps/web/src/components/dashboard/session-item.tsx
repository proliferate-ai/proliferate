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
import {
	useDeleteSession,
	usePrefetchSession,
	useRenameSession,
	useSnapshotSession,
} from "@/hooks/use-sessions";
import { cn, formatRelativeTime, getRepoShortName } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { Session } from "@proliferate/shared/contracts";
import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface SessionItemProps {
	session: Session;
	isActive: boolean;
	onNavigate?: () => void;
}

export function SessionItem({ session, isActive, onNavigate }: SessionItemProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(session.title || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const router = useRouter();
	const { setActiveSession, clearPendingPrompt } = useDashboardStore();

	const renameSession = useRenameSession();
	const deleteSession = useDeleteSession();
	const snapshotSession = useSnapshotSession();
	const prefetchSession = usePrefetchSession();

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

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSave();
		} else if (e.key === "Escape") {
			setIsEditing(false);
			setEditValue(session.title || "");
		}
	};

	const repoShortName = session.repo?.githubRepoName
		? getRepoShortName(session.repo.githubRepoName)
		: null;
	const branchName = session.branchName || "";
	const displayTitle =
		session.title ||
		(repoShortName
			? `${repoShortName}${branchName ? ` (${branchName})` : ""}`
			: "Untitled session");

	return (
		<>
			<div
				className={cn(
					"group relative flex items-center gap-[0.38rem] px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors",
					isActive
						? "bg-muted text-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-accent",
				)}
				onClick={handleClick}
				onMouseEnter={() => prefetchSession(session.id)}
			>
				<div className="flex-1 min-w-0">
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
						<span className="truncate block">{displayTitle}</span>
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
