"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Repo } from "@/hooks/use-onboarding";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface RepoListProps {
	repos: Repo[];
}

export function RepoList({ repos }: RepoListProps) {
	if (repos.length === 0) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Repositories</CardTitle>
				<CardDescription>Your connected repositories</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="space-y-3">
					{repos.map((repo) => (
						<li
							key={repo.id}
							className="flex items-center justify-between p-3 rounded-lg border bg-card"
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<p className="font-medium truncate">{repo.github_repo_name}</p>
									<a
										href={repo.github_url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-muted-foreground hover:text-foreground"
									>
										<ExternalLink className="h-4 w-4" />
									</a>
								</div>
								<p className="text-sm text-muted-foreground">{repo.default_branch}</p>
							</div>
							<div className="flex items-center gap-2">
								<Badge
									variant="secondary"
									className={cn(
										"text-xs",
										repo.prebuild_status === "ready"
											? "bg-green-500/10 text-green-600 dark:text-green-400"
											: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
									)}
								>
									{repo.prebuild_status === "ready" ? "Ready" : "Pending setup"}
								</Badge>
								{repo.repo_snapshot_status === "building" && (
									<Badge
										variant="secondary"
										className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400"
									>
										Caching...
									</Badge>
								)}
								{repo.repo_snapshot_status === "ready" && (
									<Badge
										variant="secondary"
										className="text-xs bg-green-500/10 text-green-600 dark:text-green-400"
									>
										Cached
									</Badge>
								)}
								{repo.repo_snapshot_status === "failed" && (
									<Badge
										variant="secondary"
										className="text-xs bg-red-500/10 text-red-600 dark:text-red-400"
									>
										Cache failed
									</Badge>
								)}
							</div>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
