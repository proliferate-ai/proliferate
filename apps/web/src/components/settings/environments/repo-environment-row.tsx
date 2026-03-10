"use client";

import { Button } from "@/components/ui/button";
import { useConfigurations } from "@/hooks/sessions/use-configurations";
import { cn } from "@/lib/display/utils";
import { ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface RepoEnvironmentRowProps {
	repo: {
		id: string;
		githubRepoName: string;
	};
	baseline?: {
		id: string;
		status: string;
	};
}

export function RepoEnvironmentRow({ repo, baseline }: RepoEnvironmentRowProps) {
	const [expanded, setExpanded] = useState(false);
	const { data: configurations } = useConfigurations("ready");

	const repoConfigs = (configurations ?? []).filter((c) =>
		c.configurationRepos?.some((cr: { repo: { id: string } | null }) => cr.repo?.id === repo.id),
	);

	const repoName = repo.githubRepoName.split("/").pop() || repo.githubRepoName;
	const orgName = repo.githubRepoName.split("/")[0];

	return (
		<div className="rounded-lg border border-border bg-card">
			<button
				type="button"
				className="flex items-center gap-3 px-4 py-3 w-full text-left cursor-pointer hover:bg-muted/30 transition-colors"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<ChevronRight
					className={cn(
						"h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-150",
						expanded && "rotate-90",
					)}
				/>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						<span className="text-xs text-muted-foreground">{orgName}/</span>
						<span className="text-sm font-medium truncate">{repoName}</span>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{baseline && (
						<span
							className={cn(
								"text-xs px-2 py-0.5 rounded-full",
								baseline.status === "ready"
									? "bg-success/10 text-success"
									: baseline.status === "building"
										? "bg-warning/10 text-warning"
										: "bg-muted text-muted-foreground",
							)}
						>
							{baseline.status}
						</span>
					)}
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-xs"
						asChild
						onClick={(e) => e.stopPropagation()}
					>
						<Link href={`/workspace/onboard?repo=${repo.id}`}>Setup environment</Link>
					</Button>
				</div>
			</button>

			{expanded && (
				<div className="border-t border-border/50 px-4 py-3 pl-11 space-y-4">
					{/* Ready configurations / snapshots */}
					{repoConfigs.length > 0 ? (
						<div>
							<h3 className="text-xs font-medium text-muted-foreground mb-2">Environments</h3>
							<div className="space-y-1.5">
								{repoConfigs.map((config) => (
									<div
										key={config.id}
										className="flex items-center justify-between text-sm py-1.5 px-2 rounded-md hover:bg-muted/30"
									>
										<div className="flex items-center gap-2 min-w-0">
											<span className="truncate">
												{config.name || `Environment ${config.id.slice(0, 8)}`}
											</span>
											<span className="text-xs text-muted-foreground">{config.status}</span>
										</div>
										{config.snapshotId && (
											<span className="text-xs text-muted-foreground">
												Snapshot: {config.snapshotId.slice(0, 8)}
											</span>
										)}
									</div>
								))}
							</div>
						</div>
					) : (
						<p className="text-xs text-muted-foreground">
							No environments configured yet. Run setup to create one.
						</p>
					)}

					{/* Link to repo detail */}
					<div className="pt-1">
						<Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" asChild>
							<Link href={`/settings/repositories/${repo.id}`}>
								View details
								<ExternalLink className="h-3 w-3" />
							</Link>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
