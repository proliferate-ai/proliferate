"use client";

import { openEditSession, openHistoricalSession } from "@/components/coding-session";
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
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { SelectableItem } from "@/components/ui/selectable-item";
import {
	useAvailableRepos,
	useCreateRepo,
	useDeleteRepo,
	useSearchRepos,
	useServiceCommands,
	useUpdateServiceCommands,
} from "@/hooks/use-repos";
import { orpc } from "@/lib/orpc";
import { cn, getSnapshotDisplayName } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { GitHubRepo, Repo } from "@/types";
import { useQuery } from "@tanstack/react-query";
import {
	Camera,
	Check,
	ChevronDown,
	FolderGit2,
	GitBranch,
	Globe,
	Lock,
	MoreVertical,
	Pencil,
	Play,
	Plus,
	Search,
	Settings2,
	Star,
	Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function RepositoriesPage() {
	const router = useRouter();
	const { setSelectedRepo } = useDashboardStore();
	const [showAvailable, setShowAvailable] = useState(false);
	const [showPublicSearch, setShowPublicSearch] = useState(false);
	const [addingRepoId, setAddingRepoId] = useState<number | null>(null);
	const [publicSearchQuery, setPublicSearchQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");

	// Debounce search query
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(publicSearchQuery);
		}, 300);
		return () => clearTimeout(timer);
	}, [publicSearchQuery]);

	const { data: reposData, isLoading } = useQuery({
		...orpc.repos.list.queryOptions({ input: {} }),
	});
	const repos = reposData?.repos;

	const { data: availableData, isLoading: availableLoading } = useAvailableRepos();
	const availableRepos = showAvailable ? availableData?.repositories : undefined;

	const { data: searchResults, isLoading: searchLoading } = useSearchRepos(
		debouncedQuery,
		debouncedQuery.length >= 2,
	);

	const createRepo = useCreateRepo();

	const handleAddRepo = async (repo: GitHubRepo, isPublic = false) => {
		setAddingRepoId(repo.id);
		try {
			await createRepo.mutateAsync({
				githubRepoId: String(repo.id),
				githubRepoName: repo.full_name,
				githubUrl: repo.html_url,
				defaultBranch: repo.default_branch,
			});
			if (isPublic) {
				setPublicSearchQuery("");
				setShowPublicSearch(false);
			}
		} catch (err) {
			console.error("Failed to add repo:", err);
		} finally {
			setAddingRepoId(null);
		}
	};

	const handleConfigure = (repoId: string) => {
		setSelectedRepo(repoId);
		router.push(`/dashboard/sessions/new?repoId=${repoId}&type=setup`);
	};

	const reposList = Array.isArray(repos) ? repos : [];
	const existingRepoIds = new Set(reposList.map((r) => r.githubRepoId));

	if (isLoading) {
		return (
			<div className="py-8 text-center">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-3xl px-6 py-6 space-y-8">
			<div className="flex items-center justify-between">
				<h1 className="text-lg font-semibold">Repositories</h1>
			</div>

			{/* Repository List */}
			{reposList.length > 0 ? (
				<div className="space-y-2">
					{reposList.map((repo) => (
						<RepoRow key={repo.id} repo={repo} onConfigure={handleConfigure} />
					))}
				</div>
			) : (
				<div className="rounded-lg border border-dashed border-border/80 bg-background py-12 text-center">
					<FolderGit2 className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">No repositories added yet</p>
					<p className="text-xs text-muted-foreground mt-1">
						Add a repository from GitHub to get started
					</p>
				</div>
			)}

			{/* Add Repository */}
			<div className="space-y-2">
				<h2 className="text-sm font-medium">Add Repository</h2>
				<div className="rounded-lg border border-border/80 bg-background overflow-hidden">
					<Button
						variant="ghost"
						onClick={() => setShowAvailable(!showAvailable)}
						className="w-full h-auto flex items-center justify-between px-4 py-3 rounded-none hover:bg-muted/50 transition-colors"
					>
						<div className="flex items-center gap-2">
							<Lock className="h-4 w-4 text-muted-foreground" />
							<span className="text-sm font-medium">From Connected Repos</span>
						</div>
						<ChevronDown
							className={cn(
								"h-4 w-4 text-muted-foreground transition-transform",
								showAvailable && "rotate-180",
							)}
						/>
					</Button>

					{showAvailable && (
						<div className="border-t border-border/60 bg-muted/20 p-4">
							{availableLoading ? (
								<div className="py-4 text-center">
									<LoadingDots size="sm" className="text-muted-foreground" />
								</div>
							) : availableRepos && availableRepos.length > 0 ? (
								<div className="space-y-1 max-h-64 overflow-y-auto">
									{availableRepos.map((repo) => (
										<div
											key={repo.id}
											className="flex items-center justify-between p-2 rounded-md hover:bg-background transition-colors"
										>
											<div className="flex items-center gap-3 min-w-0 flex-1">
												<GitBranch className="h-4 w-4 text-muted-foreground flex-shrink-0" />
												<div className="min-w-0 flex-1">
													<p className="text-sm font-medium truncate">{repo.full_name}</p>
													<p className="text-xs text-muted-foreground">{repo.default_branch}</p>
												</div>
												{repo.private && (
													<Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
												)}
											</div>
											<Button
												variant="outline"
												size="sm"
												className="ml-2 flex-shrink-0 h-7 text-xs"
												onClick={() => handleAddRepo(repo)}
												disabled={addingRepoId === repo.id}
											>
												{addingRepoId === repo.id ? "..." : "Add"}
											</Button>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground text-center py-4">
									No additional repositories available
								</p>
							)}
						</div>
					)}
				</div>

				<div className="rounded-lg border border-border/80 bg-background overflow-hidden">
					<Button
						variant="ghost"
						onClick={() => setShowPublicSearch(!showPublicSearch)}
						className="w-full h-auto flex items-center justify-between px-4 py-3 rounded-none hover:bg-muted/50 transition-colors"
					>
						<div className="flex items-center gap-2">
							<Globe className="h-4 w-4 text-muted-foreground" />
							<span className="text-sm font-medium">Public Repository</span>
						</div>
						<ChevronDown
							className={cn(
								"h-4 w-4 text-muted-foreground transition-transform",
								showPublicSearch && "rotate-180",
							)}
						/>
					</Button>

					{showPublicSearch && (
						<div className="border-t border-border/60 bg-muted/20 p-4 space-y-4">
							<div className="relative">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									value={publicSearchQuery}
									onChange={(e) => setPublicSearchQuery(e.target.value)}
									placeholder="Search repos (e.g., vercel/next.js)"
									className="pl-9 h-8 text-sm"
									autoFocus
								/>
							</div>

							{searchLoading ? (
								<div className="py-4 text-center">
									<LoadingDots size="sm" className="text-muted-foreground" />
								</div>
							) : searchResults && searchResults.length > 0 ? (
								<div className="space-y-1 max-h-64 overflow-y-auto">
									{searchResults
										.filter((repo) => !existingRepoIds.has(String(repo.id)))
										.map((repo) => (
											<div
												key={repo.id}
												className="flex items-center justify-between p-2 rounded-md hover:bg-background transition-colors"
											>
												<div className="flex items-center gap-3 min-w-0 flex-1">
													<Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
													<div className="min-w-0 flex-1">
														<p className="text-sm font-medium truncate">{repo.full_name}</p>
														<div className="flex items-center gap-2 text-xs text-muted-foreground">
															{repo.stargazers_count !== undefined && (
																<span className="flex items-center gap-0.5">
																	<Star className="h-3 w-3" />
																	{repo.stargazers_count.toLocaleString()}
																</span>
															)}
															{repo.language && <span>{repo.language}</span>}
															<span>{repo.default_branch}</span>
														</div>
													</div>
												</div>
												<Button
													variant="outline"
													size="sm"
													className="ml-2 flex-shrink-0 h-7 text-xs"
													onClick={() => handleAddRepo(repo, true)}
													disabled={addingRepoId === repo.id}
												>
													{addingRepoId === repo.id ? "..." : "Add"}
												</Button>
											</div>
										))}
									{searchResults.filter((repo) => !existingRepoIds.has(String(repo.id))).length ===
										0 && (
										<p className="text-sm text-muted-foreground text-center py-2">
											All matching repos already added
										</p>
									)}
								</div>
							) : debouncedQuery.length >= 2 ? (
								<p className="text-sm text-muted-foreground text-center py-4">
									No public repositories found
								</p>
							) : (
								<p className="text-sm text-muted-foreground text-center py-4">
									Enter at least 2 characters to search
								</p>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function RepoRow({
	repo,
	onConfigure,
}: {
	repo: Repo;
	onConfigure: (repoId: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [tab, setTab] = useState<"snapshots" | "defaults">("snapshots");
	const [deleteOpen, setDeleteOpen] = useState(false);
	const deleteRepo = useDeleteRepo();

	const { data: snapshotsData, isLoading: snapshotsLoading } = useQuery({
		...orpc.repos.listSnapshots.queryOptions({ input: { id: repo.id } }),
		enabled: expanded && tab === "snapshots",
	});
	const snapshots = snapshotsData?.prebuilds;

	const handleDelete = async () => {
		await deleteRepo.mutateAsync({ id: repo.id });
		setDeleteOpen(false);
	};

	return (
		<>
			<div className="rounded-lg border border-border/80 bg-background overflow-hidden">
				<div className="flex items-center gap-3 px-4 py-3">
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
					>
						<div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
							<GitBranch className="h-4 w-4" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<p className="text-sm font-medium truncate">{repo.githubRepoName}</p>
								{repo.isConfigured && (
									<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex-shrink-0">
										<Check className="h-2.5 w-2.5" />
										Configured
									</span>
								)}
								{repo.prebuildStatus === "ready" && (
									<span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 flex-shrink-0">
										Ready
									</span>
								)}
							</div>
							<p className="text-xs text-muted-foreground">{repo.defaultBranch || "main"}</p>
						</div>
						<ChevronDown
							className={cn(
								"h-4 w-4 text-muted-foreground transition-transform flex-shrink-0",
								expanded && "rotate-180",
							)}
						/>
					</button>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
								<MoreVertical className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => onConfigure(repo.id)}>
								<Settings2 className="h-4 w-4 mr-2" />
								Configure
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => {
									setExpanded(true);
									setTab("defaults");
								}}
							>
								<Pencil className="h-4 w-4 mr-2" />
								Edit defaults
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive">
								<Trash2 className="h-4 w-4 mr-2" />
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				{expanded && (
					<div className="border-t border-border/60">
						<div className="flex border-b border-border/60">
							<button
								type="button"
								onClick={() => setTab("snapshots")}
								className={cn(
									"flex-1 px-4 py-2 text-xs font-medium transition-colors",
									tab === "snapshots"
										? "text-foreground border-b-2 border-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								Snapshots
							</button>
							<button
								type="button"
								onClick={() => setTab("defaults")}
								className={cn(
									"flex-1 px-4 py-2 text-xs font-medium transition-colors",
									tab === "defaults"
										? "text-foreground border-b-2 border-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								Default Auto-start
							</button>
						</div>

						<div className="bg-muted/20 p-4">
							{tab === "snapshots" ? (
								<SnapshotsTab
									snapshots={snapshots}
									isLoading={snapshotsLoading}
									repoId={repo.id}
									onCreateSnapshot={onConfigure}
								/>
							) : (
								<ServiceCommandsTab repoId={repo.id} />
							)}
						</div>
					</div>
				)}
			</div>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete repository</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to remove {repo.githubRepoName}? This will delete all associated
							configurations and snapshots.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteRepo.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function SnapshotsTab({
	snapshots,
	isLoading,
	repoId,
	onCreateSnapshot,
}: {
	snapshots:
		| Array<{
				id: string;
				name: string | null;
				notes: string | null;
				createdAt: string;
				setupSessions?: Array<{ id: string; sessionType: string | null }>;
		  }>
		| undefined;
	isLoading: boolean;
	repoId: string;
	onCreateSnapshot: (repoId: string) => void;
}) {
	if (isLoading) {
		return (
			<div className="py-4 text-center">
				<LoadingDots size="sm" className="text-muted-foreground" />
			</div>
		);
	}

	if (snapshots && snapshots.length > 0) {
		return (
			<div className="space-y-2">
				{snapshots.map((snapshot) => {
					const setupSessionId = snapshot.setupSessions?.find((s) => s.sessionType === "setup")?.id;
					return (
						<div
							key={snapshot.id}
							className="group flex items-center gap-1 rounded-lg hover:bg-background transition-colors"
						>
							<SelectableItem
								onClick={() => {
									if (setupSessionId) {
										openHistoricalSession(setupSessionId, getSnapshotDisplayName(snapshot));
									}
								}}
								icon={<Camera className="h-4 w-4" />}
								className="flex-1 p-3"
							>
								<span className="truncate">{getSnapshotDisplayName(snapshot)}</span>
							</SelectableItem>
							{setupSessionId && (
								<IconAction
									icon={<Pencil className="h-3.5 w-3.5" />}
									onClick={(e) => {
										e.stopPropagation();
										openEditSession({
											sessionId: setupSessionId,
											snapshotId: snapshot.id,
											snapshotName: getSnapshotDisplayName(snapshot),
											prebuildId: snapshot.id,
										});
									}}
									tooltip="Edit environment"
									className="opacity-0 group-hover:opacity-100 mr-1"
								/>
							)}
						</div>
					);
				})}
				<Button
					variant="outline"
					size="sm"
					className="w-full mt-2"
					onClick={() => onCreateSnapshot(repoId)}
				>
					<Plus className="h-3.5 w-3.5 mr-2" />
					Create New Snapshot
				</Button>
			</div>
		);
	}

	return (
		<div className="text-center py-4">
			<p className="text-sm text-muted-foreground mb-3">No snapshots yet</p>
			<Button variant="outline" size="sm" onClick={() => onCreateSnapshot(repoId)}>
				<Plus className="h-3.5 w-3.5 mr-2" />
				Create Snapshot
			</Button>
		</div>
	);
}

interface CommandDraft {
	name: string;
	command: string;
	cwd: string;
}

function ServiceCommandsTab({ repoId }: { repoId: string }) {
	const { data: commands, isLoading } = useServiceCommands(repoId);
	const updateCommands = useUpdateServiceCommands();
	const [editing, setEditing] = useState(false);
	const [drafts, setDrafts] = useState<CommandDraft[]>([]);

	const startEditing = () => {
		setDrafts(
			commands?.length
				? commands.map((c) => ({ name: c.name, command: c.command, cwd: c.cwd || "" }))
				: [{ name: "", command: "", cwd: "" }],
		);
		setEditing(true);
	};

	const handleSave = async () => {
		const valid = drafts.filter((d) => d.name.trim() && d.command.trim());
		await updateCommands.mutateAsync({
			id: repoId,
			commands: valid.map((d) => ({
				name: d.name.trim(),
				command: d.command.trim(),
				...(d.cwd.trim() ? { cwd: d.cwd.trim() } : {}),
			})),
		});
		setEditing(false);
	};

	const addRow = () => {
		if (drafts.length >= 10) return;
		setDrafts([...drafts, { name: "", command: "", cwd: "" }]);
	};

	const removeRow = (index: number) => {
		setDrafts(drafts.filter((_, i) => i !== index));
	};

	const updateDraft = (index: number, field: keyof CommandDraft, value: string) => {
		setDrafts(drafts.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
	};

	if (isLoading) {
		return (
			<div className="py-4 text-center">
				<LoadingDots size="sm" className="text-muted-foreground" />
			</div>
		);
	}

	if (editing) {
		return (
			<div className="space-y-3">
				<p className="text-xs text-muted-foreground">
					Default auto-start commands (repo defaults). These run automatically when a session starts
					with a prebuild snapshot.
				</p>
				{drafts.map((draft, index) => (
					<div key={index} className="flex items-start gap-2">
						<div className="flex-1 space-y-1.5">
							<Input
								value={draft.name}
								onChange={(e) => updateDraft(index, "name", e.target.value)}
								placeholder="Name (e.g. dev-server)"
								className="h-7 text-xs"
							/>
							<Input
								value={draft.command}
								onChange={(e) => updateDraft(index, "command", e.target.value)}
								placeholder="Command (e.g. pnpm dev)"
								className="h-7 text-xs font-mono"
							/>
							<Input
								value={draft.cwd}
								onChange={(e) => updateDraft(index, "cwd", e.target.value)}
								placeholder="Working directory (optional, relative)"
								className="h-7 text-xs"
							/>
						</div>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
							onClick={() => removeRow(index)}
						>
							<Trash2 className="h-3.5 w-3.5" />
						</Button>
					</div>
				))}
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-xs"
						onClick={addRow}
						disabled={drafts.length >= 10}
					>
						<Plus className="h-3 w-3 mr-1" />
						Add command
					</Button>
					<div className="flex-1" />
					<Button
						variant="ghost"
						size="sm"
						className="h-7 text-xs"
						onClick={() => setEditing(false)}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						className="h-7 text-xs"
						onClick={handleSave}
						disabled={updateCommands.isPending}
					>
						{updateCommands.isPending ? "Saving..." : "Save"}
					</Button>
				</div>
			</div>
		);
	}

	if (commands && commands.length > 0) {
		return (
			<div className="space-y-2">
				{commands.map((cmd, index) => (
					<div
						key={index}
						className="flex items-center gap-3 p-2 rounded-md bg-background border border-border/60"
					>
						<Play className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
						<div className="flex-1 min-w-0">
							<p className="text-xs font-medium truncate">{cmd.name}</p>
							<p className="text-xs text-muted-foreground font-mono truncate">{cmd.command}</p>
							{cmd.cwd && (
								<p className="text-[10px] text-muted-foreground truncate">cwd: {cmd.cwd}</p>
							)}
						</div>
					</div>
				))}
				<Button variant="outline" size="sm" className="w-full mt-1" onClick={startEditing}>
					<Pencil className="h-3 w-3 mr-2" />
					Edit commands
				</Button>
			</div>
		);
	}

	return (
		<div className="text-center py-4">
			<Play className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
			<p className="text-sm text-muted-foreground mb-1">No auto-start commands</p>
			<p className="text-xs text-muted-foreground mb-3">
				Add commands to auto-run when sessions start
			</p>
			<Button variant="outline" size="sm" onClick={startEditing}>
				<Plus className="h-3.5 w-3.5 mr-2" />
				Add commands
			</Button>
		</div>
	);
}
