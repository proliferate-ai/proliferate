import type { ReadWorkspaceFileResponse } from "@anyharness/sdk";
import Editor, {
  type BeforeMount,
  type OnMount,
} from "@monaco-editor/react";
import type {
  PointerEventHandler,
  RefObject,
} from "react";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { Button } from "@/components/ui/Button";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { CenterMessage } from "@/components/workspace/files/viewer/CenterMessage";
import { FileDiffPane } from "@/components/workspace/files/viewer/FileDiffPane";
import type { FileDiffTarget } from "@/lib/domain/workspaces/viewer/file-diff-options";
import { inferWorkspaceFileLanguage } from "@/lib/domain/workspaces/viewer/file-language";
import type { FileViewerMode } from "@/lib/domain/workspaces/viewer/viewer-target";
import {
  THEME_NAME_LIGHT,
  THEME_NAME_DARK,
} from "@/lib/infra/editor/monaco-theme";
import type { WorkspaceFileBuffer } from "@/stores/editor/workspace-file-buffers-store";

interface FileEditorContentProps {
  filePath: string;
  workspaceId: string | null;
  effectiveMode: FileViewerMode;
  read: ReadWorkspaceFileResponse | undefined;
  buffer: WorkspaceFileBuffer | undefined;
  activeDiffTarget: FileDiffTarget | null;
  diffLayout: "unified" | "split";
  canShowMarkdownPreview: boolean;
  resolvedMode: "dark" | "light";
  monacoFontSize: number;
  monacoLineHeight: number;
  viewerContentRef: RefObject<HTMLDivElement | null>;
  onContentPointerDownCapture: PointerEventHandler<HTMLDivElement>;
  onUpdateBuffer: (path: string, content: string) => void;
  onReloadFile: (path: string) => void | Promise<void>;
  onBeforeMount: BeforeMount;
  onEditorMount: OnMount;
}

export function FileEditorContent({
  filePath,
  workspaceId,
  effectiveMode,
  read,
  buffer,
  activeDiffTarget,
  diffLayout,
  canShowMarkdownPreview,
  resolvedMode,
  monacoFontSize,
  monacoLineHeight,
  viewerContentRef,
  onContentPointerDownCapture,
  onUpdateBuffer,
  onReloadFile,
  onBeforeMount,
  onEditorMount,
}: FileEditorContentProps) {
  return (
    <>
      <div
        ref={viewerContentRef}
        onPointerDownCapture={onContentPointerDownCapture}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {effectiveMode === "diff" && activeDiffTarget ? (
          <FileDiffPane
            workspaceId={workspaceId}
            target={activeDiffTarget}
            layout={diffLayout}
          />
        ) : !read ? (
          <div className="flex items-center justify-center h-full">
            <LoadingState message="Loading file" subtext={filePath.split("/").pop()} />
          </div>
        ) : read.tooLarge ? (
          <CenterMessage message={`${filePath} is too large to edit`} />
        ) : !read.isText ? (
          <CenterMessage message={`${filePath} is a binary file and cannot be edited`} />
        ) : effectiveMode === "rendered" && canShowMarkdownPreview ? (
          <div className="h-full overflow-auto px-8 py-6">
            <MarkdownRenderer content={buffer?.localContent ?? read.content ?? ""} />
          </div>
        ) : (
          <Editor
            height="100%"
            language={inferWorkspaceFileLanguage(filePath)}
            value={buffer?.localContent ?? read.content ?? ""}
            onChange={(value) => {
              if (value !== undefined) {
                onUpdateBuffer(filePath, value);
              }
            }}
            beforeMount={onBeforeMount}
            onMount={onEditorMount}
            theme={resolvedMode === "dark" ? THEME_NAME_DARK : THEME_NAME_LIGHT}
            options={{
              minimap: { enabled: false },
              fontSize: monacoFontSize,
              lineHeight: monacoLineHeight,
              fontFamily: "'Geist Mono', monospace",
              fontLigatures: false,
              padding: { top: 0 },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2,
              renderLineHighlight: "line",
              lineNumbersMinChars: 7,
              glyphMargin: false,
              folding: true,
              foldingHighlight: false,
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
              renderWhitespace: "none",
            }}
          />
        )}
      </div>

      {buffer?.saveState === "conflict" && (
        <div className="flex items-center justify-between px-3 py-2 bg-destructive/10 border-t border-destructive/20 shrink-0">
          <span className="text-xs text-destructive">
            File changed on disk. Your local changes are preserved.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onReloadFile(filePath)}
            className="ml-2 h-auto shrink-0 bg-transparent p-0 text-xs text-destructive hover:bg-transparent hover:underline"
          >
            Reload from disk
          </Button>
        </div>
      )}
    </>
  );
}
