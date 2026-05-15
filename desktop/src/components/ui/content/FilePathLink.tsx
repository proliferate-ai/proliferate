import { useCallback, useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { FilePathContextMenuContent } from "@/components/ui/FilePathContextMenuContent";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@/components/ui/PopoverButton";
import { useFilePathNativeContextMenu } from "@/hooks/editor/ui/use-file-path-native-context-menu";
import { useOpenInDefaultEditor } from "@/hooks/editor/workflows/use-open-in-default-editor";
import { useWorkspacePath } from "@/providers/WorkspacePathProvider";
import { splitPathLineSuffix } from "@/lib/domain/files/path-detection";

interface FilePathLinkProps {
  /**
   * Raw path string as it appeared in the source. May be relative,
   * absolute, or carry an optional `:line[:col]` suffix.
   */
  rawPath: string;
  /** Optional override for displayed text. Defaults to `rawPath`. */
  children?: ReactNode;
}

/**
 * Inline file-path link rendered in chat markdown and tool-call output.
 *
 * Behavior (matches the rest of the app's "open in editor" flow):
 *  - One-finger click → open in user's configured default editor.
 *  - Two-finger click (context menu) → open/copy/reveal path actions.
 *
 * Style: Codex-style local file/doc link in `text-link-foreground`, no pill,
 * no border, underline on hover only.
 */
export function FilePathLink({ rawPath, children }: FilePathLinkProps) {
  const { resolveAbsolute } = useWorkspacePath();
  const {
    openInDefaultEditor,
    openTarget,
    revealInFinder,
    copyPath,
    targets,
  } = useOpenInDefaultEditor();

  const { path: rawPathWithoutSuffix } = splitPathLineSuffix(rawPath);
  const absolute = resolveAbsolute(rawPathWithoutSuffix);
  const openTargets = useMemo(
    () => targets.filter((target) => target.id !== "finder" && target.id !== "copy-path"),
    [targets],
  );

  const handleOpen = useCallback(() => {
    if (!absolute) return;
    void openInDefaultEditor(absolute);
  }, [absolute, openInDefaultEditor]);

  const handleCopy = useCallback(() => {
    void copyPath(absolute ?? rawPath);
  }, [absolute, rawPath, copyPath]);
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

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="unstyled"
      onClick={handleOpen}
      onContextMenuCapture={onContextMenuCapture}
      title={absolute ?? rawPath}
      className="m-0 inline-block h-auto max-w-full whitespace-normal break-words border-0 bg-transparent p-0 text-left align-baseline font-[inherit] leading-[inherit] text-link-foreground shadow-none hover:bg-transparent hover:text-link-foreground hover:underline focus-visible:outline-none focus-visible:underline"
    >
      {children ?? rawPath}
    </Button>
  );

  return (
    <PopoverButton
      trigger={trigger}
      triggerMode="contextMenu"
      stopPropagation
      className={`w-52 ${POPOVER_SURFACE_CLASS}`}
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
        />
      )}
    </PopoverButton>
  );
}
