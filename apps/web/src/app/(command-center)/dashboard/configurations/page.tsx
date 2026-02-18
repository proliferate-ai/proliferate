"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { CreateSnapshotContent } from "@/components/dashboard/snapshot-selector";
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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useConfigurations, useDeleteConfiguration } from "@/hooks/use-configurations";
import { cn } from "@/lib/utils";
import type { Configuration } from "@proliferate/shared/contracts";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, FolderGit2, MoreVertical, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

// ============================================
// Main Page
// ============================================

export default function ConfigurationsPage() {
	const { data: configurations, isLoading } = useConfigurations();
	const [filterQuery, setFilterQuery] = useState("");
	const [createOpen, setCreateOpen] = useState(false);

	const configList = useMemo(() => {
		const list = configurations ?? [];
		if (!filterQuery) return list;
		const q = filterQuery.toLowerCase();
		return list.filter((c) => (c.name ?? "").toLowerCase().includes(q));
	}, [configurations, filterQuery]);

	if (isLoading) {
		return (
			<PageShell title="Configurations">
				<div className="py-12 flex justify-center">
					<LoadingDots size="md" className="text-muted-foreground" />
				</div>
			</PageShell>
		);
	}

	const hasConfigs = (configurations ?? []).length > 0;
	const hasResults = configList.length > 0;

	return (
		<PageShell
			title="Configurations"
			actions={
				<div className="flex items-center gap-2">
					{hasConfigs && (
						<div className="relative">
							<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
							<Input
								value={filterQuery}
								onChange={(e) => setFilterQuery(e.target.value)}
								placeholder="Search configurations..."
								className="pl-8 h-8 w-56 text-sm"
							/>
						</div>
					)}
					<Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
						<Plus className="h-3.5 w-3.5 mr-1.5" />
						New Configuration
					</Button>
				</div>
			}
		>
			{!hasConfigs ? (
				<div className="rounded-xl border border-dashed border-border py-16 text-center">
					<p className="text-sm text-muted-foreground">No configurations yet</p>
					<p className="text-xs text-muted-foreground mt-1">
						Create a configuration to set up repos, service commands, and environment files
					</p>
					<div className="flex items-center justify-center gap-3 mt-4">
						<Button size="sm" onClick={() => setCreateOpen(true)}>
							<Plus className="h-3.5 w-3.5 mr-1.5" />
							New Configuration
						</Button>
					</div>
				</div>
			) : !hasResults ? (
				<p className="text-sm text-muted-foreground text-center py-12">
					No configurations matching &ldquo;{filterQuery}&rdquo;
				</p>
			) : (
				<div className="rounded-xl border border-border overflow-hidden">
					{/* Table header */}
					<div className="flex items-center px-4 py-2 pr-12 text-xs text-muted-foreground border-b border-border/50">
						<span className="flex-1 min-w-0">Name</span>
						<span className="w-28 text-center shrink-0">Status</span>
						<span className="w-32 text-center shrink-0">Repos</span>
						<span className="w-28 text-center shrink-0">Created</span>
					</div>

					{configList.map((config) => (
						<ConfigurationRow key={config.id} config={config} />
					))}
				</div>
			)}
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
					<DialogHeader className="sr-only">
						<DialogTitle>New configuration</DialogTitle>
						<DialogDescription>Select repos and create a configuration</DialogDescription>
					</DialogHeader>
					<CreateSnapshotContent onCreate={() => setCreateOpen(false)} />
				</DialogContent>
			</Dialog>
		</PageShell>
	);
}

// ============================================
// Configuration Row
// ============================================

function ConfigurationRow({ config }: { config: Configuration }) {
	const router = useRouter();
	const deleteConfiguration = useDeleteConfiguration();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);

	const displayName = config.name || "Untitled configuration";
	const repos = (config.configurationRepos ?? []).filter((cr) => cr.repo !== null);
	const repoCount = repos.length;
	const timeAgo = config.createdAt
		? formatDistanceToNow(new Date(config.createdAt), { addSuffix: true })
		: "\u2014";

	const handleDelete = async () => {
		await deleteConfiguration.mutateAsync(config.id);
		setDeleteOpen(false);
	};

	return (
		<>
			<div className={cn("border-b border-border/50 last:border-0", expanded && "bg-muted/30")}>
				<div className="flex items-center hover:bg-muted/50 transition-colors">
					<button
						type="button"
						onClick={() => repoCount > 0 && setExpanded(!expanded)}
						className="flex-1 min-w-0 flex items-center px-4 py-2.5 text-sm text-left"
					>
						<span className="flex-1 min-w-0 flex items-center gap-1.5">
							{repoCount > 0 ? (
								<ChevronRight
									className={cn(
										"h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0",
										expanded && "rotate-90",
									)}
								/>
							) : (
								<span className="w-3.5 shrink-0" />
							)}
							<Link
								href={`/dashboard/configurations/${config.id}`}
								onClick={(e) => e.stopPropagation()}
								className="font-medium truncate hover:underline"
							>
								{displayName}
							</Link>
						</span>
						<span className="w-28 flex justify-center shrink-0">
							<span
								className={cn(
									"inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11px] font-medium",
									config.status === "ready"
										? "border-border/50 bg-muted/50 text-foreground"
										: "border-border/50 bg-muted/50 text-muted-foreground",
								)}
							>
								{config.status === "ready"
									? "Ready"
									: config.status === "building"
										? "Building"
										: "Pending"}
							</span>
						</span>
						<span className="w-32 text-center text-xs text-muted-foreground shrink-0">
							{repoCount > 0 ? `${repoCount} repo${repoCount !== 1 ? "s" : ""}` : "\u2014"}
						</span>
						<span className="w-28 text-center text-xs text-muted-foreground shrink-0">
							{timeAgo}
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
								<DropdownMenuItem
									onClick={() => router.push(`/dashboard/configurations/${config.id}`)}
								>
									Edit
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

				{/* Expanded repos list */}
				{expanded && repos.length > 0 && (
					<div className="px-4 pb-3 pl-10 space-y-1">
						{repos.map((cr) => (
							<div key={cr.repo!.id} className="flex items-center gap-2 py-1">
								<FolderGit2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
								<span className="text-xs text-muted-foreground truncate">
									{cr.repo!.githubRepoName}
								</span>
							</div>
						))}
					</div>
				)}
			</div>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete configuration</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete &ldquo;{displayName}&rdquo;? This will remove all
							associated snapshots and service commands.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteConfiguration.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
