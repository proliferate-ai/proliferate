"use client";

import { GithubIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { SelectableItem, SelectableItemText } from "@/components/ui/selectable-item";
import { SelectorTrigger } from "@/components/ui/selector-trigger";
import { Text } from "@/components/ui/text";
import { useAvailableRepos, useSearchRepos } from "@/hooks/use-repos";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type { GitHubRepo } from "@/types";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Globe, Lock, Search, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface RepoSelectorProps {
	value?: string | null;
	onValueChange: (repoId: string) => void;
	className?: string;
	triggerClassName?: string;
	placeholder?: string;
}

export function RepoSelector({
	value,
	onValueChange,
	className,
	triggerClassName,
	placeholder = "Select repo",
}: RepoSelectorProps) {
	const [open, setOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [addingRepoId, setAddingRepoId] = useState<number | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const queryClient = useQueryClient();

	// Debounce search query
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(searchQuery);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchQuery]);

	// Focus search input when popover opens
	useEffect(() => {
		if (open && searchInputRef.current) {
			setTimeout(() => searchInputRef.current?.focus(), 0);
		}
		if (!open) {
			setSearchQuery("");
			setDebouncedQuery("");
		}
	}, [open]);

	// Fetch repos already in DB
	const { data: reposResponse } = useQuery({
		...orpc.repos.list.queryOptions({ input: {} }),
	});
	const reposData = reposResponse?.repos;

	// Fetch available repos from connected GitHub accounts
	const { data: availableData } = useAvailableRepos();

	// Search public repos when query is entered
	const { data: publicSearchResults, isLoading: searchLoading } = useSearchRepos(
		debouncedQuery,
		debouncedQuery.length >= 2,
	);

	// Mutation to add a repo to DB
	const addRepoMutation = useMutation({
		...orpc.repos.create.mutationOptions(),
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: orpc.repos.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.available.key() });
			if (data.repo.id) {
				onValueChange(data.repo.id);
			}
			setOpen(false);
			setSearchQuery("");
		},
	});

	// Ensure repos is always an array
	const repos = Array.isArray(reposData) ? reposData : [];
	const availableRepos = availableData?.repositories || [];

	// Create a set of repo IDs already in DB
	const existingRepoIds = new Set(repos.map((r) => r.githubRepoId));

	// Available repos that aren't in DB yet
	const newAvailableRepos = availableRepos.filter((r) => !existingRepoIds.has(String(r.id)));

	// Filter repos by search query
	const filteredDbRepos = searchQuery
		? repos.filter((r) => r.githubRepoName.toLowerCase().includes(searchQuery.toLowerCase()))
		: repos;

	const filteredAvailableRepos = searchQuery
		? newAvailableRepos.filter((r) => r.full_name.toLowerCase().includes(searchQuery.toLowerCase()))
		: newAvailableRepos;

	// Public search results (exclude repos already in DB or available)
	const allKnownIds = new Set([
		...repos.map((r) => r.githubRepoId),
		...availableRepos.map((r) => String(r.id)),
	]);
	const filteredPublicRepos = (publicSearchResults || []).filter(
		(r) => !allKnownIds.has(String(r.id)),
	);

	const selectedRepo = repos.find((r) => r.id === value);

	const handleSelectDbRepo = (repoId: string) => {
		onValueChange(repoId);
		setOpen(false);
		setSearchQuery("");
	};

	const handleSelectGitHubRepo = async (repo: GitHubRepo) => {
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

	const getRepoIcon = (repo: { is_private?: boolean; private?: boolean; source?: string }) => {
		if (repo.is_private || repo.private) {
			return <Lock className="h-4 w-4" />;
		}
		if (repo.source === "github" || !repo.source) {
			return <GithubIcon className="h-4 w-4" />;
		}
		return <Globe className="h-4 w-4" />;
	};

	return (
		<div className={className}>
			<Popover.Root open={open} onOpenChange={setOpen}>
				<Popover.Trigger asChild>
					<SelectorTrigger
						icon={<GithubIcon className="h-4 w-4" />}
						hasValue={!!selectedRepo}
						placeholder={placeholder}
						className={triggerClassName}
					>
						{selectedRepo?.githubRepoName || placeholder}
					</SelectorTrigger>
				</Popover.Trigger>

				<Popover.Portal>
					<Popover.Content
						className={cn(
							"z-50 w-[320px] rounded-lg border border-border bg-popover shadow-lg",
							"animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
							"data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
						)}
						sideOffset={8}
						align="start"
					>
						{/* Search Input */}
						<div className="p-2 border-b border-border">
							<div className="relative">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									ref={searchInputRef}
									type="text"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder="Search repos..."
									className="w-full pl-8 pr-3 py-1.5 text-sm"
								/>
							</div>
						</div>

						<div className="max-h-[300px] overflow-y-auto p-1">
							{/* DB Repos (already added) */}
							{filteredDbRepos.length > 0 && (
								<div>
									{filteredDbRepos.map((repo) => (
										<SelectableItem
											key={repo.id}
											selected={value === repo.id}
											onClick={() => handleSelectDbRepo(repo.id)}
											icon={getRepoIcon(repo)}
											rightContent={
												value === repo.id ? <Check className="h-4 w-4 text-primary" /> : null
											}
										>
											<SelectableItemText>{repo.githubRepoName}</SelectableItemText>
										</SelectableItem>
									))}
								</div>
							)}

							{/* Available repos from GitHub connections (not in DB yet) */}
							{filteredAvailableRepos.length > 0 && (
								<div>
									{filteredDbRepos.length > 0 && (
										<div className="px-3 py-1.5 text-xs text-muted-foreground font-medium">
											From connected accounts
										</div>
									)}
									{filteredAvailableRepos.map((repo) => (
										<SelectableItem
											key={repo.id}
											onClick={() => handleSelectGitHubRepo(repo)}
											disabled={addingRepoId === repo.id}
											icon={getRepoIcon(repo)}
											rightContent={addingRepoId === repo.id ? <LoadingDots size="sm" /> : null}
										>
											<SelectableItemText>{repo.full_name}</SelectableItemText>
										</SelectableItem>
									))}
								</div>
							)}

							{/* Public search results (only when searching) */}
							{debouncedQuery.length >= 2 &&
								(searchLoading ? (
									<div className="px-3 py-4 text-center">
										<LoadingDots size="sm" className="text-muted-foreground" />
									</div>
								) : filteredPublicRepos.length > 0 ? (
									<div>
										<div className="px-3 py-1.5 text-xs text-muted-foreground font-medium border-t border-border mt-1 pt-2">
											Public repositories
										</div>
										{filteredPublicRepos.map((repo) => (
											<SelectableItem
												key={repo.id}
												onClick={() => handleSelectGitHubRepo(repo)}
												disabled={addingRepoId === repo.id}
												icon={<Globe className="h-4 w-4" />}
												rightContent={addingRepoId === repo.id ? <LoadingDots size="sm" /> : null}
											>
												<div>
													<div className="truncate">{repo.full_name}</div>
													<div className="flex items-center gap-2 text-xs text-muted-foreground">
														{repo.stargazers_count !== undefined && (
															<span className="flex items-center gap-0.5">
																<Star className="h-3 w-3" />
																{repo.stargazers_count.toLocaleString()}
															</span>
														)}
														{repo.language && <span>{repo.language}</span>}
													</div>
												</div>
											</SelectableItem>
										))}
									</div>
								) : !hasAnyResults ? (
									<Text variant="small" color="muted" className="px-3 py-4 text-center">
										No repositories found
									</Text>
								) : null)}

							{/* Empty state */}
							{!hasAnyResults && !searchLoading && debouncedQuery.length < 2 && (
								<Text variant="small" color="muted" className="px-3 py-4 text-center">
									{repos.length === 0 ? "Type to search for repos" : "No matching repos"}
								</Text>
							)}
						</div>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
		</div>
	);
}
