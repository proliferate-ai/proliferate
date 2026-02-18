"use client";

import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { Box, Circle, Clock, GitBranch, Moon, Sun, Users } from "lucide-react";
import { useTheme } from "next-themes";

export interface SessionInfoContentProps {
	sessionStatus?: string;
	repoName?: string | null;
	branchName?: string | null;
	snapshotId?: string | null;
	startedAt?: string | null;
	concurrentUsers?: number;
	isModal?: boolean;
	isMigrating?: boolean;
}

function formatAge(dateString: string | null | undefined): string {
	if (!dateString) return "";
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h`;
	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays}d`;
}

export function SessionInfoContent({
	sessionStatus,
	repoName,
	branchName,
	snapshotId,
	startedAt,
	concurrentUsers = 1,
	isModal,
	isMigrating,
}: SessionInfoContentProps) {
	const isRunning = sessionStatus === "running" || sessionStatus === "starting";
	const { theme, setTheme } = useTheme();

	return (
		<div className="flex-1 overflow-y-auto p-4 space-y-6">
			{/* Status section */}
			<div className="space-y-3">
				<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					Status
				</h3>
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2 text-sm">
							<Circle
								className={cn(
									"h-2.5 w-2.5 fill-current",
									isMigrating
										? "text-yellow-500 animate-pulse"
										: isRunning
											? "text-green-500"
											: "text-muted-foreground/50",
								)}
							/>
							<span>{isMigrating ? "Extending..." : isRunning ? "Open" : "Closed"}</span>
						</div>
					</div>
					{startedAt && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Clock className="h-3.5 w-3.5" />
							<span>Started {formatAge(startedAt)} ago</span>
						</div>
					)}
					{concurrentUsers > 0 && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Users className="h-3.5 w-3.5" />
							<span>
								{concurrentUsers} {concurrentUsers === 1 ? "user" : "users"}
							</span>
						</div>
					)}
				</div>
			</div>

			{/* Environment section */}
			{(repoName || branchName || snapshotId) && (
				<div className="space-y-3">
					<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
						Environment
					</h3>
					<div className="space-y-2">
						{repoName && (
							<div className="flex items-center gap-2 text-sm">
								<GithubIcon className="h-3.5 w-3.5 shrink-0" />
								<span className="truncate">{repoName}</span>
							</div>
						)}
						{branchName && (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<GitBranch className="h-3.5 w-3.5 shrink-0" />
								<span className="truncate font-mono text-xs">{branchName}</span>
							</div>
						)}
						{snapshotId && (
							<div
								className="flex items-center gap-2 text-sm text-muted-foreground"
								title={`Snapshot: ${snapshotId}`}
							>
								<Box className="h-3.5 w-3.5 shrink-0" />
								<span className="truncate font-mono text-xs">{snapshotId.slice(0, 12)}</span>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Theme toggle (modal only) */}
			{isModal && (
				<div className="space-y-3">
					<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
						Appearance
					</h3>
					<Button
						variant="outline"
						size="sm"
						className="w-full justify-start gap-2"
						onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
					>
						{theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
						{theme === "dark" ? "Light mode" : "Dark mode"}
					</Button>
				</div>
			)}
		</div>
	);
}
