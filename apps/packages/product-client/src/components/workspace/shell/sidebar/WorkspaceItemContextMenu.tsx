import { SHORTCUTS } from "#product/config/shortcuts/registry";
import {
  Archive,
  Pencil,
  Trash,
} from "#product/primitives/icons/core";
import { Folder, Pin } from "#product/primitives/icons/workspace";
import {
  GitBranchIcon,
  GitPullRequest,
} from "#product/primitives/icons/workspace-git";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import type {
  WorkspaceAvailabilityCommand,
  WorkspaceAvailabilityCommandKind,
} from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import { WorkspaceDeleteConfirmMenu } from "#product/components/workspace/shell/sidebar/WorkspaceDeleteConfirmMenu";

interface WorkspaceItemContextMenuProps {
  /** Closes the popover. Handed down from `PopoverButton`'s render prop. */
  close: () => void;
  archived: boolean;
  pinned: boolean;
  workspaceLocationCopyLabel?: string | null;
  /** PR number for the "Open pull request" label; null shows the bare label. */
  pullRequestNumber?: number | null;
  /** True while the destructive pane replaces the item list entirely. */
  doneConfirmOpen: boolean;
  /** Runs after `close()` when the delete confirmation is accepted. */
  onConfirmDone: () => void;
  /** Runs after `close()` when the delete confirmation is dismissed. */
  onCancelDone: () => void;
  /** Handlers are optional; omitted ones hide their menu item. */
  onRename?: () => void;
  onPin?: () => void;
  onUnpin?: () => void;
  onCopyWorkspaceLocation?: () => void;
  onOpenPullRequest?: () => void;
  onCopyBranchName?: () => void;
  onMarkDone?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  /** Workspace-copy availability commands (PR 5), matching the native menu. */
  availabilityCommands?: WorkspaceAvailabilityCommand[];
  onAvailabilityCommand?: (kind: WorkspaceAvailabilityCommandKind) => void;
}

/**
 * The right-click menu's contents for a sidebar workspace row.
 *
 * Split from `WorkspaceItem` for the same reason `WorkspaceItemTrailing` was:
 * the row owns state and commands, this owns only how they read as a list.
 * Everything here is declarative — the open/confirm state and every command
 * handler stay on the row, so this file can be read as the menu's shape
 * without chasing what any item actually does.
 *
 * `close` arrives as a prop rather than being called for the caller, because
 * the items disagree about it: most close first and then act, while "Delete
 * workspace..." deliberately leaves the popover open so the confirmation pane
 * can take its place.
 */
export function WorkspaceItemContextMenu({
  close,
  archived,
  pinned,
  workspaceLocationCopyLabel,
  pullRequestNumber = null,
  doneConfirmOpen,
  onConfirmDone,
  onCancelDone,
  onRename,
  onPin,
  onUnpin,
  onCopyWorkspaceLocation,
  onOpenPullRequest,
  onCopyBranchName,
  onMarkDone,
  onArchive,
  onUnarchive,
  availabilityCommands = [],
  onAvailabilityCommand,
}: WorkspaceItemContextMenuProps) {
  if (doneConfirmOpen) {
    return (
      <WorkspaceDeleteConfirmMenu
        onConfirm={() => {
          close();
          onConfirmDone();
        }}
        onCancel={() => {
          close();
          onCancelDone();
        }}
      />
    );
  }

  return (
    <>
      {onRename && (
        <PopoverMenuItem
          icon={<Pencil className="icon-paired shrink-0 text-muted-foreground" />}
          label="Rename"
          onClick={() => {
            close();
            onRename();
          }}
        />
      )}
      {onPin && !pinned && (
        <PopoverMenuItem
          icon={<Pin className="icon-paired shrink-0 text-muted-foreground" />}
          label="Pin"
          onClick={() => { close(); onPin(); }}
        />
      )}
      {onUnpin && pinned && (
        <PopoverMenuItem
          icon={<Pin className="icon-paired shrink-0 text-muted-foreground" />}
          label="Unpin"
          onClick={() => { close(); onUnpin(); }}
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
            onCopyWorkspaceLocation();
          }}
        />
      )}
      {onOpenPullRequest && (
        <PopoverMenuItem
          icon={<GitPullRequest className="icon-paired shrink-0 text-muted-foreground" />}
          label={pullRequestNumber !== null
            ? `Open pull request #${pullRequestNumber}`
            : "Open pull request"}
          onClick={() => {
            close();
            onOpenPullRequest();
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
            onCopyBranchName();
          }}
        />
      )}
      {onMarkDone && (
        <PopoverMenuItem
          icon={<Trash className="icon-paired shrink-0 text-muted-foreground" />}
          label="Delete workspace..."
          // No close(): the popover stays open so the confirmation pane can
          // replace this list in place.
          onClick={() => {
            onMarkDone();
          }}
        />
      )}
      {onArchive && !archived && (
        <PopoverMenuItem
          icon={<Archive className="icon-paired shrink-0 text-muted-foreground" />}
          label="Archive"
          onClick={() => { close(); onArchive(); }}
        />
      )}
      {onUnarchive && archived && (
        <PopoverMenuItem
          icon={<Archive className="icon-paired shrink-0 text-muted-foreground" />}
          label="Unarchive"
          onClick={() => { close(); onUnarchive(); }}
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
  );
}
