"use client";

import { Button } from "@/components/ui/button";
import { baseExtensions } from "@/config/code-editor";
import type { TargetFileLineRange } from "@/hooks/sessions/files-panel/state";
import { cn } from "@/lib/display/utils";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { Loader2, X } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FileRenderKind } from "./file-types";
import { clearLineRangeHighlight, highlightLineRangeAndScroll } from "./line-highlight";

function editorTheme(isDark: boolean): Extension {
	return EditorView.theme({
		"&": {
			height: "100%",
			backgroundColor: "hsl(var(--background))",
			color: "hsl(var(--foreground))",
			fontFamily: "var(--font-geist-mono, monospace)",
		},
		".cm-scroller": {
			overflow: "auto",
		},
		".cm-content": {
			caretColor: "hsl(var(--foreground))",
		},
		".cm-gutters": {
			backgroundColor: "hsl(var(--muted) / 0.45)",
			color: "hsl(var(--muted-foreground))",
			borderRight: "1px solid hsl(var(--border))",
		},
		".cm-activeLine": {
			backgroundColor: "hsl(var(--accent) / 0.2)",
		},
		".cm-activeLineGutter": {
			backgroundColor: "hsl(var(--accent) / 0.2)",
		},
		".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
			backgroundColor: isDark ? "hsl(var(--accent) / 0.35)" : "hsl(var(--accent) / 0.4)",
		},
	});
}

export interface FilesCodeEditorProps {
	currentFile: string | null;
	openTabs: string[];
	isLoadingCurrentFile: boolean;
	currentContent: string;
	isCurrentFileDirty: boolean;
	fileRenderKind: FileRenderKind;
	imageDataUrl: string | null;
	readError: string | null;
	saveError: string | null;
	diagnosticMessage: string | null;
	targetFileLineRange: TargetFileLineRange | null;
	readOnly: boolean;
	onSelectTab: (path: string) => void;
	onCloseTab: (path: string) => void;
	onChange: (path: string, value: string) => void;
	onSaveCurrent: () => void;
	onDiscardCurrent: () => void;
	onLineHighlightDone: () => void;
}

export function FilesCodeEditor({
	currentFile,
	openTabs,
	isLoadingCurrentFile,
	currentContent,
	isCurrentFileDirty,
	fileRenderKind,
	imageDataUrl,
	readError,
	saveError,
	diagnosticMessage,
	targetFileLineRange,
	readOnly,
	onSelectTab,
	onCloseTab,
	onChange,
	onSaveCurrent,
	onDiscardCurrent,
	onLineHighlightDone,
}: FilesCodeEditorProps) {
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme === "dark";
	const editorViewRef = useRef<EditorView | null>(null);

	const extensions = useMemo(() => [...baseExtensions, editorTheme(isDark)], [isDark]);

	const handleCreateEditor = useCallback(
		(view: EditorView) => {
			editorViewRef.current = view;
			if (targetFileLineRange?.filePath === currentFile) {
				highlightLineRangeAndScroll(
					view,
					targetFileLineRange.startLine,
					targetFileLineRange.endLine ?? targetFileLineRange.startLine,
				);
				onLineHighlightDone();
			}
		},
		[currentFile, onLineHighlightDone, targetFileLineRange],
	);

	useEffect(() => {
		const editor = editorViewRef.current;
		if (!editor) return;

		if (!targetFileLineRange || targetFileLineRange.filePath !== currentFile) {
			clearLineRangeHighlight(editor);
			return;
		}

		highlightLineRangeAndScroll(
			editor,
			targetFileLineRange.startLine,
			targetFileLineRange.endLine ?? targetFileLineRange.startLine,
		);
		onLineHighlightDone();
	}, [currentFile, onLineHighlightDone, targetFileLineRange]);

	if (!currentFile) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Select a file to open it in the editor.
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="border-b border-border/60 bg-background">
				<div className="flex h-9 items-center overflow-x-auto">
					{openTabs.map((tabPath) => {
						const isActive = tabPath === currentFile;
						return (
							<div
								key={tabPath}
								className={cn(
									"group flex h-full min-w-0 max-w-72 items-center gap-1 border-r border-border/60 pl-1",
									isActive
										? "bg-muted/60 text-foreground"
										: "text-muted-foreground hover:bg-muted/40",
								)}
							>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => onSelectTab(tabPath)}
									className={cn(
										"h-7 min-w-0 flex-1 justify-start rounded-sm px-2 text-xs font-normal",
										isActive
											? "text-foreground hover:bg-transparent"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<span className="truncate">{tabPath}</span>
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => onCloseTab(tabPath)}
									className={cn(
										"h-6 w-6 rounded-sm text-muted-foreground transition-opacity",
										isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
									)}
									aria-label={`Close ${tabPath}`}
								>
									<X className="h-3.5 w-3.5" />
								</Button>
							</div>
						);
					})}
				</div>
				<div className="flex h-8 items-center justify-between border-t border-border/60 px-2">
					<span className="truncate text-[11px] text-muted-foreground">{currentFile}</span>
					{isCurrentFileDirty && (
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[11px]"
								onClick={onDiscardCurrent}
							>
								Discard
							</Button>
							<Button size="sm" className="h-6 px-2 text-[11px]" onClick={onSaveCurrent}>
								Save
							</Button>
						</div>
					)}
				</div>
			</div>
			<div className="min-h-0 flex-1 bg-background">
				{(readError || saveError || diagnosticMessage) && (
					<div className="border-b border-border/60 px-3 py-2 text-[11px]">
						{readError && <p className="text-destructive">Read failed: {readError}</p>}
						{saveError && <p className="text-destructive">Save failed: {saveError}</p>}
						{diagnosticMessage && <p className="text-warning">{diagnosticMessage}</p>}
					</div>
				)}
				{isLoadingCurrentFile ? (
					<div className="flex h-full items-center justify-center">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : fileRenderKind === "image" ? (
					imageDataUrl ? (
						<div className="flex h-full items-center justify-center bg-muted/20 p-3">
							<img
								src={imageDataUrl}
								alt={currentFile}
								className="max-h-full max-w-full rounded-md"
							/>
						</div>
					) : (
						<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
							Image preview unavailable.
						</div>
					)
				) : fileRenderKind === "binary" ? (
					<div className="flex h-full items-center justify-center p-6 text-center">
						<div className="space-y-2">
							<p className="text-sm font-medium">Binary file</p>
							<p className="text-xs text-muted-foreground">
								This file type is not rendered in the code editor.
							</p>
						</div>
					</div>
				) : (
					<CodeMirror
						key={currentFile}
						value={currentContent}
						readOnly={readOnly}
						theme={isDark ? "dark" : "light"}
						extensions={extensions}
						onCreateEditor={handleCreateEditor}
						onChange={(value) => onChange(currentFile, value)}
						className="h-full"
					/>
				)}
			</div>
		</div>
	);
}
