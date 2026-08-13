import type { SidebarIndicatorAction } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { SidebarWorkspaceItemState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import type { WorkspaceAvailabilityCommandKind } from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";
import { useWorkspaceCopyActions } from "#product/hooks/workspaces/workflows/use-workspace-copy-actions";
import { WorkspaceItem } from "#product/components/workspace/shell/sidebar/WorkspaceItem";

export interface SidebarWorkspaceItemsProps {
  items: SidebarWorkspaceItemState[];
  /**
   * Owning repository shown in the hover peek card. Repo group bodies pass
   * their group name; rows rendered outside a group (Pinned) fall back to the
   * item's own repo name.
   */
  repoName?: string | null;
  shortcutLabelByWorkspaceId: ReadonlyMap<string, string>;
  shortcutRevealVisible: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onIndicatorAction: (action: SidebarIndicatorAction) => void;
  onOpenPullRequest: (url: string) => void;
  onMarkWorkspaceDone: (workspaceId: string, logicalWorkspaceId: string) => void;
  /** Begin a workspace-copy availability action (PR 5) for the given item. */
  onWorkspaceAvailabilityCommand: (
    item: SidebarWorkspaceItemState,
    kind: WorkspaceAvailabilityCommandKind,
  ) => void;
  onWorkspaceHover?: () => void;
  onArchiveWorkspace: (workspaceId: string) => void;
  onUnarchiveWorkspace: (workspaceId: string) => void;
  onPinWorkspace: (workspaceId: string) => void;
  /** Receives every pin id the row matched (`item.pinnedIds`), not just the
   * current projection id, so unpin clears pins from former identities too. */
  onUnpinWorkspace: (pinnedIds: string[]) => void;
  onRenameWorkspace: (
    workspaceId: string,
    displayName: string | null,
  ) => Promise<unknown>;
}

/**
 * The shared workspace-row list: one `WorkspaceItem` per item state with the
 * full action wiring. Both the per-repo group bodies and the Pinned section
 * render through here so a row behaves identically wherever it appears.
 */
export function SidebarWorkspaceItems({
  items,
  repoName = null,
  shortcutLabelByWorkspaceId,
  shortcutRevealVisible,
  onSelectWorkspace,
  onIndicatorAction,
  onOpenPullRequest,
  onMarkWorkspaceDone,
  onWorkspaceAvailabilityCommand,
  onWorkspaceHover,
  onArchiveWorkspace,
  onUnarchiveWorkspace,
  onPinWorkspace,
  onUnpinWorkspace,
  onRenameWorkspace,
}: SidebarWorkspaceItemsProps) {
  const { copyWorkspaceLocation, copyBranchName } = useWorkspaceCopyActions();

  return items.map((item) => (
    <WorkspaceItem
      key={item.id}
      workspaceId={item.id}
      name={item.name}
      defaultName={item.defaultName}
      hasDisplayNameOverride={item.hasDisplayNameOverride}
      subtitle={item.subtitle}
      active={item.active}
      archived={item.archived}
      pinned={item.pinnedIds.length > 0}
      variant={item.variant}
      statusIndicator={item.statusIndicator}
      branchName={item.branchName}
      repoName={repoName ?? item.repoName}
      lastActivityLabel={item.lastInteracted
        ? formatRelativeTime(item.lastInteracted)
        : null}
      gitStatus={item.gitStatus}
      needsReview={item.needsReview}
      shortcutLabel={shortcutLabelByWorkspaceId.get(item.id) ?? null}
      shortcutRevealVisible={shortcutRevealVisible}
      onSelect={() => onSelectWorkspace(item.id)}
      onIndicatorAction={onIndicatorAction}
      onOpenPullRequest={onOpenPullRequest}
      workspaceLocationCopyLabel={item.workspaceLocationCopyLabel}
      onCopyWorkspaceLocation={
        item.workspaceLocationCopyValue && item.workspaceLocationCopyToastLabel
          ? () => void copyWorkspaceLocation({
            value: item.workspaceLocationCopyValue!,
            menuLabel: item.workspaceLocationCopyLabel ?? "Copy workspace location",
            toastLabel: item.workspaceLocationCopyToastLabel!,
            missingLabel: "No workspace location to copy.",
          })
          : undefined
      }
      onCopyBranchName={
        item.branchName
          ? () => void copyBranchName(item.branchName)
          : undefined
      }
      onMarkDone={
        item.variant === "worktree" && !item.archived && item.localWorkspaceId
          ? () => onMarkWorkspaceDone(item.localWorkspaceId!, item.id)
          : undefined
      }
      availabilityCommands={item.availabilityCommands}
      onAvailabilityCommand={(kind) => onWorkspaceAvailabilityCommand(item, kind)}
      onHover={onWorkspaceHover}
      onArchive={item.archived ? undefined : () => onArchiveWorkspace(item.id)}
      onUnarchive={item.archived ? () => onUnarchiveWorkspace(item.id) : undefined}
      onPin={item.pinnedIds.length > 0 ? undefined : () => onPinWorkspace(item.id)}
      onUnpin={item.pinnedIds.length > 0 ? () => onUnpinWorkspace(item.pinnedIds) : undefined}
      onRename={
        item.renameSupported
          ? (displayName) => onRenameWorkspace(item.id, displayName)
          : undefined
      }
    />
  ));
}
