import { useCallback, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Copy, ExternalLink } from "@/components/ui/icons";
import { useFilePathNativeContextMenu } from "@/hooks/editor/use-file-path-native-context-menu";
import { useOpenInDefaultEditor } from "@/hooks/editor/use-open-in-default-editor";
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
 *  - Two-finger click (context menu) → popover with `Open file` and
 *    `Copy path`.
 *
 * Style: Codex-style local file/doc link in `text-link-foreground`, no pill,
 * no border, underline on hover only.
 */
export function FilePathLink({ rawPath, children }: FilePathLinkProps) {
  const { resolveAbsolute } = useWorkspacePath();
  const { openInDefaultEditor, copyPath } = useOpenInDefaultEditor();

  const { path: rawPathWithoutSuffix } = splitPathLineSuffix(rawPath);
  const absolute = resolveAbsolute(rawPathWithoutSuffix);

  const handleOpen = useCallback(() => {
    if (!absolute) return;
    void openInDefaultEditor(absolute);
  }, [absolute, openInDefaultEditor]);

  const handleCopy = useCallback(() => {
    void copyPath(absolute ?? rawPath);
  }, [absolute, rawPath, copyPath]);
  const { onContextMenuCapture } = useFilePathNativeContextMenu({
    canOpen: !!absolute,
    onOpen: handleOpen,
    onCopy: handleCopy,
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
      className="w-52 rounded-lg border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <div className="flex flex-col gap-px">
          <PopoverMenuItem
            icon={<ExternalLink className="size-3.5 shrink-0" />}
            label="Open file"
            disabled={!absolute}
            onClick={() => {
              handleOpen();
              close();
            }}
          />
          <PopoverMenuItem
            icon={<Copy className="size-3.5 shrink-0" />}
            label="Copy path"
            onClick={() => {
              handleCopy();
              close();
            }}
          />
        </div>
      )}
    </PopoverButton>
  );
}
