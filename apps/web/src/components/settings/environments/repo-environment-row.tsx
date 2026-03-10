"use client";

import { SnapshotRefreshSection } from "@/components/settings/environments/snapshot-refresh-section";
import { BaselineSection } from "@/components/settings/repositories/baseline-section";
import { DangerSection } from "@/components/settings/repositories/danger-section";
import { ServiceCommandsSection } from "@/components/settings/repositories/service-commands-section";
import { SetupRunSection } from "@/components/settings/repositories/setup-run-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/display/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface RepoEnvironmentRowProps {
	repo: {
		id: string;
		githubRepoName: string;
		configurationId?: string | null;
		configurationStatus?: string | null;
	};
	baseline?: {
		id: string;
		status: string;
	};
}

export function RepoEnvironmentRow({ repo, baseline }: RepoEnvironmentRowProps) {
	const [expanded, setExpanded] = useState(false);

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
				<div className="border-t border-border/50 px-4 py-4 pl-11 space-y-6">
					<BaselineSection repoId={repo.id} />
					{repo.configurationId && repo.configurationStatus === "ready" && (
						<SnapshotRefreshSection configurationId={repo.configurationId} />
					)}
					<ServiceCommandsSection repoId={repo.id} />
					<SetupRunSection repoId={repo.id} />
					<DangerSection repoId={repo.id} repoName={repo.githubRepoName} />
				</div>
			)}
		</div>
	);
}
