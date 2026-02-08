"use client";

import { openEditSession, openHistoricalSession } from "@/components/coding-session";
import { SettingsSection } from "@/components/settings/settings-row";
import { Button } from "@/components/ui/button";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { SelectableItem } from "@/components/ui/selectable-item";
import {
	useAvailableRepos,
	useCreateRepo,
	useRebuildRepoSnapshot,
	useSearchRepos,
} from "@/hooks/use-repos";
import { orpc } from "@/lib/orpc";
import { cn, getSnapshotDisplayName } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { GitHubRepo, Repo, Snapshot } from "@/types";
import { useQuery } from "@tanstack/react-query";
import {
	Camera,
	ChevronDown,
	FolderGit2,
	GitBranch,
	Globe,
	Lock,
	Pencil,
	Plus,
	RefreshCw,
	Search,
	Star,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
		<div className="space-y-10">
			{/* Existing Repos */}
			<SettingsSection title="Connected Repositories">
				{reposList.length > 0 ? (
					<div className="space-y-2">
						{reposList.map((repo) => (
							<RepoCard
								key={repo.id}
								repo={repo}
								onCreateSnapshot={(repoId) => {
									setSelectedRepo(repoId);
									router.push(`/dashboard/sessions/new?repoId=${repoId}&type=setup`);
								}}
							/>
						))}
					</div>
				) : (
					<div className="rounded-lg border border-dashed border-border/80 bg-background py-8 text-center">
						<FolderGit2 className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
						<p className="text-sm text-muted-foreground">No repositories added yet</p>
						<p className="text-xs text-muted-foreground mt-1">
							Add a repository from GitHub to get started
						</p>
					</div>
				)}
			</SettingsSection>

			{/* Add Repository */}
			<SettingsSection title="Add Repository">
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
			</SettingsSection>
		</div>
	);
}

function RepoCard({
	repo,
	onCreateSnapshot,
}: {
	repo: Repo;
	onCreateSnapshot: (repoId: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const rebuildMutation = useRebuildRepoSnapshot();

	const handleRebuild = async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await rebuildMutation.mutateAsync({ id: repo.id });
			toast.success("Cache rebuild started");
		} catch {
			toast.error("Failed to start cache rebuild");
		}
	};

	const { data: snapshotsData, isLoading } = useQuery({
		...orpc.repos.listSnapshots.queryOptions({ input: { id: repo.id } }),
		enabled: expanded,
	});
	const snapshots = snapshotsData?.prebuilds;

	return (
		<div className="rounded-lg border border-border/80 bg-background overflow-hidden">
			<Button
				variant="ghost"
				onClick={() => setExpanded(!expanded)}
				className="w-full h-auto flex items-center gap-3 px-4 py-3 rounded-none hover:bg-muted/50 transition-colors text-left"
			>
				<div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
					<GitBranch className="h-4 w-4" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium truncate">{repo.githubRepoName}</p>
					<p className="text-xs text-muted-foreground">{repo.defaultBranch || "main"}</p>
				</div>
				<IconAction
					icon={<RefreshCw className="h-3.5 w-3.5" />}
					onClick={handleRebuild}
					tooltip="Rebuild cache"
					disabled={rebuildMutation.isPending || repo.repoSnapshotStatus === "building"}
				/>
				<span className="text-xs text-muted-foreground">
					{expanded ? "Hide" : "Show"} snapshots
				</span>
				<ChevronDown
					className={cn(
						"h-4 w-4 text-muted-foreground transition-transform",
						expanded && "rotate-180",
					)}
				/>
			</Button>

			{expanded && (
				<div className="border-t border-border/60 bg-muted/20 p-4">
					{isLoading ? (
						<div className="py-4 text-center">
							<LoadingDots size="sm" className="text-muted-foreground" />
						</div>
					) : snapshots && snapshots.length > 0 ? (
						<div className="space-y-2">
							{snapshots.map((snapshot) => {
								const setupSessionId = snapshot.setupSessions?.find(
									(s) => s.sessionType === "setup",
								)?.id;
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
								onClick={() => onCreateSnapshot(repo.id)}
							>
								<Plus className="h-3.5 w-3.5 mr-2" />
								Create New Snapshot
							</Button>
						</div>
					) : (
						<div className="text-center py-4">
							<p className="text-sm text-muted-foreground mb-3">No snapshots yet</p>
							<Button variant="outline" size="sm" onClick={() => onCreateSnapshot(repo.id)}>
								<Plus className="h-3.5 w-3.5 mr-2" />
								Create Snapshot
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
