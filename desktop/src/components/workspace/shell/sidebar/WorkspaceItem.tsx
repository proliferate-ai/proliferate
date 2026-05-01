import { useState } from "react";
import {
  CLOUD_SIDEBAR_STATUS_DEFINITIONS,
  type CloudSidebarStatus,
} from "@/config/cloud-sidebar";
import {
  Archive,
  GitMerge,
  Pencil,
} from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { useWorkspaceSidebarNativeContextMenu } from "@/hooks/workspaces/use-workspace-sidebar-native-context-menu";
import type {
  SidebarDetailIndicator,
  SidebarIndicatorAction,
  SidebarStatusIndicator,
  SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar";
import { formatSidebarRelativeTime } from "@/lib/domain/workspaces/workspace-display";
import {
  SidebarDetailIndicatorsView,
  SidebarStatusIndicatorView,
} from "./SidebarIndicators";
import { SidebarActionButton } from "./SidebarActionButton";
import { SidebarRowSurface } from "./SidebarRowSurface";
import { WorkspaceRenamePopover } from "./WorkspaceRenamePopover";

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
  statusIndicator?: SidebarStatusIndicator | null;
  detailIndicators?: SidebarDetailIndicator[];
  lastInteracted?: string | null;
  onSelect?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onMarkDone?: () => void;
  onIndicatorAction?: (action: SidebarIndicatorAction) => void;
  onHover?: () => void;
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
  statusIndicator = null,
  detailIndicators = [],
  lastInteracted,
  onSelect,
  onArchive,
  onUnarchive,
  onMarkDone,
  onIndicatorAction,
  onHover,
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
  const [doneConfirmOpen, setDoneConfirmOpen] = useState(false);
  const handleRenameCommand = () => setRenameOpen(true);
  const handleArchiveCommand = () => onArchive?.();
  const handleUnarchiveCommand = () => onUnarchive?.();
  const handleMarkDoneCommand = () => setDoneConfirmOpen(true);
  const { onContextMenuCapture } = useWorkspaceSidebarNativeContextMenu({
    canRename: !!onRename,
    archived,
    canArchive: !!onArchive,
    canUnarchive: !!onUnarchive,
    canMarkDone: !!onMarkDone,
    onRename: handleRenameCommand,
    onArchive: handleArchiveCommand,
    onUnarchive: handleUnarchiveCommand,
    onMarkDone: handleMarkDoneCommand,
  });

  const row = (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      onContextMenuCapture={onContextMenuCapture}
      onPointerEnter={onHover}
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
        <SidebarStatusIndicatorView
          indicator={statusIndicator}
          onAction={onIndicatorAction}
        />
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

      {/* Right-side info — timestamp and workspace variant */}
      <div className="flex shrink-0 items-stretch justify-end gap-1 min-w-[24px]">
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
          className={`flex items-center justify-end gap-1 text-sidebar-muted-foreground transition-transform duration-150 ease-out ${
            hasArchiveAction
              ? "group-hover:-translate-x-4 group-focus-within:-translate-x-4"
              : ""
          }`}
        >
          <SidebarDetailIndicatorsView
            indicators={detailIndicators}
            archived={archived}
            onAction={onIndicatorAction}
          />
        </div>
      </div>
    </SidebarRowSurface>
  );

  // Leave PopoverButton uncontrolled until the confirmation step is active.
  // Passing false would force-close the internally opened right-click menu.
  const forcedContextMenuOpen = doneConfirmOpen ? true : undefined;

  const contextMenu = (
    <PopoverButton
      trigger={row}
      triggerMode="contextMenu"
      stopPropagation
      externalOpen={forcedContextMenuOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) setDoneConfirmOpen(false);
      }}
      className="w-64 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <>
          {doneConfirmOpen ? (
            <>
              <div className="px-2.5 py-2 text-sm text-foreground">
                <div className="font-medium">Mark done?</div>
                <div className="mt-1 text-xs leading-4 text-muted-foreground">
                  This removes the local worktree and hides this workspace and its chats from the app.
                  Commits, branches, and pull requests are not deleted.
                </div>
                <div className="mt-1 text-xs leading-4 text-muted-foreground">
                  This cannot be undone from Proliferate.
                </div>
              </div>
              <PopoverMenuItem
                icon={<GitMerge className="size-3.5 shrink-0 text-muted-foreground" />}
                label="Confirm done"
                variant="sidebar"
                onClick={() => {
                  close();
                  setDoneConfirmOpen(false);
                  onMarkDone?.();
                }}
              />
              <PopoverMenuItem
                label="Cancel"
                variant="sidebar"
                onClick={() => {
                  close();
                  setDoneConfirmOpen(false);
                }}
              />
            </>
          ) : (
            <>
          {onRename && (
            <PopoverMenuItem
              icon={<Pencil className="size-3.5 shrink-0 text-muted-foreground" />}
              label="Rename"
              variant="sidebar"
              onClick={() => {
                close();
                handleRenameCommand();
              }}
            />
          )}
          {onMarkDone && (
            <PopoverMenuItem
              icon={<GitMerge className="size-3.5 shrink-0 text-muted-foreground" />}
              label="Mark done..."
              variant="sidebar"
              onClick={() => {
                handleMarkDoneCommand();
              }}
            />
          )}
          {onArchive && !archived && (
            <PopoverMenuItem
              icon={<Archive className="size-3.5 shrink-0 text-muted-foreground" />}
              label="Archive"
              variant="sidebar"
              onClick={() => { close(); handleArchiveCommand(); }}
            />
          )}
          {onUnarchive && archived && (
            <PopoverMenuItem
              icon={<Archive className="size-3.5 shrink-0 text-muted-foreground" />}
              label="Unarchive"
              variant="sidebar"
              onClick={() => { close(); handleUnarchiveCommand(); }}
            />
          )}
            </>
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
