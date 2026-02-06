"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Repo } from "@/hooks/use-onboarding";
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
							<div>
								{repo.prebuild_status === "ready" ? (
									<span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
										Ready
									</span>
								) : (
									<span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
										Pending setup
									</span>
								)}
							</div>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
