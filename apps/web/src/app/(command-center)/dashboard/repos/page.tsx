"use client";

import { PageShell } from "@/components/dashboard/page-shell";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useCreateRepo, useDeleteRepo, useRepos, useSearchRepos } from "@/hooks/use-repos";
import { cn } from "@/lib/utils";
import type { GitHubRepo, Repo } from "@/types";
import { ExternalLink, MoreVertical, Plus, Search, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// ============================================
// Main Page
// ============================================

export default function RepositoriesPage() {
	const { data: repos, isLoading } = useRepos();
	const [filterQuery, setFilterQuery] = useState("");
	const [addDialogOpen, setAddDialogOpen] = useState(false);

	const reposList = useMemo(() => {
		const list = repos ?? [];
		if (!filterQuery) return list;
		const q = filterQuery.toLowerCase();
		return list.filter((r) => r.githubRepoName.toLowerCase().includes(q));
	}, [repos, filterQuery]);

	if (isLoading) {
		return (
			<PageShell title="Repositories">
				<div className="py-12 flex justify-center">
					<LoadingDots size="md" className="text-muted-foreground" />
				</div>
			</PageShell>
		);
	}

	const hasRepos = (repos ?? []).length > 0;
	const hasResults = reposList.length > 0;

	return (
		<PageShell
			title="Repositories"
			actions={
				<div className="flex items-center gap-2">
					{hasRepos && (
						<div className="relative">
							<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
							<Input
								value={filterQuery}
								onChange={(e) => setFilterQuery(e.target.value)}
								placeholder="Search repositories..."
								className="pl-8 h-8 w-56 text-sm"
							/>
						</div>
					)}
					<Button size="sm" className="h-8" onClick={() => setAddDialogOpen(true)}>
						<Plus className="h-3.5 w-3.5 mr-1.5" />
						Add Repository
					</Button>
				</div>
			}
		>
			{!hasRepos ? (
				<div className="rounded-xl border border-dashed border-border py-16 text-center">
					<p className="text-sm text-muted-foreground">No repositories yet</p>
					<p className="text-xs text-muted-foreground mt-1">
						Add a public repository or connect GitHub from Integrations
					</p>
					<div className="flex items-center justify-center gap-3 mt-4">
						<Button size="sm" onClick={() => setAddDialogOpen(true)}>
							<Plus className="h-3.5 w-3.5 mr-1.5" />
							Add Repository
						</Button>
						<Button variant="outline" size="sm" asChild>
							<Link href="/dashboard/integrations">Go to Integrations</Link>
						</Button>
					</div>
				</div>
			) : !hasResults ? (
				<p className="text-sm text-muted-foreground text-center py-12">
					No repositories matching &ldquo;{filterQuery}&rdquo;
				</p>
			) : (
				<div className="rounded-xl border border-border overflow-hidden">
					{/* Table header */}
					<div className="flex items-center px-4 py-2 pr-12 text-xs text-muted-foreground border-b border-border/50">
						<span className="flex-1 min-w-0">Name</span>
						<span className="w-24 text-center shrink-0">Branch</span>
						<span className="w-20 text-center shrink-0">GitHub</span>
					</div>

					{reposList.map((repo) => (
						<RepoRow key={repo.id} repo={repo} />
					))}
				</div>
			)}

			<AddRepoDialog
				open={addDialogOpen}
				onOpenChange={setAddDialogOpen}
				existingRepoIds={new Set((repos ?? []).map((r) => r.githubRepoId))}
			/>
		</PageShell>
	);
}

// ============================================
// Repo Row
// ============================================

function RepoRow({ repo }: { repo: Repo }) {
	const deleteRepo = useDeleteRepo();
	const [deleteOpen, setDeleteOpen] = useState(false);

	const handleDelete = async () => {
		await deleteRepo.mutateAsync({ id: repo.id });
		setDeleteOpen(false);
	};

	return (
		<>
			<div className="border-b border-border/50 last:border-0">
				<div className="flex items-center hover:bg-muted/50 transition-colors px-4 py-2.5 text-sm">
					<span className="flex-1 min-w-0 font-medium truncate">{repo.githubRepoName}</span>
					<span className="w-24 text-center text-xs text-muted-foreground shrink-0">
						{repo.defaultBranch || "main"}
					</span>
					<span className="w-20 flex justify-center shrink-0">
						<a
							href={repo.githubUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="text-muted-foreground hover:text-foreground transition-colors"
						>
							<ExternalLink className="h-3.5 w-3.5" />
						</a>
					</span>

					<div className="shrink-0 ml-2">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7">
									<MoreVertical className="h-3.5 w-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem asChild>
									<a href={repo.githubUrl} target="_blank" rel="noopener noreferrer">
										<ExternalLink className="h-4 w-4 mr-2" />
										Open on GitHub
									</a>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive">
									<Trash2 className="h-4 w-4 mr-2" />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</div>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete repository</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to remove {repo.githubRepoName}? This will not affect
							configurations that reference this repository.
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

// ============================================
// Add Repository Dialog
// ============================================

function AddRepoDialog({
	open,
	onOpenChange,
	existingRepoIds,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	existingRepoIds: Set<string>;
}) {
	const [searchQuery, setSearchQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [addingRepoId, setAddingRepoId] = useState<number | null>(null);
	const createRepo = useCreateRepo();

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
		return () => clearTimeout(timer);
	}, [searchQuery]);

	// Reset search when dialog closes
	useEffect(() => {
		if (!open) {
			setSearchQuery("");
			setDebouncedQuery("");
		}
	}, [open]);

	const { data: searchResults, isLoading: searchLoading } = useSearchRepos(
		debouncedQuery,
		debouncedQuery.length >= 2,
	);

	const handleAddRepo = async (repo: GitHubRepo) => {
		setAddingRepoId(repo.id);
		try {
			await createRepo.mutateAsync({
				githubRepoId: String(repo.id),
				githubRepoName: repo.full_name,
				githubUrl: repo.html_url,
				defaultBranch: repo.default_branch,
			});
			onOpenChange(false);
		} catch {
			// Error is surfaced by TanStack Query's mutation state
		} finally {
			setAddingRepoId(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add Repository</DialogTitle>
				</DialogHeader>

				<div className="space-y-4">
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search public repos (e.g., vercel/next.js)"
							className="pl-9 h-9 text-sm"
							autoFocus
						/>
					</div>

					<div className="max-h-72 overflow-y-auto">
						{searchLoading ? (
							<div className="py-8 flex justify-center">
								<LoadingDots size="sm" className="text-muted-foreground" />
							</div>
						) : searchResults && searchResults.length > 0 ? (
							<div className="space-y-0.5">
								{searchResults.map((repo) => {
									const isConnected = existingRepoIds.has(String(repo.id));

									return (
										<div
											key={repo.id}
											className={cn(
												"flex items-center justify-between py-2 px-2 rounded-md transition-colors",
												isConnected ? "opacity-50" : "hover:bg-muted/50",
											)}
										>
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
											{isConnected ? (
												<span className="text-xs text-muted-foreground shrink-0 ml-3">
													Connected
												</span>
											) : (
												<Button
													variant="outline"
													size="sm"
													className="h-7 text-xs shrink-0 ml-3"
													onClick={() => handleAddRepo(repo)}
													disabled={addingRepoId === repo.id}
												>
													{addingRepoId === repo.id ? "..." : "Add"}
												</Button>
											)}
										</div>
									);
								})}
							</div>
						) : debouncedQuery.length >= 2 ? (
							<p className="text-sm text-muted-foreground text-center py-8">
								No public repositories found
							</p>
						) : (
							<p className="text-sm text-muted-foreground text-center py-8">
								Enter at least 2 characters to search
							</p>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
