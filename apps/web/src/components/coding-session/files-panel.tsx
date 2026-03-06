"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFilesPanelLayout } from "@/hooks/sessions/files-panel/layout";
import { useFilesPanelSearchIndex } from "@/hooks/sessions/files-panel/search-index";
import { useFilesPanelShortcuts } from "@/hooks/sessions/files-panel/shortcuts";
import { useFilesPanelState } from "@/hooks/sessions/files-panel/state";
import {
	useSessionFileBinaryContent,
	useSessionFileContent,
	useSessionFilePrefetch,
	useSessionFilesTree,
	useSessionWriteFile,
} from "@/hooks/sessions/use-session-files";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilesCodeEditor } from "./files-panel/code-editor";
import { getFileRenderKind, isJsonFile, isLikelyTextFile } from "./files-panel/file-types";
import { FilesTree } from "./files-panel/files-tree";
import { FilesGlobalSearch } from "./files-panel/global-search";
import { PanelShell } from "./panel-shell";

interface FilesPanelProps {
	sessionId: string;
	activityTick?: number;
}

const MAX_SEARCH_FILES = 160;
const MAX_SEARCH_FILE_SIZE = 1_000_000;
const FILES_PANEL_LEFT_MIN = 18;
const FILES_PANEL_RIGHT_MIN = 25;
const FILES_PANEL_LEFT_MAX = 100 - FILES_PANEL_RIGHT_MIN;

