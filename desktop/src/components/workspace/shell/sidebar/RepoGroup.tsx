import { type ReactNode, useState } from "react";
import { ChevronRight, CloudIcon, Folder, FolderFilled, GitBranchIcon, Plus, Settings, Trash } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { ShortcutBadge } from "@/components/ui/ShortcutBadge";
import { SHORTCUTS } from "@/config/shortcuts";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import {
  confirmRepoRemoval,
  repoRemovalConfirmationCopy,
  requestRepoRemovalConfirmation,
} from "@/lib/domain/workspaces/sidebar/repo-context-menu";
import { useRepoGroupNativeContextMenu } from "@/hooks/workspaces/ui/use-repo-group-native-context-menu";
import { SidebarActionButton } from "./SidebarActionButton";
import { SidebarRowSurface } from "@/components/ui/SidebarRowSurface";

interface RepoGroupProps {
  name: string;
  count: number;
  collapsed: boolean;
  children: ReactNode;
  onToggleCollapsed: () => void;
  onNewWorkspace?: () => void;
  onNewLocalWorkspace?: () => void;
  onCloudWorkspaceAction?: () => void;
  cloudWorkspaceLabel?: string;
  cloudWorkspaceEnabled?: boolean;
  cloudWorkspaceTooltip?: string;
  onRemoveRepo?: () => void;
  onOpenSettings?: () => void;
}

const CREATE_WORKSPACE_SHORTCUT_CLASS = "shrink-0 text-muted-foreground/70";

