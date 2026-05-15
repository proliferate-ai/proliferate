import {
  type MouseEvent,
  type ReactNode,
  useCallback,
} from "react";
import { Button } from "@/components/ui/Button";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { InlinePathMentionIcon } from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  FILE_REFERENCE_MENU_CLASS,
  FileReferenceMenuContent,
} from "@/components/workspace/file-references/FileReferenceMenu";
import { useFileReferenceActions } from "@/hooks/workspaces/files/use-file-reference-actions";
import { useFileReferenceNativeContextMenu } from "@/hooks/workspaces/files/ui/use-file-reference-native-context-menu";

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
  const resolvedBasename = basename ?? extractBasename(actions.reference.workspacePath ?? actions.reference.path);
  const iconPath = actions.reference.workspacePath ?? actions.reference.path;
  const displayLabel = label ?? (variant === "chip" ? resolvedBasename : rawPath);
  const useExternalInlineIcon =
    variant === "inline"
    && !actions.reference.workspacePath
    && Boolean(actions.reference.absolutePath);
  const iconShellClassName = variant === "inline"
    ? "relative mr-[3px] inline-block h-[1lh] w-4 shrink-0 align-bottom"
    : "inline-flex shrink-0 items-center justify-center";

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
    void actions.openPrimary();
  }, [actions, stopPropagation]);

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="unstyled"
      data-chat-transcript-ignore
      data-file-reference-badge={variant}
      onClick={handleClick}
      onContextMenuCapture={onContextMenuCapture}
      className={resolveBadgeClassName(variant, className)}
    >
      <span className={iconShellClassName}>
        {useExternalInlineIcon ? (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 size-3.5 -translate-y-1/2 opacity-95 file-reference-icon inline-block pointer-events-none select-none [&>svg]:block [&>svg]:size-full"
          >
            <InlinePathMentionIcon
              data-external-path-reference-icon
            />
          </span>
        ) : (
          <FileTreeEntryIcon
            name={resolvedBasename}
            path={iconPath}
            kind="file"
            className={variant === "inline"
              ? "absolute left-0 top-1/2 size-3.5 -translate-y-1/2 opacity-95"
              : "size-2.5 opacity-90"}
            toneClassName="file-reference-icon"
          />
        )}
      </span>
      <span className={variant === "inline"
        ? "min-w-0 break-words"
        : "min-w-0 truncate"}
      >
        {displayLabel}
      </span>
    </Button>
  );

  return (
    <PopoverButton
      trigger={trigger}
      triggerMode="contextMenu"
      stopPropagation
      className={FILE_REFERENCE_MENU_CLASS}
    >
      {(close) => (
        <FileReferenceMenuContent actions={actions} close={close} />
      )}
    </PopoverButton>
  );
}

function resolveBadgeClassName(
  variant: FileReferenceBadgeVariant,
  className: string,
): string {
  if (variant === "chip") {
    return [
      "inline-flex h-auto min-w-0 max-w-full items-center gap-0.5 rounded-sm border border-border/60 bg-muted/45 px-1 py-px font-mono text-[0.625rem] leading-none text-foreground/90 shadow-none transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border",
      className,
    ].filter(Boolean).join(" ");
  }

  return [
    "group/inline-mention m-0 inline appearance-none whitespace-normal break-words border-0 bg-transparent p-0 text-left align-baseline font-[inherit] leading-[inherit] text-link-foreground shadow-none hover:bg-transparent hover:text-link-foreground hover:underline hover:decoration-current hover:decoration-dashed hover:decoration-[0.5px] hover:underline-offset-2 focus-visible:outline-none focus-visible:underline",
    className,
  ].filter(Boolean).join(" ");
}

function extractBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
