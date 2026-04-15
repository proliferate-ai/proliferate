import { useCallback, type ReactNode } from "react";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { Copy, ExternalLink } from "@/components/ui/icons";
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
 * Style: plain inline link in `text-link-foreground`, no pill, no border;
 * underline on hover only.
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

  const trigger = (
    <button
      type="button"
      onClick={handleOpen}
      title={absolute ?? rawPath}
      className="m-0 inline cursor-pointer border-0 bg-transparent p-0 align-baseline font-mono text-[inherit] leading-[inherit] text-link-foreground hover:underline focus-visible:outline-none focus-visible:underline"
    >
      {children ?? rawPath}
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
