"use client";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useGitDiff, useGitRepos, useGitStatus } from "@/hooks/sessions/use-session-git";
import { cn } from "@/lib/display/utils";
import { useQueryClient } from "@tanstack/react-query";
import { FileCode, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Map porcelain v2 status codes to display labels. */
function statusLabel(status: string): { label: string; color: string } {
	if (status === "?") return { label: "?", color: "text-muted-foreground" };
	// Porcelain v2: XY where X=staged, Y=unstaged
	const x = status[0];
	const y = status[1];
	if (x === "." && y === "M") return { label: "M", color: "text-warning" };
	if (x === "M") return { label: "M", color: "text-warning" };
	if (x === "A" || y === "A") return { label: "A", color: "text-success" };
	if (x === "D" || y === "D") return { label: "D", color: "text-destructive" };
	if (x === "R") return { label: "R", color: "text-info" };
	return { label: status.replace(/\./g, " ").trim() || "?", color: "text-muted-foreground" };
}

export interface ChangesContentProps {
	sessionId: string;
	activityTick: number;
}

export function ChangesContent({ sessionId, activityTick }: ChangesContentProps) {
	const queryClient = useQueryClient();
	const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Debounced invalidation on activity tick
	useEffect(() => {
		if (activityTick === 0) return;
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			queryClient.invalidateQueries({ queryKey: ["git-status", sessionId] });
			queryClient.invalidateQueries({ queryKey: ["git-diff", sessionId] });
		}, 500);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [activityTick, queryClient, sessionId]);

	// Fetch repos
	const { data: reposData, isLoading: reposLoading, error: reposError } = useGitRepos(sessionId);

	const repos = reposData?.repos ?? [];

	// Auto-select first repo
	useEffect(() => {
		if (repos.length > 0 && !selectedRepo) {
			setSelectedRepo(repos[0].id);
		}
	}, [repos, selectedRepo]);

	// Fetch status
	const {
		data: statusData,
		isLoading: statusLoading,
		error: statusError,
	} = useGitStatus(sessionId, selectedRepo);

	// Fetch diff for selected file
	const {
		data: diffData,
		isLoading: diffLoading,
		error: diffError,
	} = useGitDiff(sessionId, selectedRepo, selectedFile);

	const handleFileClick = useCallback((filePath: string) => {
		setSelectedFile((prev) => (prev === filePath ? null : filePath));
	}, []);

	const files = statusData?.files ?? [];
	const error = reposError || statusError;

	return (
		<>
			{/* Repo selector (if multiple) */}
			{repos.length > 1 && !selectedFile && (
				<div className="px-3 py-2 border-b">
					<Select value={selectedRepo ?? ""} onValueChange={setSelectedRepo}>
						<SelectTrigger className="h-8 text-xs">
							<SelectValue placeholder="Select repo" />
						</SelectTrigger>
						<SelectContent>
							{repos.map((repo) => (
								<SelectItem key={repo.id} value={repo.id}>
									{repo.path.split("/").pop()}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			{/* Content */}
			<div className="flex-1 min-h-0 overflow-auto">
				{(reposLoading || statusLoading) && !selectedFile ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : error ? (
					<div className="px-3 py-4 text-sm text-destructive">
						{error instanceof Error ? error.message : "Failed to load changes"}
					</div>
				) : selectedFile ? (
					<DiffView diff={diffData?.diff} loading={diffLoading} error={diffError} />
				) : files.length === 0 ? (
					<div className="px-3 py-8 text-center text-sm text-muted-foreground">
						No changes detected
					</div>
				) : (
					<div className="divide-y">
						{files.map((file) => {
							const { label, color } = statusLabel(file.status);
							return (
								<Button
									key={file.path}
									type="button"
									variant="ghost"
									className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-muted/50 h-auto justify-start rounded-none"
									onClick={() => handleFileClick(file.path)}
								>
									<span className={cn("text-xs font-mono w-4 shrink-0 text-center", color)}>
										{label}
									</span>
									<FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
									<span className="text-sm truncate text-foreground">{file.path}</span>
								</Button>
							);
						})}
					</div>
				)}
			</div>

			{/* Footer: file count */}
			{!selectedFile && files.length > 0 && (
				<div className="px-3 py-1.5 border-t text-xs text-muted-foreground shrink-0">
					{files.length} file{files.length !== 1 ? "s" : ""} changed
				</div>
			)}
		</>
	);
}

/** Renders a unified diff with syntax highlighting for +/- lines. */
function DiffView({
	diff,
	loading,
	error,
}: {
	diff?: string;
	loading: boolean;
	error: Error | null;
}) {
	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="px-3 py-4 text-sm text-destructive">
				{error.message || "Failed to load diff"}
			</div>
		);
	}

	if (!diff || diff.trim().length === 0) {
		return (
			<div className="px-3 py-8 text-center text-sm text-muted-foreground">
				No diff available (file may be untracked)
			</div>
		);
	}

	const lines = diff.split("\n");

	return (
		<pre className="text-xs font-mono overflow-x-auto p-2">
			{lines.map((line, lineIdx) => {
				let className = "text-foreground";
				let bgClassName = "";
				if (line.startsWith("+") && !line.startsWith("+++")) {
					className = "text-success";
					bgClassName = "bg-success/10";
				} else if (line.startsWith("-") && !line.startsWith("---")) {
					className = "text-destructive";
					bgClassName = "bg-destructive/10";
				} else if (line.startsWith("@@")) {
					className = "text-info";
					bgClassName = "bg-info/5";
				} else if (line.startsWith("diff ") || line.startsWith("index ")) {
					className = "text-muted-foreground";
				}
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: diff lines are static output, index is stable
					<div key={lineIdx} className={cn("px-1 leading-5", bgClassName)}>
						<span className={className}>{line}</span>
					</div>
				);
			})}
		</pre>
	);
}
