import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";

export function WorkspaceEditorToolbar() {
  const activeFilePath = useWorkspaceFilesStore((s) => s.activeFilePath);
  const buffersByPath = useWorkspaceFilesStore((s) => s.buffersByPath);
  const { saveFile, reloadFile } = useWorkspaceFileActions();

  if (!activeFilePath) return null;
  const buf = buffersByPath[activeFilePath];
  if (!buf) return null;

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 shrink-0">
      <span className="text-[11px] text-muted-foreground truncate min-w-0 flex-1">
        {activeFilePath}
      </span>

      <div className="flex items-center gap-2 shrink-0 ml-2">
        {buf.tooLarge && (
          <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">Too large</span>
        )}
        {!buf.isText && !buf.tooLarge && (
          <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">Binary</span>
        )}
        {buf.isDirty && (
          <span className="text-[10px] text-foreground bg-muted/50 px-1.5 py-0.5 rounded">Unsaved</span>
        )}
        {buf.saveState === "conflict" && (
          <span className="text-[10px] text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">Conflict</span>
        )}

        {buf.isText && !buf.tooLarge && (
          <>
            <button
              onClick={() => reloadFile(activeFilePath)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Reload
            </button>
            <button
              onClick={() => saveFile(activeFilePath)}
              disabled={!buf.isDirty || buf.saveState === "saving"}
              className="text-[11px] text-foreground hover:underline disabled:opacity-40 disabled:cursor-default transition-colors"
            >
              {buf.saveState === "saving" ? "Saving..." : "Save"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