export function FilesPanel({ sessionId, activityTick = 0 }: FilesPanelProps) {
	const queryClient = useQueryClient();
	const writeFile = useSessionWriteFile(sessionId);
	const { canFetch: canPrefetchSearchContent, prefetchFileContent } =
		useSessionFilePrefetch(sessionId);
	const [filePathQuery, setFilePathQuery] = useState("");
	const filesPanelRootRef = useRef<HTMLDivElement>(null);

	const {
		sidebarTab,
		setSidebarTab,
		currentFile,
		setCurrentFile,
		openTabs,
		openFile,
		closeTab,
		expandedDirs,
		toggleDir,
		searchQuery,
		setSearchQuery,
		expandedSearchFiles,
		setExpandedSearchFiles,
		pendingChanges,
		setDraft,
		discardDraft,
		dirtyPaths,
		targetFileLineRange,
		clearTargetFileRange,
	} = useFilesPanelState();
	const fileRenderKind = currentFile ? getFileRenderKind(currentFile) : "text";

	const {
		data: currentFileData,
		isLoading: isCurrentFileLoading,
		error: currentFileReadError,
	} = useSessionFileContent(sessionId, currentFile, fileRenderKind === "text");
	const { data: currentBinaryFileData, error: currentBinaryFileError } =
		useSessionFileBinaryContent(
			sessionId,
			currentFile,
			fileRenderKind === "image" || fileRenderKind === "binary",
		);
	const { data: searchTreeData } = useSessionFilesTree(sessionId, ".", 6, sidebarTab === "search");
	const { initialSplitSizes, handleLayoutChanged } = useFilesPanelLayout({
		storageKey: "files-panel-split-v1",
		defaultSizes: [32, 68],
		leftMin: FILES_PANEL_LEFT_MIN,
		leftMax: FILES_PANEL_LEFT_MAX,
		layoutId: "files-panel-sidebar",
	});
	const { searchContentByPath } = useFilesPanelSearchIndex({
		sidebarTab,
		searchQuery,
		entries: searchTreeData?.entries,
		queryClient,
		canPrefetchSearchContent,
		maxSearchFiles: MAX_SEARCH_FILES,
		maxSearchFileSize: MAX_SEARCH_FILE_SIZE,
		isLikelyTextFile,
		prefetchFileContent,
	});

	const currentContent =
		(currentFile && pendingChanges[currentFile]) ??
		currentFileData?.content ??
		(currentFile ? "" : "Select a file to view.");

	const isCurrentFileDirty = currentFile ? dirtyPaths.has(currentFile) : false;
	const readErrorMessage = currentFile
		? fileRenderKind === "text"
			? currentFileReadError instanceof Error
				? currentFileReadError.message
				: null
			: currentBinaryFileError instanceof Error
				? currentBinaryFileError.message
				: null
		: null;
	const saveErrorMessage =
		writeFile.error instanceof Error
			? writeFile.error.message
			: writeFile.error
				? "Write failed"
				: null;
	const jsonDiagnosticMessage = useMemo(() => {
		if (!currentFile || !isJsonFile(currentFile)) return null;
		if (fileRenderKind !== "text") return null;
		try {
			JSON.parse(currentContent);
			return null;
		} catch (error) {
			return error instanceof Error ? `JSON parse error: ${error.message}` : "Invalid JSON";
		}
	}, [currentContent, currentFile, fileRenderKind]);
	const currentImageDataUrl =
		fileRenderKind === "image" && currentBinaryFileData
			? `data:${currentBinaryFileData.mimeType};base64,${currentBinaryFileData.base64}`
			: null;

	const handleRefresh = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ["fs-tree", sessionId] });
		queryClient.invalidateQueries({ queryKey: ["file-read", sessionId] });
		queryClient.invalidateQueries({ queryKey: ["file-read-binary", sessionId] });
	}, [queryClient, sessionId]);

	useEffect(() => {
		if (activityTick === 0) return;
		queryClient.invalidateQueries({ queryKey: ["fs-tree", sessionId] });
		queryClient.invalidateQueries({ queryKey: ["file-read-binary", sessionId] });
		for (const path of openTabs) {
			if (!dirtyPaths.has(path)) {
				queryClient.invalidateQueries({ queryKey: ["file-read", sessionId, path] });
			}
		}
	}, [activityTick, dirtyPaths, openTabs, queryClient, sessionId]);

	const closeCurrentTab = useCallback(() => {
		if (!currentFile) return;
		closeTab(currentFile);
	}, [closeTab, currentFile]);

	useFilesPanelShortcuts({
		setSidebarTab,
		currentFile,
		closeCurrentTab,
		rootRef: filesPanelRootRef,
	});

	const saveCurrentFile = useCallback(async () => {
		if (!currentFile) return;
		const draft = pendingChanges[currentFile];
		if (typeof draft !== "string") return;
		await writeFile.mutateAsync({ path: currentFile, content: draft });
		discardDraft(currentFile);
		queryClient.invalidateQueries({ queryKey: ["file-read", sessionId, currentFile] });
		queryClient.invalidateQueries({ queryKey: ["fs-tree", sessionId] });
	}, [currentFile, discardDraft, pendingChanges, queryClient, sessionId, writeFile]);

	const discardCurrentFileChanges = useCallback(() => {
		if (!currentFile) return;
		discardDraft(currentFile);
	}, [currentFile, discardDraft]);

	const sidebar = (
		<div className="flex h-full min-h-0 w-full flex-col border-r border-border/60">
			<Tabs
				value={sidebarTab}
				onValueChange={(value) =>
					value === "files" || value === "search" ? setSidebarTab(value) : undefined
				}
			>
				<TabsList className="m-2 grid h-8 w-auto grid-cols-2">
					<TabsTrigger value="files" className="text-xs">
						Files
					</TabsTrigger>
					<TabsTrigger value="search" className="text-xs">
						<Search className="mr-1 h-3.5 w-3.5" />
						Search
					</TabsTrigger>
				</TabsList>
			</Tabs>
			{sidebarTab === "files" ? (
				<>
					<div className="px-2 pb-2">
						<Input
							value={filePathQuery}
							onChange={(event) => setFilePathQuery(event.target.value.trim().toLowerCase())}
							placeholder="Filter file paths..."
							className="h-8 text-xs"
						/>
					</div>
					<FilesTree
						sessionId={sessionId}
						expandedDirs={expandedDirs}
						currentFile={currentFile}
						pathQuery={filePathQuery}
						onToggleDir={toggleDir}
						onSelectFile={(path) => {
							openFile(path);
							setSidebarTab("files");
						}}
					/>
				</>
			) : (
				<FilesGlobalSearch
					query={searchQuery}
					onQueryChange={setSearchQuery}
					expandedFilePaths={expandedSearchFiles}
					skippedMessage={`Skipping non-text and files larger than ${Math.floor(MAX_SEARCH_FILE_SIZE / 1_000_000)}MB.`}
					onToggleExpanded={(path) =>
						setExpandedSearchFiles((prev) => {
							const next = new Set(prev);
							if (next.has(path)) next.delete(path);
							else next.add(path);
							return next;
						})
					}
					contentByPath={searchContentByPath}
					onOpenResult={(path, line) => {
						openFile(path, { filePath: path, startLine: line, endLine: line });
						setSidebarTab("files");
					}}
				/>
			)}
		</div>
	);

	const panelActions = (
		<>
			{writeFile.isPending && (
				<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh}>
						<RefreshCw className="h-3.5 w-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Refresh files</TooltipContent>
			</Tooltip>
		</>
	);

	return (
		<PanelShell title="Files" noPadding actions={panelActions}>
			<div className="h-full" ref={filesPanelRootRef}>
				<ResizablePanelGroup
					orientation="horizontal"
					className="h-full"
					onLayoutChanged={handleLayoutChanged}
				>
					<ResizablePanel
						id="files-panel-sidebar"
						defaultSize={initialSplitSizes[0]}
						minSize={FILES_PANEL_LEFT_MIN}
						maxSize={FILES_PANEL_LEFT_MAX}
					>
						{sidebar}
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel
						id="files-panel-editor"
						defaultSize={initialSplitSizes[1]}
						minSize={FILES_PANEL_RIGHT_MIN}
					>
						<div className="min-h-0 min-w-0 flex-1">
							<FilesCodeEditor
								currentFile={currentFile}
								openTabs={openTabs}
								isLoadingCurrentFile={isCurrentFileLoading}
								currentContent={currentContent}
								isCurrentFileDirty={isCurrentFileDirty}
								fileRenderKind={fileRenderKind}
								imageDataUrl={currentImageDataUrl}
								readError={readErrorMessage}
								saveError={saveErrorMessage}
								diagnosticMessage={jsonDiagnosticMessage}
								targetFileLineRange={targetFileLineRange}
								readOnly={false}
								onSelectTab={setCurrentFile}
								onCloseTab={closeTab}
								onChange={(path, value) => setDraft(path, value)}
								onSaveCurrent={saveCurrentFile}
								onDiscardCurrent={discardCurrentFileChanges}
								onLineHighlightDone={clearTargetFileRange}
							/>
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</PanelShell>
	);
}
