import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { FilePathContextMenuContent } from "@/components/ui/FilePathContextMenuContent";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { useFilePathNativeContextMenu } from "@/hooks/editor/ui/use-file-path-native-context-menu";
import { useOpenInDefaultEditor } from "@/hooks/editor/workflows/use-open-in-default-editor";
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
 *  - Right-click (context menu) → open/copy/reveal path actions.
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
  const {
    openInDefaultEditor,
    openTarget,
    revealInFinder,
    copyPath,
    targets,
  } = useOpenInDefaultEditor();

  const absolute = workspacePath ? resolveAbsolute(workspacePath) : null;
  const openTargets = useMemo(
    () => targets.filter((target) => target.id !== "finder" && target.id !== "copy-path"),
    [targets],
  );

  const handleOpen = useCallback(() => {
    if (!absolute) return;
    void openInDefaultEditor(absolute);
  }, [absolute, openInDefaultEditor]);

  const handleCopy = useCallback(() => {
    void copyPath(absolute ?? workspacePath ?? pathLabel);
  }, [absolute, workspacePath, pathLabel, copyPath]);
  const handleOpenTarget = useCallback((targetId: string) => {
    if (!absolute) return;
    void openTarget(targetId, absolute);
  }, [absolute, openTarget]);
  const handleRevealInFinder = useCallback(() => {
    if (!absolute) return;
    void revealInFinder(absolute);
  }, [absolute, revealInFinder]);
  const { onContextMenuCapture } = useFilePathNativeContextMenu({
    canOpen: !!absolute,
    targets: openTargets,
    onOpen: handleOpen,
    onOpenTarget: handleOpenTarget,
    onCopy: handleCopy,
    onRevealInFinder: handleRevealInFinder,
  });

  const chipClass =
    "inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-sm border border-border/60 bg-muted/45 px-1 py-px font-mono text-[0.625rem] leading-none text-foreground/90 transition-colors";

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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-chat-transcript-ignore
      title={pathLabel}
      onContextMenuCapture={onContextMenuCapture}
      onClick={(event) => {
        event.stopPropagation();
        handleOpen();
      }}
      className={`${chipClass} h-auto justify-start hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border`}
    >
      {content}
    </Button>
  );

  return (
    <PopoverButton
      trigger={trigger}
      triggerMode="contextMenu"
      stopPropagation
      className="w-52 rounded-lg border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <FilePathContextMenuContent
          canOpen={!!absolute}
          targets={openTargets}
          close={close}
          onOpenDefault={handleOpen}
          onOpenTarget={handleOpenTarget}
          onCopyPath={handleCopy}
          onRevealInFinder={handleRevealInFinder}
          ignoreChatTranscript
        />
      )}
    </PopoverButton>
  );
}
