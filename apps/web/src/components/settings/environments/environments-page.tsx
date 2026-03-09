"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { AddRepoDialog } from "@/components/settings/repositories/add-repo-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useRepos } from "@/hooks/org/use-repos";
import { useSecrets } from "@/hooks/org/use-secrets";
import { useActiveBaselinesByRepos } from "@/hooks/sessions/use-baselines";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { RepoEnvironmentRow } from "./repo-environment-row";
import { SecretsSection } from "./secrets-section";

export function EnvironmentsPage() {
	const [addRepoOpen, setAddRepoOpen] = useState(false);
	const [repoFilter, setRepoFilter] = useState("");

	const { data: repos, isLoading: reposLoading } = useRepos();
	const { data: secrets } = useSecrets();

	const repoIds = useMemo(() => (repos ?? []).map((r) => r.id), [repos]);
	const { data: activeBaselines } = useActiveBaselinesByRepos(repoIds, repoIds.length > 0);

	const baselinesByRepo = useMemo(() => {
		const map = new Map<string, { id: string; status: string }>();
		for (const b of activeBaselines ?? []) {
			map.set(b.repoId, b);
		}
		return map;
	}, [activeBaselines]);

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
			subtitle="Configure development environments and secrets for your repositories."
		>
			<div className="space-y-10">
				{/* Environments section */}
				<section>
					<div className="flex items-center justify-between mb-3">
						<div>
							<h2 className="text-sm font-medium">Environments</h2>
							<p className="text-xs text-muted-foreground mt-0.5">
								Agents write better code with a configured development environment.
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
							<p className="text-xs text-muted-foreground mt-1">
								Add a repository to get started with environment setup.
							</p>
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
						<div className="space-y-2 max-h-[420px] overflow-y-auto">
							{filteredRepos.map((repo) => (
								<RepoEnvironmentRow
									key={repo.id}
									repo={repo}
									baseline={baselinesByRepo.get(repo.id)}
								/>
							))}
						</div>
					)}
				</section>

				{/* Secrets section */}
				<SecretsSection secrets={secrets ?? []} />
			</div>

			<AddRepoDialog
				open={addRepoOpen}
				onOpenChange={setAddRepoOpen}
				existingRepoIds={new Set((repos ?? []).map((r) => r.githubRepoId))}
			/>
		</PageShell>
	);
}
