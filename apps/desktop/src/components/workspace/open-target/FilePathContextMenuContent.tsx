import {
  useState,
} from "react";
import { ChevronRight, ExternalLink } from "@proliferate/ui/icons";
import { OpenTargetIcon } from "@/components/workspace/open-target/OpenTargetIcon";
import { POPOVER_SURFACE_CLASS } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import type { OpenTarget } from "@/lib/domain/open-targets/model";

export type FilePathContextMenuTarget = Pick<OpenTarget, "id" | "label" | "iconId" | "kind">;

const FILE_PATH_MENU_ITEM_PROPS = {
  density: "compact",
  role: "menuitem",
  iconClassName: "size-4 opacity-100",
  trailingClassName: "ml-0 size-auto",
} as const;

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
      <PopoverMenuItem
        {...FILE_PATH_MENU_ITEM_PROPS}
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
          <PopoverMenuItem
            {...FILE_PATH_MENU_ITEM_PROPS}
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
                <PopoverMenuItem
                  {...FILE_PATH_MENU_ITEM_PROPS}
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
      <PopoverMenuItem
        {...FILE_PATH_MENU_ITEM_PROPS}
        {...transcriptProps}
        label="Copy path"
        onClick={() => {
          onCopyPath();
          close();
        }}
      />
      <PopoverMenuItem
        {...FILE_PATH_MENU_ITEM_PROPS}
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
