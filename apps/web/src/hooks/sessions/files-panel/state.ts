"use client";

import { useCallback, useMemo, useState } from "react";

export type FilesSidebarTab = "files" | "search";

export interface TargetFileLineRange {
	filePath: string;
	startLine: number;
	endLine?: number;
}

export function useFilesPanelState() {
	const [sidebarTab, setSidebarTab] = useState<FilesSidebarTab>("files");
	const [currentFile, setCurrentFile] = useState<string | null>(null);
	const [openTabs, setOpenTabs] = useState<string[]>([]);
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(["."]));
	const [searchQuery, setSearchQuery] = useState("");
	const [expandedSearchFiles, setExpandedSearchFiles] = useState<Set<string>>(new Set());
	const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});
	const [targetFileLineRange, setTargetFileLineRange] = useState<TargetFileLineRange | null>(null);

	const openFile = useCallback((path: string, lineRange?: TargetFileLineRange) => {
		setCurrentFile(path);
		setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
		if (lineRange) {
			setTargetFileLineRange(lineRange);
		}
	}, []);

	const closeTab = useCallback((path: string) => {
		setOpenTabs((prev) => {
			const next = prev.filter((tabPath) => tabPath !== path);
			if (next.length === 0) {
				setCurrentFile(null);
				return next;
			}
			setCurrentFile((selected) => {
				if (selected !== path) return selected;
				const closedIndex = prev.indexOf(path);
				const fallbackIndex = Math.max(0, closedIndex - 1);
				return next[fallbackIndex] ?? next[0] ?? null;
			});
			return next;
		});
	}, []);

	const toggleDir = useCallback((path: string) => {
		setExpandedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);

	const setDraft = useCallback((path: string, content: string) => {
		setPendingChanges((prev) => ({ ...prev, [path]: content }));
	}, []);

	const discardDraft = useCallback((path: string) => {
		setPendingChanges((prev) => {
			if (!(path in prev)) return prev;
			const next = { ...prev };
			delete next[path];
			return next;
		});
	}, []);

	const clearTargetFileRange = useCallback(() => setTargetFileLineRange(null), []);

	const dirtyPaths = useMemo(() => new Set(Object.keys(pendingChanges)), [pendingChanges]);

	return {
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
		setTargetFileLineRange,
		clearTargetFileRange,
	};
}
