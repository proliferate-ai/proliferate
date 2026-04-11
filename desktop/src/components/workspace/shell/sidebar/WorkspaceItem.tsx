import { useState, type ReactNode } from "react";
import {
  CLOUD_SIDEBAR_STATUS_DEFINITIONS,
  type CloudSidebarStatus,
} from "@/config/cloud-sidebar";
import {
  Archive,
  BrailleSweepBadge,
  CircleAlert,
  Pencil,
} from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { Tooltip } from "@/components/ui/Tooltip";
import type { SessionViewState } from "@/lib/domain/sessions/activity";
import type { SidebarWorkspaceVariant } from "@/lib/domain/workspaces/sidebar";
import { formatSidebarRelativeTime } from "@/lib/domain/workspaces/workspace-display";
import { SidebarActionButton } from "./SidebarActionButton";
import { SidebarRowSurface } from "./SidebarRowSurface";
import { SidebarWorkspaceVariantIcon } from "./SidebarWorkspaceVariantIcon";
import { WorkspaceRenamePopover } from "./WorkspaceRenamePopover";

const CONTEXT_ROW =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-sidebar-accent";

interface WorkspaceItemProps {
  name: string;
  /**
   * The label we would show if no rename override were set. Used as the
   * placeholder in the rename popover so the user knows what clearing the
   * override will reveal. Defaults to `name` when omitted.
   */
  defaultName?: string;
  /** Whether the workspace currently has a user-set rename. */
  hasDisplayNameOverride?: boolean;
  subtitle?: string | null;
  variant?: SidebarWorkspaceVariant;
  cloudStatus?: CloudSidebarStatus | null;
  active?: boolean;
  archived?: boolean;
  activity?: SessionViewState;
  additions?: number;
  deletions?: number;
  lastInteracted?: string | null;
  unread?: boolean;
  onSelect?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  /**
   * Persist a display name override. `null` clears it. Omit to disable the
   * Rename context menu item (e.g. for cloud entries).
   */
  onRename?: (displayName: string | null) => Promise<unknown>;
}

