import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { Button } from "@/components/ui/Button";
import { X } from "@/components/ui/icons";
import { useTransparentChromeEnabled } from "@/hooks/theme/use-transparent-chrome";

const GLASS_TABLIST_CLASS =
  "flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b border-foreground/10 bg-card/25 px-1 pt-1 backdrop-blur-md supports-[backdrop-filter]:bg-card/20";
const SOLID_TABLIST_CLASS =
  "flex h-9 shrink-0 items-end gap-1 overflow-x-auto px-1 pt-1";

export function WorkspaceEditorTabs() {
  const openTabs = useWorkspaceFilesStore((s) => s.openTabs);
  const activeFilePath = useWorkspaceFilesStore((s) => s.activeFilePath);
  const buffersByPath = useWorkspaceFilesStore((s) => s.buffersByPath);
  const setActiveTab = useWorkspaceFilesStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceFilesStore((s) => s.closeTab);
  const transparentChromeEnabled = useTransparentChromeEnabled();

  if (openTabs.length === 0) return null;

  function closeFileTab(path: string, isDirty: boolean) {
    if (isDirty && !confirm("Discard unsaved changes?")) {
      return;
    }

    closeTab(path);
  }

  return (
    <div
      role="tablist"
      aria-label="Open files"
      className={transparentChromeEnabled ? GLASS_TABLIST_CLASS : SOLID_TABLIST_CLASS}
    >
      {openTabs.map((path) => {
        const isActive = path === activeFilePath;
        const buf = buffersByPath[path];
        const isDirty = buf?.isDirty ?? false;
        const basename = path.split("/").pop() ?? path;
        const shapeClassName = transparentChromeEnabled ? "-mb-px rounded-t-md" : "rounded-md";
        const activeClassName = transparentChromeEnabled
          ? "border-foreground/10 border-b-background bg-background/85 text-foreground shadow-subtle backdrop-blur-xl"
          : "border-border bg-background text-foreground shadow-subtle";

        return (
          <div
            key={path}
            role="presentation"
            className={`group/tab flex h-8 min-w-0 max-w-48 shrink-0 items-center border px-0.5 transition-colors ${shapeClassName} ${
              isActive
                ? activeClassName
                : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            }`}
          >
            <Button
              type="button"
              role="tab"
              aria-selected={isActive}
              title={path}
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(path)}
              className={`h-full min-w-0 flex-1 justify-start gap-1.5 bg-transparent px-2 py-0 text-xs font-normal hover:bg-transparent ${shapeClassName} ${
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileTreeEntryIcon
                name={basename}
                path={path}
                kind="file"
                className="size-3 shrink-0"
              />
              <span className="min-w-0 truncate">{basename}</span>
              {isDirty && (
                <span className="size-1.5 shrink-0 rounded-full bg-foreground/60" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => closeFileTab(path, isDirty)}
              title={`Close ${basename}`}
              aria-label={`Close ${basename}`}
              className={`mr-1 size-5 shrink-0 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground ${
                isActive
                  ? "opacity-70 hover:opacity-100"
                  : "opacity-0 transition-opacity group-hover/tab:opacity-70 hover:!opacity-100 focus-visible:opacity-100"
              }`}
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
