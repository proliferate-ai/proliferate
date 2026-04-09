import { useCallback } from "react";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { Copy, ExternalLink } from "@/components/ui/icons";
import { useOpenInDefaultEditor } from "@/hooks/editor/use-open-in-default-editor";
import { useWorkspacePath } from "@/providers/WorkspacePathProvider";

interface ToolFileChipProps {
  basename: string;
  pathLabel: string;
  /** Workspace-relative path. When null, the chip renders non-interactively. */
  workspacePath: string | null;
}

/**
 * File chip used in tool-call headers (`Read`, `Edited`, etc.).
 *
 * Behavior matches `FilePathLink`:
 *  - Click → open in user's configured external editor.
 *  - Right-click (context menu) → `Open file` / `Copy path`.
 *
 * Visual is intentionally a chip (border + background + file icon) so tool
 * results stay scannable; markdown prose uses the flat `FilePathLink` instead.
 */
export function ToolFileChip({
  basename,
  pathLabel,
  workspacePath,
}: ToolFileChipProps) {
  const { resolveAbsolute } = useWorkspacePath();
  const { openInDefaultEditor, copyPath } = useOpenInDefaultEditor();

  const absolute = workspacePath ? resolveAbsolute(workspacePath) : null;

  const handleOpen = useCallback(() => {
    if (!absolute) return;
    void openInDefaultEditor(absolute);
  }, [absolute, openInDefaultEditor]);

  const handleCopy = useCallback(() => {
    void copyPath(absolute ?? workspacePath ?? pathLabel);
  }, [absolute, workspacePath, pathLabel, copyPath]);

  const chipClass =
    "inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-sm border border-border/60 bg-muted/45 px-1 py-px font-mono text-sm leading-none text-foreground/90 transition-colors";

  const content = (
    <>
      <FileTreeEntryIcon
        name={basename}
        path={pathLabel}
        kind="file"
        className="size-2.5 shrink-0 text-muted-foreground"
      />
      <span className="truncate">{basename}</span>
    </>
  );

  if (!workspacePath) {
    return (
      <span title={pathLabel} className={chipClass}>
        {content}
      </span>
    );
  }

  const trigger = (
    <button
      type="button"
      title={pathLabel}
      onClick={(event) => {
        event.stopPropagation();
        handleOpen();
      }}
      className={`${chipClass} cursor-pointer hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border`}
    >
      {content}
    </button>
  );

  return (
    <PopoverButton
      trigger={trigger}
      triggerMode="contextMenu"
      stopPropagation
      className="w-52 rounded-lg border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <div className="flex flex-col gap-px">
          <button
            type="button"
            disabled={!absolute}
            onClick={() => {
              handleOpen();
              close();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground/80 transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-foreground/80"
          >
            <ExternalLink className="size-3.5 shrink-0" />
            <span>Open file</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleCopy();
              close();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground/80 transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            <Copy className="size-3.5 shrink-0" />
            <span>Copy path</span>
          </button>
        </div>
      )}
    </PopoverButton>
  );
}
