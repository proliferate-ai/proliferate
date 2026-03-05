"use client";

import { Button } from "@/components/ui/button";
import { useSessionFilesTree } from "@/hooks/sessions/use-session-files";
import { cn } from "@/lib/display/utils";
import type { FsTreeEntry } from "@proliferate/shared/contracts/harness";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Link, Loader2 } from "lucide-react";
import { useMemo } from "react";

function sortTreeEntries(entries: FsTreeEntry[]): FsTreeEntry[] {
	return [...entries].sort((a, b) => {
		if (a.type === "directory" && b.type !== "directory") return -1;
		if (a.type !== "directory" && b.type === "directory") return 1;
		return a.name.localeCompare(b.name);
	});
}

function fileIcon(entry: FsTreeEntry, isExpanded: boolean) {
	if (entry.type === "symlink")
		return <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
	if (entry.type === "directory") {
		return isExpanded ? (
			<FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
		) : (
			<Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
		);
	}
	return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function parentPath(path: string) {
	const index = path.lastIndexOf("/");
	if (index <= 0) return ".";
	return path.slice(0, index);
}

interface TreeNodeProps {
	sessionId: string;
	entry: FsTreeEntry;
	depth: number;
	expandedDirs: Set<string>;
	currentFile: string | null;
	onToggleDir: (path: string) => void;
	onSelectFile: (path: string) => void;
}

function TreeNode({
	sessionId,
	entry,
	depth,
	expandedDirs,
	currentFile,
	onToggleDir,
	onSelectFile,
}: TreeNodeProps) {
	const isDir = entry.type === "directory";
	const isExpanded = expandedDirs.has(entry.path);

	const { data, isFetching } = useSessionFilesTree(sessionId, entry.path, 1, isDir && isExpanded);
	const directChildren = useMemo(() => {
		if (!data?.entries) return [];
		return sortTreeEntries(data.entries.filter((child) => parentPath(child.path) === entry.path));
	}, [data, entry.path]);

	return (
		<div>
			<Button
				type="button"
				variant="ghost"
				className={cn(
					"h-7 w-full justify-start rounded-none px-2 py-0 text-xs hover:bg-muted/50",
					currentFile === entry.path && "bg-muted/70",
				)}
				style={{ paddingLeft: `${depth * 14 + 8}px` }}
				onClick={() => {
					if (isDir) onToggleDir(entry.path);
					else onSelectFile(entry.path);
				}}
			>
				<span className="mr-1 w-3.5 shrink-0">
					{isDir ? (
						isExpanded ? (
							isFetching ? (
								<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
							) : (
								<ChevronDown className="h-3 w-3 text-muted-foreground" />
							)
						) : (
							<ChevronRight className="h-3 w-3 text-muted-foreground" />
						)
					) : null}
				</span>
				{fileIcon(entry, isExpanded)}
				<span className="ml-1 truncate text-left">{entry.name}</span>
			</Button>
			{isDir && isExpanded && directChildren.length > 0 && (
				<div>
					{directChildren.map((child) => (
						<TreeNode
							key={child.path}
							sessionId={sessionId}
							entry={child}
							depth={depth + 1}
							expandedDirs={expandedDirs}
							currentFile={currentFile}
							onToggleDir={onToggleDir}
							onSelectFile={onSelectFile}
						/>
					))}
				</div>
			)}
		</div>
	);
}

interface FilesTreeProps {
	sessionId: string;
	expandedDirs: Set<string>;
	currentFile: string | null;
	pathQuery: string;
	onToggleDir: (path: string) => void;
	onSelectFile: (path: string) => void;
}

export function FilesTree({
	sessionId,
	expandedDirs,
	currentFile,
	pathQuery,
	onToggleDir,
	onSelectFile,
}: FilesTreeProps) {
	const { data, isLoading, error } = useSessionFilesTree(sessionId, ".", 1, true);

	const rootEntries = useMemo(() => {
		const entries = data?.entries ?? [];
		const filtered = entries.filter(
			(entry) => !pathQuery || entry.path.toLowerCase().includes(pathQuery),
		);
		return sortTreeEntries(filtered.filter((entry) => !entry.path.includes("/")));
	}, [data?.entries, pathQuery]);

	if (isLoading) {
		return <div className="px-3 py-2 text-xs text-muted-foreground">Loading files...</div>;
	}

	if (error) {
		return (
			<div className="px-3 py-2 text-xs text-destructive">
				{error instanceof Error ? error.message : "Failed to load file tree"}
			</div>
		);
	}

	if (rootEntries.length === 0) {
		return <div className="px-3 py-2 text-xs text-muted-foreground">No files found.</div>;
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto py-1">
			{rootEntries.map((entry) => (
				<TreeNode
					key={entry.path}
					sessionId={sessionId}
					entry={entry}
					depth={0}
					expandedDirs={expandedDirs}
					currentFile={currentFile}
					onToggleDir={onToggleDir}
					onSelectFile={onSelectFile}
				/>
			))}
		</div>
	);
}
