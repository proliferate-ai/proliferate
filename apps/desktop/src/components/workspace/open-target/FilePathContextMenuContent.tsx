import {
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronRight, ExternalLink } from "@proliferate/ui/icons";
import { OpenTargetIcon } from "@/components/workspace/open-target/OpenTargetIcon";
import { POPOVER_SURFACE_CLASS } from "@proliferate/ui/primitives/PopoverButton";
import type { OpenTarget } from "@/lib/domain/open-targets/model";

export type FilePathContextMenuTarget = Pick<OpenTarget, "id" | "label" | "iconId" | "kind">;

export function FilePathContextMenuContent({
  canOpen,
  targets,
  defaultTarget,
  close,
  onOpenDefault,
  onOpenTarget,
  onCopyPath,
  onRevealInFinder,
  ignoreChatTranscript = false,
}: {
  canOpen: boolean;
  targets: readonly FilePathContextMenuTarget[];
  defaultTarget?: FilePathContextMenuTarget | null;
  close: () => void;
  onOpenDefault: () => void;
  onOpenTarget: (targetId: string) => void;
  onCopyPath: () => void;
  onRevealInFinder: () => void;
  ignoreChatTranscript?: boolean;
}) {
  const [openWithActive, setOpenWithActive] = useState(false);
  const transcriptProps = ignoreChatTranscript
    ? { "data-chat-transcript-ignore": true }
    : {};

  return (
    <div className="relative flex flex-col gap-px">
      <FilePathContextMenuItem
        {...transcriptProps}
        icon={<OpenMenuTargetIcon target={defaultTarget ?? null} />}
        label={defaultTarget ? `Open in ${defaultTarget.label}` : "Open"}
        disabled={!canOpen}
        onClick={() => {
          onOpenDefault();
          close();
        }}
      />
      {targets.length > 0 && (
        <div
          className="relative"
          onMouseEnter={() => setOpenWithActive(true)}
          onMouseLeave={() => setOpenWithActive(false)}
          onFocus={() => setOpenWithActive(true)}
        >
          <FilePathContextMenuItem
            {...transcriptProps}
            label="Open with"
            disabled={!canOpen}
            trailing={<ChevronRight className="size-3.5" />}
            className={openWithActive
              ? "bg-[var(--color-link-foreground)] text-white hover:bg-[var(--color-link-foreground)] focus:bg-[var(--color-link-foreground)] [&_*]:text-white"
              : ""}
          />
          {openWithActive && (
            <div
              className={`absolute left-full top-0 z-10 ml-1 min-w-44 ${POPOVER_SURFACE_CLASS}`}
              onMouseEnter={() => setOpenWithActive(true)}
            >
              {targets.map((target) => (
                <FilePathContextMenuItem
                  key={target.id}
                  {...transcriptProps}
                  icon={<OpenMenuTargetIcon target={target} />}
                  label={target.label}
                  disabled={!canOpen}
                  onClick={() => {
                    onOpenTarget(target.id);
                    close();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <div className="my-1 h-px bg-border/70" />
      <FilePathContextMenuItem
        {...transcriptProps}
        label="Copy path"
        onClick={() => {
          onCopyPath();
          close();
        }}
      />
      <FilePathContextMenuItem
        {...transcriptProps}
        label="Reveal in Finder"
        disabled={!canOpen}
        onClick={() => {
          onRevealInFinder();
          close();
        }}
      />
    </div>
  );
}

function FilePathContextMenuItem({
  icon,
  label,
  trailing,
  disabled,
  className = "",
  onClick,
  ...props
}: {
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={[
        "group/menu-item flex w-full cursor-default select-none items-center rounded-lg px-2 py-1 text-sm font-[430] leading-4 text-popover-foreground outline-none transition-colors hover:bg-popover-accent focus:bg-popover-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
        className,
      ].filter(Boolean).join(" ")}
      {...props}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      {icon && (
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {icon}
        </span>
      )}
      <span className={icon ? "ml-1.5 min-w-0 flex-1 truncate text-left" : "min-w-0 flex-1 truncate text-left"}>
        {label}
      </span>
      {trailing && (
        <span className="ml-2 flex shrink-0 items-center justify-center text-muted-foreground opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100">
          {trailing}
        </span>
      )}
    </button>
  );
}

function OpenMenuTargetIcon({
  target,
}: {
  target: FilePathContextMenuTarget | null;
}) {
  if (!target?.iconId) {
    return <ExternalLink className="size-3.5 shrink-0" />;
  }
  return <OpenTargetIcon iconId={target.iconId} className="size-3.5 shrink-0" variant="menu" />;
}
