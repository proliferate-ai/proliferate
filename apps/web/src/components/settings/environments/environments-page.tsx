"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useCreateRepo, useDeleteRepo, useRepos } from "@/hooks/org/use-repos";
import { useSecrets } from "@/hooks/org/use-secrets";
import { Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { SecretsSection } from "./secrets-section";

function AddRepoDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [githubOrg, setGithubOrg] = useState("");
	const [githubName, setGithubName] = useState("");
	const [defaultBranch, setDefaultBranch] = useState("main");
	const [error, setError] = useState("");
	const createRepo = useCreateRepo();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!githubOrg.trim() || !githubName.trim()) {
			setError("Organization and repository name are required");
			return;
		}
		setError("");
		try {
			await createRepo.mutateAsync({
				githubOrg: githubOrg.trim(),
				githubName: githubName.trim(),
				defaultBranch: defaultBranch.trim() || "main",
			});
			setGithubOrg("");
			setGithubName("");
			setDefaultBranch("main");
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to add repository");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add Repository</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="space-y-4 py-2">
						<div className="space-y-2">
							<Label htmlFor="github-org" className="text-xs">
								GitHub Organization
							</Label>
							<Input
								id="github-org"
								value={githubOrg}
								onChange={(e) => setGithubOrg(e.target.value)}
								placeholder="e.g., acme-corp"
								className="h-8 text-sm"
								autoFocus
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="github-name" className="text-xs">
								Repository Name
							</Label>
							<Input
								id="github-name"
								value={githubName}
								onChange={(e) => setGithubName(e.target.value)}
								placeholder="e.g., my-app"
								className="h-8 text-sm"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="default-branch" className="text-xs">
								Default Branch
							</Label>
							<Input
								id="default-branch"
								value={defaultBranch}
								onChange={(e) => setDefaultBranch(e.target.value)}
								placeholder="main"
								className="h-8 text-sm"
							/>
						</div>
						{error && <p className="text-xs text-destructive">{error}</p>}
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={createRepo.isPending}>
							{createRepo.isPending ? "Adding..." : "Add Repository"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RepoRow({
	repo,
}: {
	repo: { id: string; githubRepoName: string };
}) {
	const deleteRepo = useDeleteRepo();
	const [confirmDelete, setConfirmDelete] = useState(false);

	const repoName = repo.githubRepoName.split("/").pop() || repo.githubRepoName;
	const orgName = repo.githubRepoName.split("/")[0];

	return (
		<div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card">
			<div className="flex items-center gap-1.5 min-w-0">
				<span className="text-xs text-muted-foreground">{orgName}/</span>
				<span className="text-sm font-medium truncate">{repoName}</span>
			</div>
			<div className="flex items-center gap-2 shrink-0">
				{confirmDelete ? (
					<>
						<span className="text-xs text-muted-foreground">Delete?</span>
						<Button
							variant="destructive"
							size="sm"
							className="h-7 text-xs"
							onClick={() => deleteRepo.mutate({ id: repo.id })}
							disabled={deleteRepo.isPending}
						>
							{deleteRepo.isPending ? "..." : "Yes"}
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-xs"
							onClick={() => setConfirmDelete(false)}
						>
							No
						</Button>
					</>
				) : (
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-muted-foreground hover:text-destructive"
						onClick={() => setConfirmDelete(true)}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				)}
			</div>
		</div>
	);
}

export function EnvironmentsPage() {
	const [addRepoOpen, setAddRepoOpen] = useState(false);
	const [repoFilter, setRepoFilter] = useState("");

	const { data: repos, isLoading: reposLoading } = useRepos();
	const { data: secrets } = useSecrets();

	const filteredRepos = useMemo(() => {
		const list = repos ?? [];
		if (!repoFilter) return list;
		const q = repoFilter.toLowerCase();
		return list.filter((r) => r.githubRepoName.toLowerCase().includes(q));
	}, [repos, repoFilter]);

	if (reposLoading) {
		return (
			<PageShell title="Environments">
				<div className="py-12 flex justify-center">
					<LoadingDots size="md" className="text-muted-foreground" />
				</div>
			</PageShell>
		);
	}

	const hasRepos = (repos ?? []).length > 0;

	return (
		<PageShell
			title="Environments"
			subtitle="Configure repositories and secrets for your organization."
		>
			<div className="space-y-10">
				{/* Repositories section */}
				<section>
					<div className="flex items-center justify-between mb-3">
						<div>
							<h2 className="text-sm font-medium">Repositories</h2>
							<p className="text-xs text-muted-foreground mt-0.5">
								Repositories available to your coding agents.
							</p>
						</div>
						<div className="flex items-center gap-2">
							{hasRepos && (
								<div className="relative">
									<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
									<Input
										value={repoFilter}
										onChange={(e) => setRepoFilter(e.target.value)}
										placeholder="Search..."
										className="pl-8 h-8 w-44 text-sm"
									/>
								</div>
							)}
							<Button size="sm" className="h-8" onClick={() => setAddRepoOpen(true)}>
								<Plus className="h-3.5 w-3.5 mr-1.5" />
								Add Repository
							</Button>
						</div>
					</div>

					{!hasRepos ? (
						<div className="rounded-lg border border-dashed border-border/80 py-8 text-center">
							<p className="text-sm text-muted-foreground">No repositories yet</p>
							<p className="text-xs text-muted-foreground mt-1">Add a repository to get started.</p>
							<Button size="sm" className="mt-4" onClick={() => setAddRepoOpen(true)}>
								<Plus className="h-3.5 w-3.5 mr-1.5" />
								Add Repository
							</Button>
						</div>
					) : filteredRepos.length === 0 ? (
						<p className="text-sm text-muted-foreground text-center py-8">
							No repositories matching &ldquo;{repoFilter}&rdquo;
						</p>
					) : (
						<div className="space-y-2">
							{filteredRepos.map((repo) => (
								<RepoRow key={repo.id} repo={repo} />
							))}
						</div>
					)}
				</section>

				{/* Secrets section */}
				<SecretsSection secrets={secrets ?? []} repos={repos ?? []} />
			</div>

			<AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
		</PageShell>
	);
}
