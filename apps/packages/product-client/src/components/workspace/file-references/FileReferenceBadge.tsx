import {
  type MouseEvent,
  type ReactNode,
  useCallback,
} from "react";
import { Button } from "#product/primitives/Button";
import { FileTreeEntryIcon } from "#product/components/workspace/files/file-icons";
import { InlinePathMentionIcon } from "#product/primitives/icons/workspace";
import { CHAT_TRANSCRIPT_LINK_CLASS } from "#product/config/transcript-link-styles";
import { PopoverButton } from "#product/primitives/PopoverButton";
import {
  FILE_REFERENCE_MENU_CLASS,
  FileReferenceMenuContent,
} from "#product/components/workspace/file-references/FileReferenceMenu";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";
import { useFileReferenceNativeContextMenu } from "#product/hooks/workspaces/ui/files/use-file-reference-native-context-menu";
import { getFileVisual } from "#product/lib/domain/files/file-visuals";
import {
  fileReferenceBasename,
  inlineFileReferenceLabel,
} from "#product/lib/domain/files/path-references";

type FileReferenceBadgeVariant = "inline" | "chip";

interface FileReferenceBadgeProps {
  rawPath: string;
  label?: ReactNode;
  basename?: string;
  workspacePath?: string | null;
  variant?: FileReferenceBadgeVariant;
  stopPropagation?: boolean;
  className?: string;
}

export function FileReferenceBadge({
  rawPath,
  label,
  basename,
  workspacePath,
  variant = "inline",
  stopPropagation = true,
  className = "",
}: FileReferenceBadgeProps) {
  const actions = useFileReferenceActions({ rawPath, workspacePath });
  const { onContextMenuCapture } = useFileReferenceNativeContextMenu(actions);
  const resolvedBasename = basename
    ?? fileReferenceBasename(actions.reference.workspacePath ?? actions.reference.path);
  const iconPath = actions.reference.workspacePath ?? actions.reference.path;
  const displayLabel = label
    ?? (variant === "chip"
      ? resolvedBasename
      : inlineFileReferenceLabel(actions.reference));
  // Outside-the-workspace inline references used to always show the generic
  // path-mention glyph. A referenced file whose extension maps to a real
  // file-type glyph (markdown, images, source languages — the single
  // extension→visual table in file-visuals.ts) now shows that glyph instead, so
  // `README.md` and `logo.svg` read as the kinds of file they are wherever they
  // appear. Only genuinely unclassifiable names keep the mention glyph.
  const hasFileTypeGlyph =
    actions.pathKind !== "directory"
    && getFileVisual(resolvedBasename, iconPath, "file").kind !== "default";
  const useExternalInlineIcon =
    variant === "inline"
    && !actions.reference.workspacePath
    && Boolean(actions.reference.absolutePath)
    && !hasFileTypeGlyph;
  const iconShellClassName = variant === "inline"
    ? "relative mr-[3px] inline-block h-[1lh] w-3.5 shrink-0 align-bottom"
    : "inline-flex shrink-0 items-center justify-center";

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
    if (!actions.canOpenPrimary) {
      return;
    }
    void actions.openPrimary();
  }, [actions, stopPropagation]);

  const contents = (
    <>
      <span className={iconShellClassName}>
        {useExternalInlineIcon ? (
          <span
            aria-hidden="true"
            data-external-path-reference-icon="true"
            className="absolute left-0 top-1/2 size-3.5 -translate-y-1/2 inline-block pointer-events-none select-none [&>svg]:block [&>svg]:size-full"
          >
            <InlinePathMentionIcon />
          </span>
        ) : (
          <FileTreeEntryIcon
            name={resolvedBasename}
            path={iconPath}
            kind={actions.pathKind === "directory" ? "directory" : "file"}
            className={variant === "inline"
              ? "absolute left-0 top-1/2 icon-paired -translate-y-1/2 opacity-95 [font-size:var(--text-chat)]"
              : "icon-compact opacity-90 [font-size:var(--text-chat)]"}
            toneClassName={variant === "inline" ? "text-current" : "file-reference-icon"}
          />
        )}
      </span>
      <span className={variant === "inline"
        ? "min-w-0 break-words"
        : "min-w-0 truncate"}
      >
        {displayLabel}
      </span>
    </>
  );
  if (!actions.canOpenPrimary) {
    return (
      <span
        data-chat-transcript-ignore
        data-file-reference-badge={variant}
        data-file-reference-unavailable="true"
        data-path-kind={actions.pathKind ?? "unknown"}
        aria-busy={actions.pathKindPending || undefined}
        title={actions.primaryUnavailableReason ?? rawPath}
        className={resolveUnavailableBadgeClassName(variant, className)}
      >
        {contents}
      </span>
    );
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="unstyled"
      data-chat-transcript-ignore
      data-file-reference-badge={variant}
      data-path-kind={actions.pathKind ?? "unknown"}
      aria-busy={actions.pathKindPending || undefined}
      title={actions.primaryUnavailableReason ?? rawPath}
      onClick={handleClick}
      onContextMenuCapture={onContextMenuCapture}
      className={resolveBadgeClassName(variant, className)}
    >
      {contents}
    </Button>
  );

  return (
    <PopoverButton
      trigger={trigger}
      triggerMode="contextMenu"
      stopPropagation={stopPropagation}
      className={FILE_REFERENCE_MENU_CLASS}
    >
      {(close) => (
        <FileReferenceMenuContent actions={actions} close={close} />
      )}
    </PopoverButton>
  );
}

function resolveUnavailableBadgeClassName(
  variant: FileReferenceBadgeVariant,
  className: string,
): string {
  if (variant === "chip") {
    return [
      "inline-flex h-auto min-w-0 max-w-full cursor-default items-center gap-px rounded-sm border border-border/60 bg-muted/45 px-1 py-px font-mono text-ui leading-none text-foreground/70 shadow-none",
      className,
    ].filter(Boolean).join(" ");
  }

  return [
    "group/inline-mention m-0 inline-flex cursor-default appearance-none whitespace-normal break-words border-0 bg-transparent px-0.5 py-0 text-left align-baseline font-[inherit] font-medium text-inherit shadow-none",
    className,
    "!no-underline",
  ].filter(Boolean).join(" ");
}

function resolveBadgeClassName(
  variant: FileReferenceBadgeVariant,
  className: string,
): string {
  if (variant === "chip") {
    return [
      "inline-flex h-auto min-w-0 max-w-full items-center gap-px rounded-sm border border-border/60 bg-muted/45 px-1 py-px font-mono text-ui leading-none text-foreground/90 shadow-none transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border",
      className,
    ].filter(Boolean).join(" ");
  }

  return [
    `group/inline-mention m-0 inline appearance-none whitespace-normal break-words border-0 bg-transparent px-0.5 py-0 text-left align-baseline font-[inherit] font-medium shadow-none hover:bg-transparent ${CHAT_TRANSCRIPT_LINK_CLASS}`,
    className,
  ].filter(Boolean).join(" ");
}
