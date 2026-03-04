"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/display/utils";
import { GATEWAY_URL } from "@/lib/infra/gateway";
import type { FsTreeEntry } from "@proliferate/shared/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDown,
	ChevronRight,
	File,
	Folder,
	FolderOpen,
	Link,
	Loader2,
	RefreshCw,
	X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { PanelShell } from "./panel-shell";
import { useWsToken } from "./runtime/use-ws-token";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FilesPanelProps {
	sessionId: string;
}

interface ExpandedDirs {
	[path: string]: boolean;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

function buildFsUrl(sessionId: string, token: string, path: string, depth: number): string {
	return `${GATEWAY_URL}/proliferate/v1/sessions/${sessionId}/fs/tree?path=${encodeURIComponent(path)}&depth=${depth}`;
}

function buildFileReadUrl(sessionId: string, token: string, path: string): string {
	return `${GATEWAY_URL}/proliferate/v1/sessions/${sessionId}/fs/read?path=${encodeURIComponent(path)}`;
}

async function fetchWithAuth<T>(url: string, token: string): Promise<T> {
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${res.statusText}`);
	}
	return res.json();
}

// ---------------------------------------------------------------------------
// File icon
// ---------------------------------------------------------------------------

function FileIcon({ entry }: { entry: FsTreeEntry }) {
	if (entry.type === "symlink") {
		return <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
	}
	if (entry.type === "directory") {
		return <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
	}
	return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function formatFileSize(bytes: number | undefined): string {
	if (bytes === undefined) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// File content viewer
// ---------------------------------------------------------------------------

function FileContentViewer({
	sessionId,
	filePath,
	onClose,
}: {
	sessionId: string;
	filePath: string;
	onClose: () => void;
}) {
	const { token } = useWsToken();

	const { data, isLoading, error } = useQuery({
		queryKey: ["file-read", sessionId, filePath],
		queryFn: () =>
			fetchWithAuth<{ content: string; size: number }>(
				buildFileReadUrl(sessionId, token!, filePath),
				token!,
			),
		enabled: !!token && !!GATEWAY_URL,
		staleTime: 5_000,
		retry: 1,
	});

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 shrink-0">
				<span className="text-xs font-medium truncate">{filePath}</span>
				<div className="flex items-center gap-1">
					{data?.size !== undefined && (
						<span className="text-[11px] text-muted-foreground">{formatFileSize(data.size)}</span>
					)}
					<Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose}>
						<X className="h-3 w-3" />
					</Button>
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-auto">
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : error ? (
					<div className="px-3 py-4 text-sm text-destructive">
						{error instanceof Error ? error.message : "Failed to read file"}
					</div>
				) : (
					<pre className="text-xs font-mono p-3 whitespace-pre-wrap break-all text-foreground">
						{data?.content ?? ""}
					</pre>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Tree row
// ---------------------------------------------------------------------------

function TreeRow({
	entry,
	depth,
	isExpanded,
	onToggle,
	onSelect,
	isSelected,
}: {
	entry: FsTreeEntry;
	depth: number;
	isExpanded: boolean;
	onToggle: () => void;
	onSelect: () => void;
	isSelected: boolean;
}) {
	const isDir = entry.type === "directory";
	const indent = depth * 16;

	return (
		<button
			type="button"
			className={cn(
				"flex items-center gap-1.5 w-full py-1 px-2 text-left hover:bg-muted/50 transition-colors text-sm",
				isSelected && "bg-muted/70",
			)}
			style={{ paddingLeft: `${indent + 8}px` }}
			onClick={isDir ? onToggle : onSelect}
		>
			{isDir ? (
				<span className="shrink-0 w-3.5">
					{isExpanded ? (
						<ChevronDown className="h-3 w-3 text-muted-foreground" />
					) : (
						<ChevronRight className="h-3 w-3 text-muted-foreground" />
					)}
				</span>
			) : (
				<span className="shrink-0 w-3.5" />
			)}
			{isDir && isExpanded ? (
				<FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			) : (
				<FileIcon entry={entry} />
			)}
			<span className="truncate text-foreground">{entry.name}</span>
			{entry.size !== undefined && entry.type === "file" && (
				<span className="ml-auto text-[11px] text-muted-foreground shrink-0">
					{formatFileSize(entry.size)}
				</span>
			)}
		</button>
	);
}

// ---------------------------------------------------------------------------
// Files Panel
// ---------------------------------------------------------------------------

export function FilesPanel({ sessionId }: FilesPanelProps) {
	const { token } = useWsToken();
	const queryClient = useQueryClient();
	const [expandedDirs, setExpandedDirs] = useState<ExpandedDirs>({ ".": true });
	const [selectedFile, setSelectedFile] = useState<string | null>(null);

	const canFetch = !!token && !!GATEWAY_URL;

	// Fetch root tree
	const { data, isLoading, error, refetch } = useQuery({
		queryKey: ["fs-tree", sessionId, "."],
		queryFn: () =>
			fetchWithAuth<{ entries: FsTreeEntry[] }>(buildFsUrl(sessionId, token!, ".", 3), token!),
		enabled: canFetch,
		staleTime: 15_000,
		retry: 2,
	});

	const entries = data?.entries ?? [];

	const toggleDir = useCallback((path: string) => {
		setExpandedDirs((prev) => ({ ...prev, [path]: !prev[path] }));
	}, []);

	const handleSelectFile = useCallback((path: string) => {
		setSelectedFile((prev) => (prev === path ? null : path));
	}, []);

	const handleRefresh = useCallback(() => {
		refetch();
		queryClient.invalidateQueries({ queryKey: ["fs-tree", sessionId] });
	}, [refetch, queryClient, sessionId]);

	// Build hierarchical view from flat entries
	const rootEntries = entries.filter((e) => !e.path.includes("/"));
	const childrenOf = (parentPath: string) =>
		entries.filter((e) => {
			const parent = e.path.substring(0, e.path.lastIndexOf("/"));
			return parent === parentPath;
		});

	function renderEntries(items: FsTreeEntry[], depth: number): React.ReactNode {
		// Sort: directories first, then alphabetical
		const sorted = [...items].sort((a, b) => {
			if (a.type === "directory" && b.type !== "directory") return -1;
			if (a.type !== "directory" && b.type === "directory") return 1;
			return a.name.localeCompare(b.name);
		});

		return sorted.map((entry) => {
			const isDir = entry.type === "directory";
			const isExpanded = expandedDirs[entry.path] ?? false;
			const children = isDir && isExpanded ? childrenOf(entry.path) : [];

			return (
				<div key={entry.path}>
					<TreeRow
						entry={entry}
						depth={depth}
						isExpanded={isExpanded}
						onToggle={() => toggleDir(entry.path)}
						onSelect={() => handleSelectFile(entry.path)}
						isSelected={selectedFile === entry.path}
					/>
					{isDir && isExpanded && children.length > 0 && renderEntries(children, depth + 1)}
				</div>
			);
		});
	}

	const panelActions = (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh}>
					<RefreshCw className="h-3.5 w-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Refresh</TooltipContent>
		</Tooltip>
	);

	if (selectedFile) {
		return (
			<PanelShell title="Files" noPadding actions={panelActions}>
				<FileContentViewer
					sessionId={sessionId}
					filePath={selectedFile}
					onClose={() => setSelectedFile(null)}
				/>
			</PanelShell>
		);
	}

	return (
		<PanelShell title="Files" noPadding actions={panelActions}>
			<div className="flex flex-col h-full">
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : error ? (
					<div className="px-3 py-4 text-sm text-destructive">
						{error instanceof Error ? error.message : "Failed to load files"}
					</div>
				) : entries.length === 0 ? (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-muted-foreground">No files in workspace</p>
					</div>
				) : (
					<div className="flex-1 min-h-0 overflow-y-auto">{renderEntries(rootEntries, 0)}</div>
				)}

				{/* Footer: file count */}
				{entries.length > 0 && (
					<div className="px-3 py-1.5 border-t text-xs text-muted-foreground shrink-0">
						{entries.filter((e) => e.type === "file").length} file
						{entries.filter((e) => e.type === "file").length !== 1 ? "s" : ""}
						{", "}
						{entries.filter((e) => e.type === "directory").length} folder
						{entries.filter((e) => e.type === "directory").length !== 1 ? "s" : ""}
					</div>
				)}
			</div>
		</PanelShell>
	);
}
