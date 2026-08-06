import { useState } from "react";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import {
  Archive,
  Pencil,
  Trash,
} from "#product/primitives/icons/core";
import { Folder } from "#product/primitives/icons/workspace";
import {
  GitBranchIcon,
  GitPullRequest,
} from "#product/primitives/icons/workspace-git";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { useWorkspaceSidebarNativeContextMenu } from "#product/hooks/workspaces/ui/use-workspace-sidebar-native-context-menu";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
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
import {
  SidebarStatusIndicatorView,
} from "#product/components/workspace/shell/sidebar/SidebarIndicators";
import { SidebarWorkspaceGitGlyph } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceGitGlyph";
import { WorkspaceItemMenu } from "#product/components/workspace/shell/sidebar/WorkspaceItemMenu";
import { WorkspaceRenamePopover } from "#product/components/workspace/shell/sidebar/WorkspaceRenamePopover";
import { ProductSidebarWorkspaceRow } from "#product/components/workspace/shell/sidebar/ProductSidebarRepositories";

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
  /**
   * Composed git/PR status. Drives the persistent PR glyph tone, its tooltip,
   * the separate attention alert, and the "Open pull request" menu item.
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
  statusIndicator = null,
  shortcutLabel = null,
  shortcutRevealVisible = false,
  branchName = null,
  gitStatus = null,
  needsReview = false,
  onSelect,
  onOpenPullRequest,
  onArchive,
  onUnarchive,
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
  const hasArchiveAction = !!(onArchive || onUnarchive);
  const [renameOpen, setRenameOpen] = useState(false);
  const [doneConfirmOpen, setDoneConfirmOpen] = useState(false);
  const handleRenameCommand = () => setRenameOpen(true);
  const handleCopyWorkspaceLocationCommand = () => onCopyWorkspaceLocation?.();
  const handleCopyBranchNameCommand = () => onCopyBranchName?.();
  const handleArchiveCommand = () => onArchive?.();
  const handleUnarchiveCommand = () => onUnarchive?.();
  const handleMarkDoneCommand = () => setDoneConfirmOpen(true);
  const trailingIdentity = <SidebarWorkspaceGitGlyph status={gitStatus} />;
  const pullRequestUrl = gitStatus?.pr?.url ?? null;
  const pullRequestNumber = gitStatus?.pr?.number ?? null;
  const handleOpenPullRequestCommand = pullRequestUrl && onOpenPullRequest
    ? () => onOpenPullRequest(pullRequestUrl)
    : undefined;
  const { onContextMenuCapture, showNativeMenu } = useWorkspaceSidebarNativeContextMenu({
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
    canMarkDone: !!onMarkDone,
    onRename: handleRenameCommand,
    onCopyWorkspaceLocation: handleCopyWorkspaceLocationCommand,
    onCopyBranchName: handleCopyBranchNameCommand,
    onOpenPullRequest: () => handleOpenPullRequestCommand?.(),
    onArchive: handleArchiveCommand,
    onUnarchive: handleUnarchiveCommand,
    onMarkDone: handleMarkDoneCommand,
    availabilityCommands,
    onAvailabilityCommand,
  });
  const hasMenuActions = hasArchiveAction
    || !!onRename
    || !!onCopyWorkspaceLocation
    || !!onCopyBranchName
    || !!onMarkDone
    || !!branchName
    || !!handleOpenPullRequestCommand
    || availabilityCommands.length > 0;

  const workspaceMenu = hasMenuActions ? (
    <WorkspaceItemMenu
      archived={archived}
      branchName={branchName}
      workspaceLocationCopyLabel={workspaceLocationCopyLabel}
      pullRequestNumber={pullRequestNumber}
      onShowNativeMenu={showNativeMenu}
      onOpenPullRequest={handleOpenPullRequestCommand}
      onRename={onRename ? handleRenameCommand : undefined}
      onArchive={onArchive ? handleArchiveCommand : undefined}
      onUnarchive={onUnarchive ? handleUnarchiveCommand : undefined}
      onCopyWorkspaceLocation={
        onCopyWorkspaceLocation ? handleCopyWorkspaceLocationCommand : undefined
      }
      onCopyBranchName={onCopyBranchName ? handleCopyBranchNameCommand : undefined}
      onMarkDone={onMarkDone ? handleMarkDoneCommand : undefined}
      availabilityCommands={availabilityCommands}
      onAvailabilityCommand={onAvailabilityCommand}
    />
  ) : null;

  const row = (
    <ProductSidebarWorkspaceRow
      active={active}
      archived={archived}
      trailingStatus={statusIndicator ? (
        <SidebarStatusIndicatorView
          indicator={statusIndicator}
          onAction={onIndicatorAction}
        />
      ) : null}
      trailingIdentity={trailingIdentity}
      label={name}
      unreadDot={needsReview}
      shortcutLabel={shortcutLabel}
      shortcutRevealVisible={shortcutRevealVisible}
      hoverAction={workspaceMenu}
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
              <div className="px-2.5 py-2 text-ui text-foreground">
                <div className="font-medium">Delete workspace?</div>
                <div className="mt-1 text-ui-sm leading-4 text-muted-foreground">
                  This removes the local worktree, workspace record, chat history, and local agent
                  artifacts for this workspace. Commits, branches, and pull requests are not deleted.
                </div>
                <div className="mt-1 text-ui-sm leading-4 text-muted-foreground">
                  This cannot be undone from Proliferate.
                </div>
              </div>
              <PopoverMenuItem
                icon={<Trash className="icon-paired shrink-0 text-muted-foreground" />}
                label="Delete workspace"
                onClick={() => {
                  close();
                  setDoneConfirmOpen(false);
                  onMarkDone?.();
                }}
              />
              <PopoverMenuItem
                label="Cancel"
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
                  icon={<Pencil className="icon-paired shrink-0 text-muted-foreground" />}
                  label="Rename"
                  onClick={() => {
                    close();
                    handleRenameCommand();
                  }}
                />
              )}
              {onCopyWorkspaceLocation && (
                <PopoverMenuItem
                  icon={<Folder className="icon-paired shrink-0 text-muted-foreground" />}
                  label={workspaceLocationCopyLabel ?? "Copy workspace location"}
                  trailing={(
                    <ShortcutBadge
                      label={getShortcutDisplayLabel(SHORTCUTS.copyWorkspacePath)}
                      className="text-muted-foreground"
                    />
                  )}
                  onClick={() => {
                    close();
                    handleCopyWorkspaceLocationCommand();
                  }}
                />
              )}
              {handleOpenPullRequestCommand && (
                <PopoverMenuItem
                  icon={<GitPullRequest className="icon-paired shrink-0 text-muted-foreground" />}
                  label={pullRequestNumber !== null
                    ? `Open pull request #${pullRequestNumber}`
                    : "Open pull request"}
                  onClick={() => {
                    close();
                    handleOpenPullRequestCommand();
                  }}
                />
              )}
              {onCopyBranchName && (
                <PopoverMenuItem
                  icon={<GitBranchIcon className="icon-paired shrink-0 text-muted-foreground [font-size:var(--text-sidebar-row)]" />}
                  label="Copy branch name"
                  trailing={(
                    <ShortcutBadge
                      label={getShortcutDisplayLabel(SHORTCUTS.copyBranchName)}
                      className="text-muted-foreground"
                    />
                  )}
                  onClick={() => {
                    close();
                    handleCopyBranchNameCommand();
                  }}
                />
              )}
              {onMarkDone && (
                <PopoverMenuItem
                  icon={<Trash className="icon-paired shrink-0 text-muted-foreground" />}
                  label="Delete workspace..."
                  onClick={() => {
                    handleMarkDoneCommand();
                  }}
                />
              )}
              {onArchive && !archived && (
                <PopoverMenuItem
                  icon={<Archive className="icon-paired shrink-0 text-muted-foreground" />}
                  label="Archive..."
                  onClick={() => { close(); handleArchiveCommand(); }}
                />
              )}
              {onUnarchive && archived && (
                <PopoverMenuItem
                  icon={<Archive className="icon-paired shrink-0 text-muted-foreground" />}
                  label="Unarchive"
                  onClick={() => { close(); handleUnarchiveCommand(); }}
                />
              )}
              {availabilityCommands.map((command) => (
                <PopoverMenuItem
                  key={command.kind}
                  icon={<GitBranchIcon className="icon-paired shrink-0 text-muted-foreground" />}
                  label={command.blocker ? `${command.label} — ${command.blocker}` : command.label}
                  onClick={() => {
                    close();
                    onAvailabilityCommand?.(command.kind);
                  }}
                />
              ))}
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
