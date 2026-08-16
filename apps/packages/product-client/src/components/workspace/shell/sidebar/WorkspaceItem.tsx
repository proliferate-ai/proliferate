import { useState } from "react";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { Archive } from "#product/primitives/icons/core";
import { SidebarActionButton } from "#product/primitives/patterns/sidebar/SidebarActionButton";
import { useWorkspaceSidebarNativeContextMenu } from "#product/hooks/workspaces/ui/use-workspace-sidebar-native-context-menu";
import type {
  SidebarIndicatorAction,
  SidebarStatusIndicator,
  SidebarWorkspaceVariant,
} from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import type {
  WorkspaceAvailabilityCommand,
  WorkspaceAvailabilityCommandKind,
} from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import { WorkspaceItemContextMenu } from "#product/components/workspace/shell/sidebar/WorkspaceItemContextMenu";
import { resolveWorkspaceItemTrailingCells } from "#product/components/workspace/shell/sidebar/WorkspaceItemTrailing";
import { useWorkspacePeek } from "#product/components/workspace/shell/sidebar/WorkspacePeekCard";
import { WorkspaceRenamePopover } from "#product/components/workspace/shell/sidebar/WorkspaceRenamePopover";
import { ProductSidebarWorkspaceRow } from "#product/components/workspace/shell/sidebar/ProductSidebarRepositories";
import { useSidebarSwitchCursorStore } from "#product/stores/workspaces/sidebar-switch-cursor-store";

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
  active?: boolean;
  archived?: boolean;
  /** Whether the workspace sits in the sidebar's Pinned section. */
  pinned?: boolean;
  /**
   * Activity indicator (spinner / waiting / error). Rendered in the row's
   * RIGHT slot; hover affordances (shortcut reveal, menu trigger) still win
   * per the row's trailing-cell precedence, and it beats the unread dot.
   */
  statusIndicator?: SidebarStatusIndicator | null;
  shortcutLabel?: string | null;
  shortcutRevealVisible?: boolean;
  /** Current git branch, shown read-only in the three-dot menu git section. */
  branchName?: string | null;
  /** Owning repository, shown in the hover peek card. */
  repoName?: string | null;
  /** Relative last-activity label ("38m ago") for the hover peek card. */
  lastActivityLabel?: string | null;
  /**
   * Composed git/PR status. Together with `variant` it decides the trailing
   * identity glyph and its tooltip; it also drives the conflicts alert in the
   * status cell and the "Open pull request" menu item.
   */
  gitStatus?: WorkspaceGitStatus | null;
  /** Renders the trailing unseen-activity dot. */
  needsReview?: boolean;
  onSelect?: () => void;
  /** Opens the PR URL externally; enables the "Open pull request" menu item. */
  onOpenPullRequest?: (url: string) => void;
  workspaceLocationCopyLabel?: string | null;
  onCopyWorkspaceLocation?: () => void;
  onCopyBranchName?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onPin?: () => void;
  onUnpin?: () => void;
  onMarkDone?: () => void;
  /** Workspace-copy availability commands (PR 5), rendered in both the DOM and
   * native `…` menus. */
  availabilityCommands?: WorkspaceAvailabilityCommand[];
  onAvailabilityCommand?: (kind: WorkspaceAvailabilityCommandKind) => void;
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
  active = false,
  archived = false,
  pinned = false,
  statusIndicator = null,
  shortcutLabel = null,
  shortcutRevealVisible = false,
  branchName = null,
  repoName = null,
  lastActivityLabel = null,
  gitStatus = null,
  needsReview = false,
  onSelect,
  onOpenPullRequest,
  onArchive,
  onUnarchive,
  onPin,
  onUnpin,
  onMarkDone,
  availabilityCommands = [],
  onAvailabilityCommand,
  onIndicatorAction,
  onHover,
  workspaceLocationCopyLabel,
  onCopyWorkspaceLocation,
  onCopyBranchName,
  onRename,
}: WorkspaceItemProps) {
  // While a held-key traversal cursor is set the cursor position, not the
  // committed selection, drives the highlight so exactly one row reads active
  // during movement. The selector folds this row's id and its committed
  // `active` prop into a single boolean, so a cursor step re-renders only the
  // two rows whose displayed state flips rather than every subscribed row.
  const displayedActive = useSidebarSwitchCursorStore((state) =>
    state.cursorId === null ? active : state.cursorId === workspaceId,
  );
  const [renameOpen, setRenameOpen] = useState(false);
  const [doneConfirmOpen, setDoneConfirmOpen] = useState(false);
  const handleRenameCommand = () => setRenameOpen(true);
  const handleCopyWorkspaceLocationCommand = () => onCopyWorkspaceLocation?.();
  const handleCopyBranchNameCommand = () => onCopyBranchName?.();
  const handleArchiveCommand = () => onArchive?.();
  const handleUnarchiveCommand = () => onUnarchive?.();
  const handlePinCommand = () => onPin?.();
  const handleUnpinCommand = () => onUnpin?.();
  const handleMarkDoneCommand = () => setDoneConfirmOpen(true);
  // The context menu closes the popover itself before either of these runs,
  // so they carry only the state and the command.
  const handleConfirmDoneCommand = () => {
    setDoneConfirmOpen(false);
    onMarkDone?.();
  };
  const handleCancelDoneCommand = () => setDoneConfirmOpen(false);
  const {
    identity: trailingIdentity,
    status: trailingStatus,
  } = resolveWorkspaceItemTrailingCells({
    gitStatus,
    variant,
    statusIndicator,
    onIndicatorAction,
  });
  const pullRequestUrl = gitStatus?.pr?.url ?? null;
  const pullRequestNumber = gitStatus?.pr?.number ?? null;
  const handleOpenPullRequestCommand = pullRequestUrl && onOpenPullRequest
    ? () => onOpenPullRequest(pullRequestUrl)
    : undefined;
  const { onContextMenuCapture } = useWorkspaceSidebarNativeContextMenu({
    canRename: !!onRename,
    canCopyWorkspaceLocation: !!onCopyWorkspaceLocation,
    copyWorkspaceLocationLabel: workspaceLocationCopyLabel ?? "Copy workspace location",
    canCopyBranchName: !!onCopyBranchName,
    branchName,
    canOpenPullRequest: !!handleOpenPullRequestCommand,
    pullRequestNumber,
    archived,
    canArchive: !!onArchive,
    canUnarchive: !!onUnarchive,
    pinned,
    canPin: !!onPin,
    canUnpin: !!onUnpin,
    canMarkDone: !!onMarkDone,
    onRename: handleRenameCommand,
    onCopyWorkspaceLocation: handleCopyWorkspaceLocationCommand,
    onCopyBranchName: handleCopyBranchNameCommand,
    onOpenPullRequest: () => handleOpenPullRequestCommand?.(),
    onArchive: handleArchiveCommand,
    onUnarchive: handleUnarchiveCommand,
    onPin: handlePinCommand,
    onUnpin: handleUnpinCommand,
    onMarkDone: handleMarkDoneCommand,
    availabilityCommands,
    onAvailabilityCommand,
  });
  // Archive rides the row's hover-action slot directly (no three-dot menu):
  // every other action the old menu carried is already on the DOM context
  // menu below and the native menu (`useWorkspaceSidebarNativeContextMenu`).
  // Not offered on an already-archived (cloud) entry — that row's exit is
  // Unarchive, reachable from either context menu.
  const archiveHoverAction = onArchive && !archived ? (
    <SidebarActionButton
      title="Archive workspace (⌘⇧A)"
      onClick={(event) => {
        event.stopPropagation();
        handleArchiveCommand();
      }}
    >
      <Archive />
    </SidebarActionButton>
  ) : null;

  const { onPointerEnter, onPointerLeave, peekCard } = useWorkspacePeek({
    name,
    time: lastActivityLabel,
    repo: repoName,
    branch: branchName ?? gitStatus?.branch ?? null,
    gitStatus,
  });

  const row = (
    <ProductSidebarWorkspaceRow
      active={displayedActive}
      archived={archived}
      trailingStatus={trailingStatus}
      trailingIdentity={trailingIdentity}
      label={name}
      unreadDot={needsReview}
      shortcutLabel={shortcutLabel}
      shortcutRevealVisible={shortcutRevealVisible}
      hoverAction={archiveHoverAction}
      onSelect={onSelect}
      onContextMenuCapture={onContextMenuCapture}
      onPointerEnter={(event) => {
        onHover?.();
        onPointerEnter(event);
      }}
      onPointerLeave={onPointerLeave}
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
        <WorkspaceItemContextMenu
          close={close}
          archived={archived}
          pinned={pinned}
          workspaceLocationCopyLabel={workspaceLocationCopyLabel}
          pullRequestNumber={pullRequestNumber}
          doneConfirmOpen={doneConfirmOpen}
          onConfirmDone={handleConfirmDoneCommand}
          onCancelDone={handleCancelDoneCommand}
          onRename={onRename ? handleRenameCommand : undefined}
          onPin={onPin ? handlePinCommand : undefined}
          onUnpin={onUnpin ? handleUnpinCommand : undefined}
          onCopyWorkspaceLocation={
            onCopyWorkspaceLocation ? handleCopyWorkspaceLocationCommand : undefined
          }
          onOpenPullRequest={handleOpenPullRequestCommand}
          onCopyBranchName={onCopyBranchName ? handleCopyBranchNameCommand : undefined}
          onMarkDone={onMarkDone ? handleMarkDoneCommand : undefined}
          onArchive={onArchive ? handleArchiveCommand : undefined}
          onUnarchive={onUnarchive ? handleUnarchiveCommand : undefined}
          availabilityCommands={availabilityCommands}
          onAvailabilityCommand={onAvailabilityCommand}
        />
      )}
    </PopoverButton>
  );

  if (!onRename) {
    return <>{contextMenu}{peekCard}</>;
  }

  // Wrap with a controlled rename popover. The trigger is a span containing
  // the context-menu-wrapped row; the popover is opened externally from the
  // "Rename" menu item, and double-click on the row also opens it as a
  // bonus affordance. Using doubleClick avoids conflicting with onSelect
  // (single click) and the existing right-click context menu.
  return (
    <>
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
      {peekCard}
    </>
  );
}
