"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/display/utils";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useDebounce } from "use-debounce";

interface SearchMatch {
	line: number;
	column: number;
	lineContent: string;
	matchStart: number;
	matchEnd: number;
}

interface FileSearchResult {
	path: string;
	matches: SearchMatch[];
}

const CONTEXT_CHARS = 40;
const MAX_MATCHES_PER_FILE = 50;
const MAX_TOTAL_MATCHES = 500;

interface FilesGlobalSearchProps {
	query: string;
	onQueryChange: (query: string) => void;
	expandedFilePaths: Set<string>;
	skippedMessage?: string;
	onToggleExpanded: (path: string) => void;
	contentByPath: Record<string, string>;
	onOpenResult: (filePath: string, line: number) => void;
}

function highlightSlice(text: string, start: number, end: number) {
	const safeStart = Math.max(0, start);
	const safeEnd = Math.max(safeStart, end);
	const before = text.slice(0, safeStart);
	const match = text.slice(safeStart, safeEnd);
	const after = text.slice(safeEnd);
	return { before, match, after };
}

export function FilesGlobalSearch({
	query,
	onQueryChange,
	expandedFilePaths,
	skippedMessage,
	onToggleExpanded,
	contentByPath,
	onOpenResult,
}: FilesGlobalSearchProps) {
	const [debouncedQuery] = useDebounce(query, 250);

	const results = useMemo(() => {
		if (debouncedQuery.trim().length < 2) return [] as FileSearchResult[];

		const needle = debouncedQuery.toLowerCase();
		let totalMatches = 0;
		const output: FileSearchResult[] = [];

		for (const [path, content] of Object.entries(contentByPath)) {
			if (!content || totalMatches >= MAX_TOTAL_MATCHES) break;
			const lines = content.split("\n");
			const fileMatches: SearchMatch[] = [];

			for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				const line = lines[lineIndex];
				const lowerLine = line.toLowerCase();
				let column = 0;

				while (column < lowerLine.length && fileMatches.length < MAX_MATCHES_PER_FILE) {
					const index = lowerLine.indexOf(needle, column);
					if (index === -1) break;

					const contextStart = Math.max(0, index - CONTEXT_CHARS);
					const contextEnd = Math.min(line.length, index + needle.length + CONTEXT_CHARS);
					const rawSnippet = line.slice(contextStart, contextEnd);
					const snippet = rawSnippet.trim();
					const leadingOffset = rawSnippet.indexOf(snippet);

					fileMatches.push({
						line: lineIndex + 1,
						column: index + 1,
						lineContent: snippet,
						matchStart: index - contextStart - leadingOffset,
						matchEnd: index - contextStart - leadingOffset + needle.length,
					});

					totalMatches += 1;
					column = index + needle.length;
					if (totalMatches >= MAX_TOTAL_MATCHES) break;
				}
				if (totalMatches >= MAX_TOTAL_MATCHES) break;
			}

			if (fileMatches.length > 0) output.push({ path, matches: fileMatches });
		}

		return output;
	}, [contentByPath, debouncedQuery]);

	const totalMatches = results.reduce((count, fileResult) => count + fileResult.matches.length, 0);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="border-b border-border/60 p-2">
				<Input
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					placeholder="Search in loaded files..."
					className="h-8 text-xs"
				/>
				{debouncedQuery.length >= 2 && (
					<p className="mt-1 text-[11px] text-muted-foreground">
						{totalMatches} result{totalMatches === 1 ? "" : "s"} in {results.length} file
						{results.length === 1 ? "" : "s"}
					</p>
				)}
				{skippedMessage && (
					<p className="mt-0.5 text-[10px] text-muted-foreground">{skippedMessage}</p>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{debouncedQuery.length >= 2 &&
					results.map((result) => {
						const expanded = expandedFilePaths.has(result.path);
						return (
							<div key={result.path} className="border-b border-border/50">
								<Button
									variant="ghost"
									className="flex w-full items-center gap-1 px-2 py-1.5 h-auto rounded-none text-left text-xs hover:bg-muted/50"
									onClick={() => onToggleExpanded(result.path)}
								>
									<ChevronRight
										className={cn(
											"h-3 w-3 transition-transform duration-150",
											expanded && "rotate-90",
										)}
									/>
									<span className="truncate">{result.path}</span>
									<span className="ml-auto text-[10px] text-muted-foreground">
										{result.matches.length}
									</span>
								</Button>
								{expanded &&
									result.matches.map((match, index) => {
										const highlighted = highlightSlice(
											match.lineContent,
											match.matchStart,
											match.matchEnd,
										);
										return (
											<Button
												variant="ghost"
												key={`${result.path}:${match.line}:${match.column}:${index}`}
												className="flex w-full items-start gap-2 px-6 py-1 h-auto rounded-none text-left hover:bg-muted/40"
												onClick={() => onOpenResult(result.path, match.line)}
											>
												<span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
													{match.line}
												</span>
												<span className="flex-1 truncate font-mono text-[11px] text-foreground">
													{highlighted.before}
													<span className="bg-accent/70 px-0.5">{highlighted.match}</span>
													{highlighted.after}
												</span>
											</Button>
										);
									})}
							</div>
						);
					})}
				{debouncedQuery.length >= 2 && results.length === 0 && (
					<div className="p-3 text-xs text-muted-foreground">No results in loaded files.</div>
				)}
				{debouncedQuery.length < 2 && (
					<div className="p-3 text-xs text-muted-foreground">
						Type at least 2 characters to search.
					</div>
				)}
			</div>
		</div>
	);
}
