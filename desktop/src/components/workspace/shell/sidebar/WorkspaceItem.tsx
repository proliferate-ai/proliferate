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
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { useWorkspaceSidebarNativeContextMenu } from "@/hooks/workspaces/ui/use-workspace-sidebar-native-context-menu";
import type {
  SidebarDetailIndicator,
  SidebarIndicatorAction,
  SidebarStatusIndicator,
  SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import { formatSidebarRelativeTime } from "@/lib/domain/workspaces/display/workspace-display";
import {
  SidebarDetailIndicatorsView,
  SidebarStatusIndicatorView,
} from "./SidebarIndicators";
import { SidebarActionButton } from "./SidebarActionButton";
import { WorkspaceRenamePopover } from "./WorkspaceRenamePopover";
import { ProductSidebarWorkspaceRow } from "@proliferate/product-ui/sidebar/ProductSidebar";

interface WorkspaceItemProps {
  workspaceId?: string;
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
  workspaceId,
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
  const timestampLabel = lastInteracted
    ? formatSidebarRelativeTime(lastInteracted)
    : null;
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
  const detail = detailIndicators.length > 0 || cloudStatusDefinition ? (
    <>
      <SidebarDetailIndicatorsView
        indicators={detailIndicators}
        archived={archived}
        onAction={onIndicatorAction}
      />
      {cloudStatusDefinition && (
        <span className={`shrink-0 rounded-full border px-1.5 py-0 text-xs uppercase tracking-[0.12em] ${cloudStatusDefinition.className}`}>
          {cloudStatusDefinition.label}
        </span>
      )}
    </>
  ) : null;
  const archiveAction = hasArchiveAction ? (
    <SidebarActionButton
      onClick={(e) => {
        e.stopPropagation();
        archived ? onUnarchive?.() : onArchive?.();
      }}
      title={archived ? "Unarchive workspace" : "Archive workspace"}
      className="!size-5 !p-0 opacity-50 hover:opacity-100 focus-visible:opacity-100"
      alwaysVisible
    >
      <Archive className="size-3.5" />
    </SidebarActionButton>
  ) : null;

  const row = (
    <ProductSidebarWorkspaceRow
      active={active}
      archived={archived}
      status={(
        <SidebarStatusIndicatorView
          indicator={statusIndicator}
          onAction={onIndicatorAction}
        />
      )}
      label={name}
      detail={detail}
      trailingLabel={timestampLabel}
      hoverAction={archiveAction}
      onSelect={onSelect}
      onContextMenuCapture={onContextMenuCapture}
      onPointerEnter={onHover}
      data-sidebar-workspace-item={workspaceId ?? ""}
      data-sidebar-workspace-variant={variant}
    />
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
      className={`w-64 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <>
          {doneConfirmOpen ? (
            <>
              <div className="px-2.5 py-2 text-sm text-foreground">
                <div className="font-medium">Delete workspace?</div>
                <div className="mt-1 text-xs leading-4 text-muted-foreground">
                  This removes the local worktree, workspace record, chat history, and local agent
                  artifacts for this workspace. Commits, branches, and pull requests are not deleted.
                </div>
                <div className="mt-1 text-xs leading-4 text-muted-foreground">
                  This cannot be undone from Proliferate.
                </div>
              </div>
              <PopoverMenuItem
                icon={<GitMerge className="size-3.5 shrink-0 text-muted-foreground" />}
                label="Delete workspace"
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
                  label="Delete workspace..."
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
