"use client";

import { openEditSession, openSetupSession } from "@/components/coding-session";
import { HelpLink } from "@/components/help";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { IconAction } from "@/components/ui/icon-action";
import { GithubIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { SelectableItem } from "@/components/ui/selectable-item";
import { SelectorTrigger } from "@/components/ui/selector-trigger";
import { Text } from "@/components/ui/text";
import { useCreatePrebuild, usePrebuilds } from "@/hooks/use-prebuilds";
import { useAvailableRepos, useSearchRepos } from "@/hooks/use-repos";
import { useCreateSession } from "@/hooks/use-sessions";
import { orpc } from "@/lib/orpc";
import { cn, getSnapshotDisplayName } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { GitHubRepo, Snapshot } from "@/types";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Lock, Pencil, Plus, Search, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface SnapshotSelectorProps {
	/** "select" for choosing existing snapshot, "create" for making new one */
	mode?: "select" | "create";
	/** Controlled value - prebuild ID */
	value?: string | null;
	/** Callback when value changes (controlled mode) */
	onValueChange?: (prebuildId: string) => void;
	/** Callback when snapshot is created */
	onCreate?: (prebuildId: string, sessionId: string) => void;
	/** Optional class for the trigger button */
	triggerClassName?: string;
}

export function SnapshotSelector({
	mode = "select",
	value,
	onValueChange,
	onCreate,
	triggerClassName,
}: SnapshotSelectorProps) {
	const isControlled = value !== undefined;

	// State
	const [open, setOpen] = useState(false);
	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [snapshotSearchQuery, setSnapshotSearchQuery] = useState("");
	const snapshotSearchInputRef = useRef<HTMLInputElement>(null);

	// Dashboard store (for uncontrolled mode)
	const dashboardStore = useDashboardStore();
	const selectedSnapshotId = isControlled ? value : dashboardStore.selectedSnapshotId;

	const setSelectedSnapshot = (snapshotId: string | null) => {
		if (isControlled) {
			if (snapshotId) onValueChange?.(snapshotId);
		} else {
			dashboardStore.setSelectedSnapshot(snapshotId);
		}
	};

	// Focus search on open
	useEffect(() => {
		if (open && snapshotSearchInputRef.current) {
			setTimeout(() => snapshotSearchInputRef.current?.focus(), 0);
		}
		if (!open) {
			setSnapshotSearchQuery("");
		}
	}, [open]);

	// Fetch all ready prebuilds
	const { data: allPrebuildsData } = usePrebuilds();

	// Map prebuilds to snapshots
	const allSnapshots: Snapshot[] = (allPrebuildsData || []).map((prebuild) => ({
		id: prebuild.id,
		snapshotId: prebuild.snapshotId,
		name: prebuild.name || "Untitled snapshot",
		notes: prebuild.notes,
		createdAt: prebuild.createdAt || "",
		status: prebuild.status || "pending",
		setupSessions: prebuild.setupSessions?.map((s) => ({
			id: s.id,
			sessionType: s.sessionType || "setup",
		})),
		repos: (prebuild.prebuildRepos || [])
			.map((pr) => pr.repo)
			.filter((r) => r !== null)
			.map((r) => ({ id: r.id, githubRepoName: r.githubRepoName })),
	}));

	// Filter snapshots by search
	const filteredSnapshots = snapshotSearchQuery
		? allSnapshots.filter((s) => {
				const name = getSnapshotDisplayName(s).toLowerCase();
				const repoNames = (s.repos || []).map((r) => r.githubRepoName.toLowerCase()).join(" ");
				const query = snapshotSearchQuery.toLowerCase();
				return name.includes(query) || repoNames.includes(query);
			})
		: allSnapshots;

	// Find currently selected snapshot (for trigger display)
	const selectedSnapshot = allSnapshots.find((s) => s.id === selectedSnapshotId);
	const selectedSnapshotRepos = selectedSnapshot?.repos || [];

	// Handlers
	const handleSelectSnapshot = (snapshotId: string) => {
		setSelectedSnapshot(snapshotId);
		setOpen(false);
	};

	const handleCreateSuccess = (prebuildId: string, sessionId: string) => {
		setCreateModalOpen(false);
		onCreate?.(prebuildId, sessionId);
	};

	// Get trigger text
	const getTriggerText = () => {
		if (!selectedSnapshotId || !selectedSnapshot) {
			return "Select snapshot...";
		}
		const name = getSnapshotDisplayName(selectedSnapshot);
		const repoCount = selectedSnapshotRepos.length;
		return `${name}  ${repoCount} ${repoCount === 1 ? "repo" : "repos"}`;
	};

	// Get repo summary text for snapshot
	const getRepoSummary = (snapshotRepos: Array<{ githubRepoName: string }>) => {
		if (snapshotRepos.length === 0) return "";
		const firstName =
			snapshotRepos[0].githubRepoName.split("/").pop() || snapshotRepos[0].githubRepoName;
		if (snapshotRepos.length === 1) return firstName;
		return `${firstName} + ${snapshotRepos.length - 1} more`;
	};

	// Create mode renders content directly (parent owns the container chrome)
	if (mode === "create") {
		return <CreateSnapshotContent onCreate={handleCreateSuccess} />;
	}

	return (
		<>
			<Popover.Root open={open} onOpenChange={setOpen}>
				<Popover.Trigger asChild>
					<SelectorTrigger
						hasValue={!!selectedSnapshotId}
						placeholder="Select configuration..."
						className={triggerClassName}
					>
						{getTriggerText()}
					</SelectorTrigger>
				</Popover.Trigger>

				<Popover.Portal>
					<Popover.Content
						className={cn(
							"z-50 w-[320px] rounded-lg border border-border bg-popover shadow-lg",
							"animate-in fade-in-0 zoom-in-95",
							"data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
						)}
						sideOffset={8}
						align="start"
					>
						{/* Search */}
						<div className="px-3 pt-3 pb-2">
							<div className="relative">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									ref={snapshotSearchInputRef}
									type="text"
									value={snapshotSearchQuery}
									onChange={(e) => setSnapshotSearchQuery(e.target.value)}
									placeholder="Search snapshots..."
									className="pl-8 h-8 border-0 bg-muted/50 focus-visible:ring-1"
								/>
							</div>
						</div>

						{/* Snapshot list */}
						<div className="max-h-[280px] overflow-y-auto px-1 pb-2">
							{filteredSnapshots.length === 0 ? (
								<div className="py-8 text-center">
									<Text variant="small" color="muted">
										{snapshotSearchQuery
											? `No snapshots match "${snapshotSearchQuery}"`
											: "No snapshots yet"}
									</Text>
								</div>
							) : (
								filteredSnapshots.map((snapshot) => {
									const setupSessionId = snapshot.setupSessions?.find(
										(s) => s.sessionType === "setup",
									)?.id;
									return (
										<div
											key={snapshot.id}
											className={cn(
												"flex items-center gap-1 rounded transition-colors",
												selectedSnapshotId === snapshot.id ? "bg-accent" : "hover:bg-muted/50",
											)}
										>
											<SelectableItem
												selected={selectedSnapshotId === snapshot.id}
												onClick={() => handleSelectSnapshot(snapshot.id)}
												className="flex-1 py-1.5"
											>
												<div>
													<div className="truncate">{getSnapshotDisplayName(snapshot)}</div>
													<Text variant="small" color="muted" className="text-xs">
														{getRepoSummary(snapshot.repos || [])}
													</Text>
												</div>
											</SelectableItem>
											<IconAction
												icon={<Pencil className="h-3 w-3" />}
												onClick={(e) => {
													e.stopPropagation();
													if (setupSessionId && snapshot.snapshotId) {
														openEditSession({
															sessionId: setupSessionId,
															snapshotId: snapshot.id,
															snapshotName: getSnapshotDisplayName(snapshot),
															prebuildId: snapshot.id,
														});
													} else {
														openSetupSession(snapshot.id);
													}
												}}
												size="xs"
												tooltip="Edit environment"
											/>
										</div>
									);
								})
							)}
						</div>

						{/* Create new */}
						<div className="px-3 pb-3 pt-2 border-t border-border">
							<Button
								variant="outline"
								className="w-full justify-start gap-2"
								onClick={() => {
									setOpen(false);
									setCreateModalOpen(true);
								}}
							>
								<Plus className="h-4 w-4" />
								Create new configuration
							</Button>
						</div>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>

			<Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
				<DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
					<DialogHeader className="sr-only">
						<DialogTitle>Create new configuration</DialogTitle>
						<DialogDescription>
							Select repositories to include in your configuration
						</DialogDescription>
					</DialogHeader>
					<CreateSnapshotContent onCreate={handleCreateSuccess} />
				</DialogContent>
			</Dialog>
		</>
	);
}

// =============================================================================
// Create Snapshot Content (used in both modal and inline mode)
// =============================================================================

interface CreateSnapshotContentProps {
	onCreate?: (prebuildId: string, sessionId: string) => void;
}

function CreateSnapshotContent({ onCreate }: CreateSnapshotContentProps) {
	const [selectedRepoIds, setSelectedRepoIds] = useState<Set<string>>(new Set());
	const [searchQuery, setSearchQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [snapshotName, setSnapshotName] = useState("");
	const [addingRepoId, setAddingRepoId] = useState<number | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const queryClient = useQueryClient();
	const { selectedModel } = useDashboardStore();

	// Debounce search
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
		return () => clearTimeout(timer);
	}, [searchQuery]);

	// Auto-focus search on mount
	useEffect(() => {
		setTimeout(() => searchInputRef.current?.focus(), 100);
	}, []);

	// Fetch repos in DB
	const { data: reposResponse } = useQuery({
		...orpc.repos.list.queryOptions({ input: {} }),
	});
	const reposData = reposResponse?.repos;

	// Fetch available repos from GitHub
	const { data: availableData } = useAvailableRepos();

	// Search public repos
	const { data: publicSearchResults, isLoading: searchLoading } = useSearchRepos(
		debouncedQuery,
		debouncedQuery.length >= 2,
	);

	// Add repo mutation
	const addRepoMutation = useMutation({
		...orpc.repos.create.mutationOptions(),
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: orpc.repos.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.available.key() });
			const repoId = data.repo.id;
			if (repoId) {
				setSelectedRepoIds((prev) => new Set([...prev, repoId]));
			}
			setSearchQuery("");
		},
	});

	// Create snapshot mutation (uses oRPC hooks)
	const createPrebuild = useCreatePrebuild();
	const createSession = useCreateSession();

	const handleCreate = async () => {
		const repoIds = Array.from(selectedRepoIds);
		const prebuildResult = await createPrebuild.mutateAsync({
			repoIds,
			name: snapshotName || undefined,
		});
		const sessionResult = await createSession.mutateAsync({
			prebuildId: prebuildResult.prebuildId,
			sessionType: "setup",
			modelId: selectedModel,
		});
		onCreate?.(prebuildResult.prebuildId, sessionResult.sessionId);
		setSelectedRepoIds(new Set());
		setSnapshotName("");
	};

	const isCreating = createPrebuild.isPending || createSession.isPending;

	// Derived data
	const repos = Array.isArray(reposData) ? reposData : [];
	const availableRepos = availableData?.repositories || [];
	const existingRepoIds = new Set(repos.map((r) => r.githubRepoId));
	const newAvailableRepos = availableRepos.filter((r) => !existingRepoIds.has(String(r.id)));

	// Filter by search
	const filteredDbRepos = searchQuery
		? repos.filter((r) => r.githubRepoName.toLowerCase().includes(searchQuery.toLowerCase()))
		: repos;

	const filteredAvailableRepos = searchQuery
		? newAvailableRepos.filter((r) => r.full_name.toLowerCase().includes(searchQuery.toLowerCase()))
		: newAvailableRepos;

	const allKnownIds = new Set([
		...repos.map((r) => r.githubRepoId),
		...availableRepos.map((r) => String(r.id)),
	]);
	const filteredPublicRepos = (publicSearchResults || []).filter(
		(r) => !allKnownIds.has(String(r.id)),
	);

	// Handlers
	const toggleRepo = (repoId: string) => {
		setSelectedRepoIds((prev) => {
			const next = new Set(prev);
			if (next.has(repoId)) next.delete(repoId);
			else next.add(repoId);
			return next;
		});
	};

	const handleAddGitHubRepo = async (repo: GitHubRepo) => {
		setAddingRepoId(repo.id);
		try {
			await addRepoMutation.mutateAsync({
				githubRepoId: String(repo.id),
				githubRepoName: repo.full_name,
				githubUrl: repo.html_url,
				defaultBranch: repo.default_branch,
				integrationId: availableData?.integrationId,
				isPrivate: repo.private,
			});
		} finally {
			setAddingRepoId(null);
		}
	};

	const hasAnyResults =
		filteredDbRepos.length > 0 ||
		filteredAvailableRepos.length > 0 ||
		filteredPublicRepos.length > 0;

	return (
		<div className="w-full max-w-[300px]">
			{/* Header */}
			<div className="px-4 pt-4 pb-3 border-b border-border">
				<Text className="font-semibold">Create new configuration</Text>
				<Text variant="small" color="muted" className="mt-1">
					A configuration saves your cloud environment — installed dependencies, running services,
					and all. Sessions start from it instantly.
				</Text>
			</div>

			{/* Search input */}
			<div className="px-4 py-3">
				<div className="relative">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						ref={searchInputRef}
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search repositories..."
						className="pl-8 h-9 border-0 bg-muted/50 focus-visible:ring-1"
					/>
				</div>
			</div>

			{/* Repo list with checkboxes */}
			<div className="max-h-[240px] overflow-y-auto px-2">
				{filteredDbRepos.map((repo) => (
					<div
						key={repo.id}
						role="button"
						tabIndex={0}
						onClick={() => toggleRepo(repo.id)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								toggleRepo(repo.id);
							}
						}}
						className={cn(
							"w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors cursor-pointer",
							selectedRepoIds.has(repo.id) ? "bg-accent" : "hover:bg-muted/50",
						)}
					>
						<Checkbox
							checked={selectedRepoIds.has(repo.id)}
							onCheckedChange={() => toggleRepo(repo.id)}
							onClick={(e) => e.stopPropagation()}
							className="h-4 w-4"
						/>
						{repo.isPrivate ? (
							<Lock className="h-3.5 w-3.5 text-muted-foreground" />
						) : (
							<GithubIcon className="h-3.5 w-3.5" />
						)}
						<span className="flex-1 truncate">{repo.githubRepoName}</span>
					</div>
				))}

				{filteredAvailableRepos.length > 0 && (
					<>
						{filteredDbRepos.length > 0 && (
							<div className="px-3 py-1.5 text-xs text-muted-foreground font-medium">
								Available to add
							</div>
						)}
						{filteredAvailableRepos.map((repo) => (
							<SelectableItem
								key={repo.id}
								onClick={() => handleAddGitHubRepo(repo)}
								disabled={addingRepoId === repo.id}
								icon={
									repo.private ? (
										<Lock className="h-3.5 w-3.5" />
									) : (
										<GithubIcon className="h-3.5 w-3.5" />
									)
								}
								rightContent={addingRepoId === repo.id ? <LoadingDots size="sm" /> : null}
								className="py-2 mx-1"
							>
								<span className="truncate">{repo.full_name}</span>
							</SelectableItem>
						))}
					</>
				)}

				{debouncedQuery.length >= 2 &&
					(searchLoading ? (
						<div className="px-3 py-4 text-center">
							<LoadingDots size="sm" className="text-muted-foreground" />
						</div>
					) : filteredPublicRepos.length > 0 ? (
						<>
							<div className="px-3 py-1.5 text-xs text-muted-foreground font-medium border-t border-dashed mt-2 pt-2">
								Public repositories
							</div>
							{filteredPublicRepos.map((repo) => (
								<SelectableItem
									key={repo.id}
									onClick={() => handleAddGitHubRepo(repo)}
									disabled={addingRepoId === repo.id}
									icon={<Globe className="h-3.5 w-3.5" />}
									rightContent={addingRepoId === repo.id ? <LoadingDots size="sm" /> : null}
									className="py-2 mx-1"
								>
									<div>
										<div className="truncate">{repo.full_name}</div>
										{repo.stargazers_count !== undefined && (
											<div className="flex items-center gap-1 text-xs text-muted-foreground">
												<Star className="h-3 w-3" />
												{repo.stargazers_count.toLocaleString()}
												{repo.language && <span className="ml-2">{repo.language}</span>}
											</div>
										)}
									</div>
								</SelectableItem>
							))}
						</>
					) : null)}

				{!hasAnyResults && !searchLoading && debouncedQuery.length < 2 && (
					<Text variant="small" color="muted" className="px-3 py-6 text-center block">
						{repos.length === 0 ? "Type to search for repositories" : "No matching repositories"}
					</Text>
				)}
			</div>

			{/* Footer with name input and create button */}
			<div className="px-4 pb-4 pt-3 border-t border-border space-y-3">
				<div>
					<Text variant="small" color="muted" className="mb-1.5 block">
						Configuration name
					</Text>
					<Input
						type="text"
						value={snapshotName}
						onChange={(e) => setSnapshotName(e.target.value)}
						placeholder="e.g., Production setup"
						className="h-9 border-0 bg-muted/50 focus-visible:ring-1"
					/>
				</div>
				<div className="space-y-2">
					<Button
						className="w-full"
						onClick={handleCreate}
						disabled={selectedRepoIds.size === 0 || !snapshotName.trim() || isCreating}
					>
						{isCreating
							? "Creating..."
							: selectedRepoIds.size === 0
								? "Select repositories"
								: !snapshotName.trim()
									? "Enter a name"
									: `Create with ${selectedRepoIds.size} ${selectedRepoIds.size === 1 ? "repo" : "repos"}`}
					</Button>
					<HelpLink topic="snapshots" className="justify-center">
						What are snapshots?
					</HelpLink>
				</div>
			</div>
		</div>
	);
}
