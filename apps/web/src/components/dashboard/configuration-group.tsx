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
import { useDeleteConfiguration, useUpdateConfiguration } from "@/hooks/use-configurations";
import { useCreateSession } from "@/hooks/use-sessions";
import { cn, getRepoShortName } from "@/lib/utils";
import { openEditSession, openSetupSession } from "@/stores/coding-session-store";
import { useDashboardStore } from "@/stores/dashboard";
import type { Session } from "@proliferate/shared/contracts";
import { ChevronRight, Pencil, Plus, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { SessionItem } from "./session-item";

interface Configuration {
	id: string;
	name: string | null;
	snapshotId: string | null;
	createdAt: string;
	type?: "manual" | "managed";
	configurationRepos?: Array<{
		repo: { id: string; githubRepoName: string } | null;
	}>;
	setupSessions?: Array<{
		id: string;
		sessionType: string;
	}>;
}

interface ConfigurationGroupProps {
	configuration: Configuration;
	sessions: Session[];
	activeSessionId: string | null | undefined;
	onNavigate?: () => void;
}

export function ConfigurationGroup({
	configuration,
	sessions,
	activeSessionId,
	onNavigate,
}: ConfigurationGroupProps) {
	const [isOpen, setIsOpen] = useState(sessions.length > 0);
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(configuration.name || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const router = useRouter();

	const isFinalized = configuration.snapshotId !== null;
	const isManaged = configuration.type === "managed";

	const firstRepo = configuration.configurationRepos?.[0]?.repo;
	const repoShortName = firstRepo?.githubRepoName
		? getRepoShortName(firstRepo.githubRepoName)
		: "Untitled";
	const displayName = configuration.name || repoShortName;

	const setupSessionId = configuration.setupSessions?.find((s) => s.sessionType === "setup")?.id;

	const updateConfiguration = useUpdateConfiguration();
	const deleteConfiguration = useDeleteConfiguration();
	const createSession = useCreateSession();
	const { selectedModel, setActiveSession, clearPendingPrompt } = useDashboardStore();

	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	const handleRename = () => {
		setEditValue(configuration.name || displayName);
		setIsEditing(true);
	};

	const handleSave = () => {
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== configuration.name) {
			updateConfiguration.mutate(configuration.id, { name: trimmed });
		}
		setIsEditing(false);
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSave();
		} else if (e.key === "Escape") {
			setIsEditing(false);
			setEditValue(configuration.name || "");
		}
	};

	const handleDelete = async () => {
		await deleteConfiguration.mutateAsync(configuration.id);
	};

	const handleEditEnvironment = () => {
		if (isFinalized && setupSessionId && configuration.snapshotId) {
			openEditSession({
				sessionId: setupSessionId,
				snapshotId: configuration.snapshotId,
				snapshotName: displayName,
				configurationId: configuration.id,
			});
		} else {
			openSetupSession(configuration.id);
		}
	};

	const handleCreateSession = async () => {
		if (createSession.isPending) return;
		const result = await createSession.mutateAsync({
			configurationId: configuration.id,
			sessionType: "coding",
			modelId: selectedModel,
		});
		clearPendingPrompt();
		setActiveSession(result.sessionId);
		router.push(`/workspace/${result.sessionId}`);
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
					<ChevronRight
						className={cn(
							"h-3.5 w-3.5 shrink-0 transition-transform duration-200",
							isOpen && "rotate-90",
						)}
					/>

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
						<div
							className={cn(
								"opacity-0 group-hover:opacity-100 transition-opacity",
								menuOpen && "opacity-100",
							)}
						>
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
								onOpenChange={setMenuOpen}
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
							<SessionItem
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
