import {
  useState,
} from "react";
import { ChevronRight, ExternalLink, FileText } from "@proliferate/ui/icons";
import { OpenTargetIcon } from "#product/components/workspace/open-target/OpenTargetIcon";
import { POPOVER_SURFACE_CLASS } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";
import type { FileReferencePathKind } from "#product/lib/domain/files/path-references";

export type FilePathContextMenuTarget = Pick<OpenTarget, "id" | "label" | "iconId" | "kind">;

const FILE_PATH_MENU_ITEM_PROPS = {
  density: "compact",
  role: "menuitem",
  iconClassName: "size-4 opacity-100",
  trailingClassName: "ml-0 size-auto",
} as const;

export function FilePathContextMenuContent({
  pathKind,
  canOpenInViewer,
  canOpenExternal,
  canReveal,
  targets,
  defaultTarget,
  close,
  onOpenInViewer,
  onOpenDefault,
  onOpenTarget,
  onCopyPath,
  onRevealInFinder,
  ignoreChatTranscript = false,
}: {
  pathKind: FileReferencePathKind | null;
  canOpenInViewer: boolean;
  canOpenExternal: boolean;
  canReveal: boolean;
  targets: readonly FilePathContextMenuTarget[];
  defaultTarget?: FilePathContextMenuTarget | null;
  close: () => void;
  onOpenInViewer: () => void;
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
      {pathKind !== "directory" && (
        <PopoverMenuItem
          {...FILE_PATH_MENU_ITEM_PROPS}
          {...transcriptProps}
          icon={<FileText className="icon-paired shrink-0" />}
          label="Open in viewer"
          disabled={!canOpenInViewer}
          onClick={() => {
            onOpenInViewer();
            close();
          }}
        />
      )}
      <PopoverMenuItem
        {...FILE_PATH_MENU_ITEM_PROPS}
        {...transcriptProps}
        icon={<OpenMenuTargetIcon target={defaultTarget ?? null} />}
        label={defaultTarget ? `Open in ${defaultTarget.label}` : "Open externally"}
        disabled={!canOpenExternal}
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
            disabled={!canOpenExternal}
            trailing={<ChevronRight className="icon-paired" />}
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
                  disabled={!canOpenExternal}
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
        label={pathKind === "directory" ? "Reveal folder in Finder" : "Reveal in Finder"}
        disabled={!canReveal}
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
    return <ExternalLink className="icon-paired shrink-0" />;
  }
  return <OpenTargetIcon iconId={target.iconId} className="icon-paired shrink-0" variant="menu" />;
}