export function RepoGroup({
  name,
  count,
  collapsed,
  children,
  onToggleCollapsed,
  onNewWorkspace,
  onNewLocalWorkspace,
  onCloudWorkspaceAction,
  cloudWorkspaceLabel = "New cloud workspace",
  cloudWorkspaceEnabled = true,
  cloudWorkspaceTooltip,
  onRemoveRepo,
  onOpenSettings,
}: RepoGroupProps) {
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const handleRequestRemove = () => requestRepoRemovalConfirmation(
    () => setRemoveConfirmOpen(true),
  );
  const handleConfirmRemove = () => {
    confirmRepoRemoval({
      closeConfirmation: () => setRemoveConfirmOpen(false),
      removeRepo: onRemoveRepo,
    });
  };
  const removeConfirmationCopy = repoRemovalConfirmationCopy(name);
  const { onContextMenuCapture } = useRepoGroupNativeContextMenu({
    canOpenSettings: !!onOpenSettings,
    canRemoveRepo: !!onRemoveRepo,
    onOpenSettings: () => onOpenSettings?.(),
    onRequestRemove: handleRequestRemove,
  });

  const headerRow = (
    <SidebarRowSurface
      onPress={onToggleCollapsed}
      onContextMenuCapture={onContextMenuCapture}
      aria-expanded={!collapsed}
      className="group/folder-row h-[30px] justify-between overflow-x-hidden py-1 text-sm leading-4 focus-visible:outline-offset-[-2px]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 pl-1">
        <span className="relative flex h-6 w-6 items-center justify-center">
          {collapsed ? (
            <Folder className="size-3.5 shrink-0 group-hover/folder-row:opacity-0" />
          ) : (
            <FolderFilled className="size-3.5 shrink-0 group-hover/folder-row:opacity-0" />
          )}
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/folder-row:opacity-100">
            <ChevronRight
              className={`size-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
            />
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-base leading-5 text-current">
          {name}
        </span>

        <div className="relative ml-auto size-6 shrink-0">
          <span className="absolute inset-0 flex items-center justify-center font-mono text-[0.625rem] text-sidebar-muted-foreground transition-opacity group-hover/folder-row:opacity-0">
            {count}
          </span>
          <PopoverButton
            trigger={
              <SidebarActionButton
                title="New workspace"
                alwaysVisible
                className="absolute inset-0 rounded-md opacity-0 group-hover/folder-row:opacity-100 focus-visible:opacity-100"
              >
                <Plus className="size-3" />
              </SidebarActionButton>
            }
            side="right"
            stopPropagation
            className={`w-64 ${POPOVER_SURFACE_CLASS}`}
          >
            {(close) => (
              <>
                <PopoverMenuItem
                  icon={<Folder className="size-3.5 shrink-0" />}
                  label="New local workspace"
                  trailing={(
                    <ShortcutBadge
                      label={SHORTCUTS.newLocal.label}
                      className={CREATE_WORKSPACE_SHORTCUT_CLASS}
                    />
                  )}
                  onClick={() => { close(); onNewLocalWorkspace?.(); }}
                />
                <PopoverMenuItem
                  icon={<GitBranchIcon className="size-3.5 shrink-0" />}
                  label="New worktree"
                  trailing={(
                    <ShortcutBadge
                      label={SHORTCUTS.newWorktree.label}
                      className={CREATE_WORKSPACE_SHORTCUT_CLASS}
                    />
                  )}
                  onClick={() => { close(); onNewWorkspace?.(); }}
                />
                {onCloudWorkspaceAction && cloudWorkspaceLabel && (
                  cloudWorkspaceEnabled ? (
                    <PopoverMenuItem
                      icon={<CloudIcon className="size-3.5 shrink-0" />}
                      label={cloudWorkspaceLabel}
                      trailing={(
                        <ShortcutBadge
                          label={getShortcutDisplayLabel(SHORTCUTS.newCloud)}
                          className={CREATE_WORKSPACE_SHORTCUT_CLASS}
                        />
                      )}
                      onClick={() => { close(); onCloudWorkspaceAction(); }}
                    />
                  ) : (
                    <Tooltip
                      content={cloudWorkspaceTooltip ?? "Cloud workspaces require a reachable control plane."}
                      className="block w-full"
                    >
                      <PopoverMenuItem
                        aria-disabled="true"
                        onClick={(event) => { event.preventDefault(); }}
                        icon={<CloudIcon className="size-3.5 shrink-0" />}
                        label={cloudWorkspaceLabel}
                        trailing={(
                          <ShortcutBadge
                            label={getShortcutDisplayLabel(SHORTCUTS.newCloud)}
                            className={CREATE_WORKSPACE_SHORTCUT_CLASS}
                          />
                        )}
                        className="cursor-not-allowed opacity-60 hover:bg-transparent focus:bg-transparent"
                      />
                    </Tooltip>
                  )
                )}
              </>
            )}
          </PopoverButton>
        </div>
      </div>
    </SidebarRowSurface>
  );

  return (
    <div className="w-full min-w-0">
      {/* Repo header with context menu */}
      <PopoverButton
        trigger={headerRow}
        triggerMode="contextMenu"
        stopPropagation
        className={`w-52 ${POPOVER_SURFACE_CLASS}`}
      >
        {(close) => (
          <RepoContextMenuContent
            onOpenSettings={onOpenSettings}
            onRequestRemove={handleRequestRemove}
            onClose={close}
          />
        )}
      </PopoverButton>
      <ConfirmationDialog
        open={removeConfirmOpen}
        title={removeConfirmationCopy.title}
        description={removeConfirmationCopy.description}
        confirmLabel={removeConfirmationCopy.confirmLabel}
        confirmVariant={removeConfirmationCopy.confirmVariant}
        onClose={() => setRemoveConfirmOpen(false)}
        onConfirm={handleConfirmRemove}
      />

      {/* Workspace items */}
      {!collapsed && <div className="flex w-full min-w-0 flex-col gap-px">{children}</div>}
    </div>
  );
}

function RepoContextMenuContent({
  onOpenSettings,
  onRequestRemove,
  onClose,
}: {
  onOpenSettings?: () => void;
  onRequestRemove?: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {onOpenSettings && (
        <PopoverMenuItem
          icon={<Settings className="size-3.5 shrink-0 text-muted-foreground" />}
          label="Settings"
          variant="sidebar"
          onClick={() => { onClose(); onOpenSettings(); }}
        />
      )}
      {onOpenSettings && onRequestRemove && (
        <div className="my-1 h-px bg-border" />
      )}
      {onRequestRemove && (
        <PopoverMenuItem
          icon={<Trash className="size-3.5 shrink-0" />}
          label="Remove repository"
          variant="sidebar"
          className="text-destructive hover:text-destructive"
          onClick={() => { onClose(); onRequestRemove(); }}
        />
      )}
    </>
  );
}
