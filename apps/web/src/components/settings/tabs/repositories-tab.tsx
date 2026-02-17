"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { Text } from "@/components/ui/text";
import { useAvailableRepos, useCreateRepo, useSearchRepos } from "@/hooks/use-repos";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type { GitHubRepo, Repo } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FolderGit2, GitBranch, Globe, Lock, Plus, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";

interface RepositoriesTabProps {
	onClose: () => void;
}

export function RepositoriesTab({ onClose }: RepositoriesTabProps) {
	const [showAvailable, setShowAvailable] = useState(false);
	const [showPublicSearch, setShowPublicSearch] = useState(false);
	const [addingRepoId, setAddingRepoId] = useState<number | null>(null);
	const [publicSearchQuery, setPublicSearchQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");

	// Debounce the search query
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

	if (isLoading) {
		return (
			<div className="py-8 text-center">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	const reposList = Array.isArray(repos) ? repos : [];
	const existingRepoIds = new Set(reposList.map((r) => r.githubRepoId));

	return (
		<div className="space-y-4">
			<div className="mb-4">
				<Text variant="h4" className="text-lg">
					Repositories
				</Text>
				<Text variant="body" color="muted" className="text-sm">
					Manage your connected repositories and snapshots.
				</Text>
			</div>

			{/* Existing repos */}
			{reposList.length > 0 ? (
				<div className="space-y-3">
					{reposList.map((repo) => (
						<RepoCard key={repo.id} repo={repo} />
					))}
				</div>
			) : (
				<div className="py-6 text-center text-muted-foreground border border-dashed border-border rounded-lg">
					<FolderGit2 className="h-8 w-8 mx-auto mb-3 opacity-50" />
					<Text variant="small" color="muted">
						No repositories added yet
					</Text>
					<Text variant="small" color="muted" className="text-xs mt-1">
						Add a repository from GitHub to get started
					</Text>
				</div>
			)}

			{/* Add from connected repos section */}
			<div className="border border-border rounded-lg overflow-hidden">
				<Button
					variant="ghost"
					onClick={() => setShowAvailable(!showAvailable)}
					className="w-full flex items-center justify-between p-3 h-auto hover:bg-muted/50"
				>
					<div className="flex items-center gap-2">
						<Lock className="h-4 w-4" />
						<Text variant="small" className="font-medium">
							Add from Connected Repos
						</Text>
					</div>
					<ChevronDown
						className={cn(
							"h-4 w-4 text-muted-foreground transition-transform",
							showAvailable && "rotate-180",
						)}
					/>
				</Button>

				{showAvailable && (
					<div className="border-t border-border bg-muted/20 p-3">
						{availableLoading ? (
							<div className="py-4 text-center">
								<LoadingDots size="sm" className="text-muted-foreground" />
							</div>
						) : availableRepos && availableRepos.length > 0 ? (
							<div className="space-y-2 max-h-48 overflow-y-auto">
								{availableRepos.map((repo) => (
									<div
										key={repo.id}
										className="flex items-center justify-between p-2 rounded-md hover:bg-background transition-colors"
									>
										<div className="flex items-center gap-2 min-w-0 flex-1">
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
											className="ml-2 flex-shrink-0"
											onClick={() => handleAddRepo(repo)}
											disabled={addingRepoId === repo.id}
										>
											{addingRepoId === repo.id ? "Adding..." : "Add"}
										</Button>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-4">
								No additional repositories available. Connect more repos via GitHub App settings.
							</p>
						)}
					</div>
				)}
			</div>

			{/* Search public repos section */}
			<div className="border border-border rounded-lg overflow-hidden">
				<Button
					variant="ghost"
					onClick={() => setShowPublicSearch(!showPublicSearch)}
					className="w-full flex items-center justify-between p-3 h-auto hover:bg-muted/50"
				>
					<div className="flex items-center gap-2">
						<Globe className="h-4 w-4" />
						<Text variant="small" className="font-medium">
							Add Public Repository
						</Text>
					</div>
					<ChevronDown
						className={cn(
							"h-4 w-4 text-muted-foreground transition-transform",
							showPublicSearch && "rotate-180",
						)}
					/>
				</Button>

				{showPublicSearch && (
					<div className="border-t border-border bg-muted/20 p-3 space-y-3">
						<div className="relative">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
							<Input
								value={publicSearchQuery}
								onChange={(e) => setPublicSearchQuery(e.target.value)}
								placeholder="Search repos (e.g., vercel/next.js)"
								className="pl-9"
								autoFocus
							/>
						</div>

						{searchLoading ? (
							<div className="py-4 text-center">
								<LoadingDots size="sm" className="text-muted-foreground" />
							</div>
						) : searchResults && searchResults.length > 0 ? (
							<div className="space-y-2 max-h-64 overflow-y-auto">
								{searchResults
									.filter((repo) => !existingRepoIds.has(String(repo.id)))
									.map((repo) => (
										<div
											key={repo.id}
											className="flex items-center justify-between p-2 rounded-md hover:bg-background transition-colors"
										>
											<div className="flex items-center gap-2 min-w-0 flex-1">
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
												className="ml-2 flex-shrink-0"
												onClick={() => handleAddRepo(repo, true)}
												disabled={addingRepoId === repo.id}
											>
												{addingRepoId === repo.id ? "Adding..." : "Add"}
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
	);
}

function RepoCard({ repo }: { repo: Repo }) {
	return (
		<div className="border border-border rounded-lg overflow-hidden">
			<div className="flex items-center gap-3 p-4">
				<div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
					<GitBranch className="h-5 w-5" />
				</div>
				<div className="flex-1 min-w-0 text-left">
					<p className="font-medium truncate">{repo.githubRepoName}</p>
					<p className="text-sm text-muted-foreground">{repo.defaultBranch || "main"}</p>
				</div>
			</div>
		</div>
	);
}
