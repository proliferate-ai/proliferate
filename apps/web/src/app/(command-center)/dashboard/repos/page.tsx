"use client";

import { openEditSession, openHistoricalSession } from "@/components/coding-session";
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
import {
	useCheckSecrets,
	useCreateRepo,
	useDeleteRepo,
	usePrebuildEnvFiles,
	useRepoSnapshots,
	useRepos,
	useSearchRepos,
} from "@/hooks/use-repos";
import { cn, getSnapshotDisplayName } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { GitHubRepo, Repo } from "@/types";
import type { RepoSnapshot } from "@proliferate/shared/contracts";
import { formatDistanceToNow } from "date-fns";
import {
	AlertTriangle,
	ChevronRight,
	ExternalLink,
	MoreVertical,
	Plus,
	Search,
	Star,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

// ============================================
// Main Page
// ============================================

export default function RepositoriesPage() {
	const { data: repos, isLoading } = useRepos();
	const [expandedRepoId, setExpandedRepoId] = useState<string | null>(null);
	const [filterQuery, setFilterQuery] = useState("");
	const [addDialogOpen, setAddDialogOpen] = useState(false);

	const reposList = useMemo(() => {
		const list = repos ?? [];
		if (!filterQuery) return list;
		const q = filterQuery.toLowerCase();
		return list.filter((r) => r.githubRepoName.toLowerCase().includes(q));
	}, [repos, filterQuery]);

	const toggleExpand = useCallback((repoId: string) => {
		setExpandedRepoId((prev) => (prev === repoId ? null : repoId));
	}, []);

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
						<span className="w-6" />
						<span className="flex-1 min-w-0">Name</span>
						<span className="w-24 text-center shrink-0">Branch</span>
						<span className="w-28 text-center shrink-0">Configurations</span>
						<span className="w-28 text-center shrink-0">Status</span>
					</div>

					{reposList.map((repo) => (
						<RepoRow
							key={repo.id}
							repo={repo}
							expanded={expandedRepoId === repo.id}
							onToggle={() => toggleExpand(repo.id)}
						/>
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

function RepoRow({
	repo,
	expanded,
	onToggle,
}: {
	repo: Repo;
	expanded: boolean;
	onToggle: () => void;
}) {
	const router = useRouter();
	const { setSelectedRepo } = useDashboardStore();
	const deleteRepo = useDeleteRepo();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const { data: snapshots } = useRepoSnapshots(repo.id, expanded);
	const configCount = snapshots?.length ?? 0;

	const handleConfigure = () => {
		setSelectedRepo(repo.id);
		router.push(`/workspace/new?repoId=${repo.id}&type=setup`);
	};

	const handleDelete = async () => {
		await deleteRepo.mutateAsync({ id: repo.id });
		setDeleteOpen(false);
	};

	return (
		<>
			<div className={cn("border-b border-border/50 last:border-0", expanded && "bg-muted/30")}>
				{/* Collapsed row */}
				<div className="flex items-center hover:bg-muted/50 transition-colors">
					<button
						type="button"
						onClick={onToggle}
						className="flex-1 min-w-0 flex items-center px-4 py-2.5 text-sm text-left"
					>
						<ChevronRight
							className={cn(
								"h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0",
								expanded && "rotate-90",
							)}
						/>
						<span className="flex-1 min-w-0 flex items-center gap-1.5 ml-2">
							<span className="font-medium truncate">{repo.githubRepoName}</span>
							<a
								href={repo.githubUrl}
								target="_blank"
								rel="noopener noreferrer"
								onClick={(e) => e.stopPropagation()}
								className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
							>
								<ExternalLink className="h-3 w-3" />
							</a>
						</span>
						<span className="w-24 text-center text-xs text-muted-foreground shrink-0">
							{repo.defaultBranch || "main"}
						</span>
						<span className="w-28 text-center text-xs text-muted-foreground shrink-0">
							{configCount > 0 ? `${configCount} config${configCount !== 1 ? "s" : ""}` : "\u2014"}
						</span>
						<span className="w-28 flex justify-center shrink-0">
							<span
								className={cn(
									"inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11px] font-medium",
									repo.prebuildStatus === "ready"
										? "border-border/50 bg-muted/50 text-foreground"
										: "border-border/50 bg-muted/50 text-muted-foreground",
								)}
							>
								{repo.prebuildStatus === "ready" ? "Configured" : "Not configured"}
							</span>
						</span>
					</button>

					<div className="pr-3 shrink-0">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7">
									<MoreVertical className="h-3.5 w-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={handleConfigure}>
									<Plus className="h-4 w-4 mr-2" />
									Configure
								</DropdownMenuItem>
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

				{/* Expanded content */}
				{expanded && <RepoConfigurations repoId={repo.id} />}
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

// ============================================
// Repo Configurations (expanded content)
// ============================================

function RepoConfigurations({ repoId }: { repoId: string }) {
	const router = useRouter();
	const { setSelectedRepo } = useDashboardStore();
	const { data: snapshots, isLoading } = useRepoSnapshots(repoId);

	const handleConfigure = () => {
		setSelectedRepo(repoId);
		router.push(`/workspace/new?repoId=${repoId}&type=setup`);
	};

	if (isLoading) {
		return (
			<div className="px-4 pb-4 pl-10">
				<LoadingDots size="sm" className="text-muted-foreground" />
			</div>
		);
	}

	if (!snapshots || snapshots.length === 0) {
		return (
			<div className="px-4 pb-4 pl-10">
				<p className="text-xs text-muted-foreground mb-2">No configurations yet</p>
				<Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleConfigure}>
					Configure
				</Button>
			</div>
		);
	}

	return (
		<div className="px-4 pb-3 pl-10 space-y-1">
			{snapshots.map((config) => (
				<ConfigurationRow key={config.id} config={config} repoId={repoId} />
			))}
			<Button
				variant="ghost"
				size="sm"
				className="h-7 text-xs text-muted-foreground hover:text-foreground -ml-2"
				onClick={handleConfigure}
			>
				<Plus className="h-3 w-3 mr-1" />
				New configuration
			</Button>
		</div>
	);
}

// ============================================
// Configuration Row
// ============================================

function ConfigurationRow({
	config,
	repoId,
}: {
	config: RepoSnapshot;
	repoId: string;
}) {
	const name = getSnapshotDisplayName(config);
	const setupSessionId = config.setupSessions?.find((s) => s.sessionType === "setup")?.id;
	const timeAgo = formatDistanceToNow(new Date(config.createdAt), { addSuffix: true });
	const statusLabel = config.status || "pending";

	return (
		<div className="py-2 border-b border-border/30 last:border-0">
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<span className="text-sm font-medium">{name}</span>
					<span className="text-xs text-muted-foreground ml-2">
						{statusLabel} · {timeAgo}
						{config.createdBy && ` by ${config.createdBy}`}
					</span>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					{setupSessionId && (
						<>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs"
								onClick={() => openHistoricalSession(setupSessionId, name)}
							>
								View
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs"
								onClick={() =>
									openEditSession({
										sessionId: setupSessionId,
										snapshotId: config.snapshotId || config.id,
										snapshotName: name,
										prebuildId: config.id,
									})
								}
							>
								Edit
							</Button>
						</>
					)}
				</div>
			</div>
			<EnvFileSummary prebuildId={config.id} repoId={repoId} />
		</div>
	);
}

// ============================================
// Env File Summary
// ============================================

interface EnvFileSpec {
	path: string;
	keys: Array<{ key: string; required: boolean }>;
}

function EnvFileSummary({
	prebuildId,
	repoId,
}: {
	prebuildId: string;
	repoId: string;
}) {
	const { data: envFilesRaw, isLoading: envLoading } = usePrebuildEnvFiles(prebuildId);

	const envFiles = useMemo(() => {
		if (!envFilesRaw || !Array.isArray(envFilesRaw)) return [];
		return envFilesRaw as EnvFileSpec[];
	}, [envFilesRaw]);

	const allKeys = useMemo(() => {
		return envFiles.flatMap((f) => f.keys.map((k) => k.key));
	}, [envFiles]);

	const { data: secretResults, isLoading: secretsLoading } = useCheckSecrets(
		allKeys,
		repoId,
		prebuildId,
		allKeys.length > 0,
	);

	if (envLoading || envFiles.length === 0) return null;

	const existingKeys = new Set((secretResults ?? []).filter((r) => r.exists).map((r) => r.key));
	const isLoading = secretsLoading;
	let hasMissing = false;

	return (
		<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
			{envFiles.map((file) => {
				const total = file.keys.length;
				const populated = file.keys.filter((k) => existingKeys.has(k.key)).length;
				const missing = total - populated;
				if (missing > 0) hasMissing = true;

				return (
					<span
						key={file.path}
						className={cn(
							"text-xs",
							missing > 0 ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
						)}
					>
						{file.path}{" "}
						{isLoading ? (
							<span className="text-muted-foreground">(...)</span>
						) : (
							<>
								({populated}/{total} keys)
								{missing > 0 && <AlertTriangle className="inline h-3 w-3 ml-0.5 -mt-0.5" />}
							</>
						)}
					</span>
				);
			})}
			{hasMissing && !isLoading && (
				<Link href="/settings/secrets" className="text-xs text-primary hover:underline">
					Manage Secrets
				</Link>
			)}
		</div>
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
