import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { X } from "@/components/ui/icons";

export function WorkspaceEditorTabs() {
  const openTabs = useWorkspaceFilesStore((s) => s.openTabs);
  const activeFilePath = useWorkspaceFilesStore((s) => s.activeFilePath);
  const buffersByPath = useWorkspaceFilesStore((s) => s.buffersByPath);
  const setActiveTab = useWorkspaceFilesStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceFilesStore((s) => s.closeTab);

  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-center gap-0 border-b border-border overflow-x-auto shrink-0">
      {openTabs.map((path) => {
        const isActive = path === activeFilePath;
        const buf = buffersByPath[path];
        const isDirty = buf?.isDirty ?? false;
        const basename = path.split("/").pop() ?? path;

        return (
          <button
            key={path}
            type="button"
            onClick={() => setActiveTab(path)}
            className={`group inline-flex items-center gap-1.5 h-8 px-3 text-xs shrink-0 border-b-2 transition-colors ${
              isActive
                ? "text-foreground border-b-sidebar-foreground bg-background"
                : "text-muted-foreground border-b-transparent hover:text-foreground"
            }`}
          >
            <FileTreeEntryIcon
              name={basename}
              path={path}
              kind="file"
              className="size-3 shrink-0"
            />
            <span className="truncate max-w-[120px]">{basename}</span>
            {isDirty && (
              <span className="size-1.5 rounded-full bg-foreground/60 shrink-0" />
            )}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (isDirty && !confirm("Discard unsaved changes?")) return;
                closeTab(path);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  if (isDirty && !confirm("Discard unsaved changes?")) return;
                  closeTab(path);
                }
              }}
              className="ml-0.5 p-0.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-accent transition-opacity inline-flex items-center"
            >
              <X className="size-3 text-muted-foreground" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
