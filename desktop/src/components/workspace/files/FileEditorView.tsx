import { useCallback, useEffect } from "react";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import { Button } from "@/components/ui/Button";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { useResolvedMode } from "@/hooks/theme/use-theme";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { resolveReadableCodeFontScale } from "@/lib/domain/preferences/appearance";
import {
  proliferateDarkTheme,
  proliferateLightTheme,
  THEME_NAME_DARK,
  THEME_NAME_LIGHT,
} from "@/lib/infra/monaco-theme";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescriptreact",
    js: "javascript", jsx: "javascriptreact",
    rs: "rust", py: "python", go: "go",
    json: "json", toml: "toml", yaml: "yaml", yml: "yaml",
    md: "markdown", mdx: "markdown",
    css: "css", scss: "scss", html: "html",
    sql: "sql", sh: "shell", bash: "shell",
    xml: "xml", svg: "xml",
  };
  return map[ext] ?? "plaintext";
}

interface FileEditorViewProps {
  filePath: string;
}

export function FileEditorView({ filePath }: FileEditorViewProps) {
  const buffersByPath = useWorkspaceFilesStore((s) => s.buffersByPath);
  const updateBuffer = useWorkspaceFilesStore((s) => s.updateBuffer);
  const { saveFile, reloadFile } = useWorkspaceFileActions();

  const resolvedMode = useResolvedMode();
  const readableCodeFontSizeId = useUserPreferencesStore((s) => s.readableCodeFontSizeId);
  const readableCodeScale = resolveReadableCodeFontScale(readableCodeFontSizeId);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monaco.editor.defineTheme(THEME_NAME_DARK, proliferateDarkTheme);
    monaco.editor.defineTheme(THEME_NAME_LIGHT, proliferateLightTheme);
  }, []);

  const buf = buffersByPath[filePath];

  useEffect(() => {
    if (!buf) {
      void reloadFile(filePath);
    }
  }, [buf, filePath, reloadFile]);

  const handleSaveShortcut = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (buf?.isDirty) {
          saveFile(filePath);
        }
      }
    },
    [filePath, buf?.isDirty, saveFile],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [handleSaveShortcut]);

  if (!buf || buf.loadState === "loading") {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingState message="Loading file" subtext={filePath.split("/").pop()} />
      </div>
    );
  }

  if (buf.loadState === "error") {
    return <CenterMessage message={`Error: ${buf.lastError ?? "Failed to load file"}`} />;
  }

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        {buf.tooLarge ? (
          <CenterMessage message={`${filePath} is too large to edit`} />
        ) : !buf.isText ? (
          <CenterMessage message={`${filePath} is a binary file and cannot be edited`} />
        ) : (
          <Editor
            language={inferLanguage(filePath)}
            value={buf.localContent ?? ""}
            onChange={(value) => {
              if (value !== undefined) {
                updateBuffer(filePath, value);
              }
            }}
            beforeMount={handleBeforeMount}
            theme={resolvedMode === "dark" ? THEME_NAME_DARK : THEME_NAME_LIGHT}
            options={{
              minimap: { enabled: false },
              fontSize: readableCodeScale.monacoFontSize,
              lineHeight: readableCodeScale.monacoLineHeight,
              fontFamily: "'Geist Mono', monospace",
              fontLigatures: false,
              padding: { top: 0 },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2,
              renderLineHighlight: "line",
              lineNumbersMinChars: 3,
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

      {/* Conflict banner */}
      {buf.saveState === "conflict" && (
        <div className="flex items-center justify-between px-3 py-2 bg-destructive/10 border-t border-destructive/20 shrink-0">
          <span className="text-xs text-destructive">
            File changed on disk. Your local changes are preserved.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => reloadFile(filePath)}
            className="ml-2 h-auto shrink-0 bg-transparent p-0 text-xs text-destructive hover:bg-transparent hover:underline"
          >
            Reload from disk
          </Button>
        </div>
      )}
    </div>
  );
}

function CenterMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