export function WorkspaceItem({
  name,
  defaultName,
  hasDisplayNameOverride = false,
  subtitle: _subtitle,
  variant = "local",
  cloudStatus = null,
  active = false,
  archived = false,
  activity = "idle",
  additions,
  deletions,
  lastInteracted,
  unread = false,
  onSelect,
  onArchive,
  onUnarchive,
  onRename,
}: WorkspaceItemProps) {
  const hasArchiveAction = !!(onArchive || onUnarchive);
  // Suppress the "ready" status badge — the cloud variant icon already
  // conveys "this is a cloud workspace". Non-ready statuses (queued,
  // provisioning, syncing, cloning, starting, stopped, error) still show
  // because they carry information the icon doesn't.
  const cloudStatusDefinition =
    variant === "cloud" && cloudStatus && cloudStatus !== "ready"
      ? CLOUD_SIDEBAR_STATUS_DEFINITIONS[cloudStatus]
      : null;
  const [renameOpen, setRenameOpen] = useState(false);

  const statusSlot: { tooltip: string; element: ReactNode } | null =
    activity === "working"
      ? {
        tooltip: "Working",
        element: <BrailleSweepBadge className="text-sm text-muted-foreground" />,
      }
      : activity === "needs_input"
        ? {
          tooltip: "Needs input",
          element: <BrailleSweepBadge className="text-sm text-special" />,
        }
        : activity === "errored"
          ? {
            tooltip: "Error",
            element: <CircleAlert className="size-3 text-destructive" />,
          }
          : unread
            ? {
              tooltip: "Unread",
              element: <div className="size-1.5 rounded-full bg-unread" />,
            }
            : null;
  const variantMetaIcon = (
    <SidebarWorkspaceVariantIcon
      variant={variant}
      withTooltip
      className={`size-3 ${
        archived ? "text-sidebar-muted-foreground/40" : "text-sidebar-muted-foreground"
      }`}
    />
  );

  const row = (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className="h-[30px] px-2 py-1 gap-1.5 text-sm leading-4 focus-visible:outline-offset-[-2px]"
    >
      {/* Archive button — absolutely positioned right edge, visible on hover */}
      {(onArchive || onUnarchive) && (
        <div className="flex items-center gap-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 absolute right-0 top-0 z-10 h-full justify-center mr-px pr-0.5">
          <SidebarActionButton
            onClick={(e) => {
              e.stopPropagation();
              archived ? onUnarchive?.() : onArchive?.();
            }}
            title={archived ? "Unarchive workspace" : "Archive workspace"}
            className="size-5 rounded-sm"
            alwaysVisible
          >
            <Archive className="size-3" />
          </SidebarActionButton>
        </div>
      )}

      {/* Leading status slot. Idle variants render with the right-side metadata
          instead so the icon sits next to the relative-time / git summary. */}
      <div className="flex w-4 shrink-0 items-center justify-center">
        {statusSlot && (
          <Tooltip content={statusSlot.tooltip} className="inline-flex shrink-0 items-center justify-center">
            {statusSlot.element}
          </Tooltip>
        )}
      </div>

      {/* Title */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className={`flex flex-1 items-center gap-2 truncate text-base leading-5 ${
          archived ? "text-foreground/30" : "text-foreground"
        }`}>
          <span className="truncate select-none" draggable={false}>{name}</span>
        </div>
        {cloudStatusDefinition && (
          <div className="flex min-w-[24px] items-center justify-end gap-2">
            <span className={`shrink-0 rounded-full border px-1.5 py-0 text-xs uppercase tracking-[0.12em] ${cloudStatusDefinition.className}`}>
              {cloudStatusDefinition.label}
            </span>
          </div>
        )}
      </div>

      {/* Right-side info — timestamp or git stats */}
      <div className="flex shrink-0 items-stretch justify-end gap-1 min-w-[24px]">
        {active && additions !== undefined && deletions !== undefined && (additions > 0 || deletions > 0) && (
          <div
            className={`overflow-hidden whitespace-nowrap text-sm leading-4 tabular-nums transition-[max-width,opacity,margin] duration-150 ease-out ${
              hasArchiveAction
                ? "max-w-12 opacity-100 group-hover:max-w-0 group-hover:opacity-0 group-focus-within:max-w-0 group-focus-within:opacity-0"
                : ""
            }`}
          >
            <span className="text-git-green">+{additions}</span>{" "}
            <span className="text-git-red">-{deletions}</span>
          </div>
        )}
        {!active && lastInteracted && (
          <div
            className={`overflow-hidden whitespace-nowrap text-foreground/40 text-sm leading-4 tabular-nums truncate text-right transition-[max-width,opacity,margin] duration-150 ease-out ${
              hasArchiveAction
                ? "max-w-10 opacity-100 group-hover:max-w-0 group-hover:opacity-0 group-focus-within:max-w-0 group-focus-within:opacity-0"
                : ""
            }`}
          >
            {formatSidebarRelativeTime(lastInteracted)}
          </div>
        )}
        <div
          className={`flex items-center justify-end text-sidebar-muted-foreground transition-transform duration-150 ease-out ${
            hasArchiveAction
              ? "group-hover:-translate-x-4 group-focus-within:-translate-x-4"
              : ""
          }`}
        >
          {variantMetaIcon}
        </div>
      </div>
    </SidebarRowSurface>
  );

  const contextMenu = (
    <PopoverButton
      trigger={row}
      triggerMode="contextMenu"
      stopPropagation
      className="w-52 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <>
          {onRename && (
            <button
              type="button"
              onClick={() => {
                close();
                setRenameOpen(true);
              }}
              className={CONTEXT_ROW}
            >
              <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">Rename</span>
            </button>
          )}
          {onArchive && !archived && (
            <button
              type="button"
              onClick={() => { close(); onArchive(); }}
              className={CONTEXT_ROW}
            >
              <Archive className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">Archive</span>
            </button>
          )}
          {onUnarchive && archived && (
            <button
              type="button"
              onClick={() => { close(); onUnarchive(); }}
              className={CONTEXT_ROW}
            >
              <Archive className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">Unarchive</span>
            </button>
          )}
        </>
      )}
    </PopoverButton>
  );

  if (!onRename) {
    return contextMenu;
  }

  // Wrap with a controlled rename popover. The trigger is a span containing
  // the context-menu-wrapped row; the popover is opened externally from the
  // "Rename" menu item, and double-click on the row also opens it as a
  // bonus affordance. Using doubleClick avoids conflicting with onSelect
  // (single click) and the existing right-click context menu.
  return (
    <WorkspaceRenamePopover
      currentName={name}
      defaultName={defaultName ?? name}
      hasOverride={hasDisplayNameOverride}
      onRename={onRename}
      externalOpen={renameOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) setRenameOpen(false);
      }}
      trigger={<div>{contextMenu}</div>}
    />
  );
}
