"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

interface FilesTreeEntry {
	type: string;
	path: string;
}

interface SearchableFileContent {
	content: string;
	size: number;
}

interface UseFilesPanelSearchIndexOptions {
	sidebarTab: "files" | "search";
	searchQuery: string;
	entries: FilesTreeEntry[] | undefined;
	queryClient: QueryClient;
	canPrefetchSearchContent: boolean;
	maxSearchFiles: number;
	maxSearchFileSize: number;
	isLikelyTextFile: (path: string) => boolean;
	prefetchFileContent: (
		queryClient: QueryClient,
		path: string,
	) => Promise<SearchableFileContent | null>;
}

export function useFilesPanelSearchIndex(options: UseFilesPanelSearchIndexOptions) {
	const [searchContentByPath, setSearchContentByPath] = useState<Record<string, string>>({});
	const searchContentByPathRef = useRef(searchContentByPath);
	searchContentByPathRef.current = searchContentByPath;

	useEffect(() => {
		if (options.sidebarTab !== "search") return;
		if (options.searchQuery.trim().length < 2) return;
		if (!options.canPrefetchSearchContent) return;

		const filePaths = (options.entries ?? [])
			.filter((entry) => entry.type === "file")
			.map((entry) => entry.path)
			.filter((path) => options.isLikelyTextFile(path))
			.slice(0, options.maxSearchFiles);

		if (filePaths.length === 0) return;

		let isCancelled = false;
		const hydrateSearchIndex = async () => {
			const unresolvedPaths = filePaths.filter((path) => !(path in searchContentByPathRef.current));
			const next: Record<string, string> = {};

			for (const path of unresolvedPaths) {
				try {
					const data = await options.prefetchFileContent(options.queryClient, path);
					if (!data || data.size > options.maxSearchFileSize) continue;
					if (!isCancelled) {
						next[path] = data.content;
					}
				} catch {
					// Ignore unreadable/binary files for search index.
				}
			}

			if (isCancelled) return;
			setSearchContentByPath((previous) => {
				const merged = { ...previous, ...next };
				const bounded: Record<string, string> = {};
				for (const path of filePaths) {
					const content = merged[path];
					if (typeof content === "string") {
						bounded[path] = content;
					}
				}
				return bounded;
			});
		};

		hydrateSearchIndex().catch(() => undefined);
		return () => {
			isCancelled = true;
		};
	}, [
		options.canPrefetchSearchContent,
		options.entries,
		options.isLikelyTextFile,
		options.maxSearchFileSize,
		options.maxSearchFiles,
		options.prefetchFileContent,
		options.queryClient,
		options.searchQuery,
		options.sidebarTab,
	]);

	return {
		searchContentByPath,
	};
}
