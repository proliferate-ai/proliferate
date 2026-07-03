import { type ReactNode, useEffect, useState } from "react";
import { ChevronRight, CloudIcon, FolderClosedFilled, FolderFilled, Globe, Settings, SquarePlus, Trash } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { ShortcutBadge } from "@proliferate/ui/layout/ShortcutBadge";
import { SidebarWorkspaceVariantIcon } from "@/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import type { NewWorkspaceCommandScope } from "@/lib/domain/workspaces/creation/new-workspace-command";
import {
  confirmRepoRemoval,
  repoRemovalConfirmationCopy,
  requestRepoRemovalConfirmation,
} from "@/lib/domain/workspaces/sidebar/repo-context-menu";
import { useRepoGroupNativeContextMenu } from "@/hooks/workspaces/ui/use-repo-group-native-context-menu";
import { useNewWorkspaceCommandScopeStore } from "@/stores/workspaces/new-workspace-command-scope-store";
import { SidebarActionButton } from "@proliferate/ui/layout/SidebarActionButton";
import { ProductSidebarRepoGroupHeader } from "@proliferate/product-ui/sidebar/ProductSidebarRepositories";

interface RepoGroupProps {
  name: string;
  count: number;
  collapsed: boolean;
  environmentKind?: RepoGroupEnvironmentKind;
  children: ReactNode;
  onToggleCollapsed: () => void;
  onNewWorkspace?: () => void;
  onNewLocalWorkspace?: () => void;
  onCloudWorkspaceAction?: () => void;
  newWorkspaceCommandScope?: NewWorkspaceCommandScope | null;
  cloudWorkspaceLabel?: string;
  cloudWorkspaceEnabled?: boolean;
  cloudWorkspaceTooltip?: string;
  onRemoveRepo?: () => void;
  onOpenSettings?: () => void;
}

export type RepoGroupEnvironmentKind = "local" | "local_cloud" | "cloud";

const CREATE_WORKSPACE_SHORTCUT_CLASS = "shrink-0 text-muted-foreground/70";

export function RepoGroup({
  name,
  count,
  collapsed,
  environmentKind = "local",
  children,
  onToggleCollapsed,
  onNewWorkspace,
  onNewLocalWorkspace,
  onCloudWorkspaceAction,
  newWorkspaceCommandScope,
  cloudWorkspaceLabel = "New cloud workspace",
  cloudWorkspaceEnabled = true,
  cloudWorkspaceTooltip,
  onRemoveRepo,
  onOpenSettings,
}: RepoGroupProps) {
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const setActiveNewWorkspaceScope = useNewWorkspaceCommandScopeStore((state) => state.setActiveScope);
  const clearActiveNewWorkspaceScope = useNewWorkspaceCommandScopeStore((state) => state.clearActiveScope);
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
  const handleCreatePopoverOpenChange = (open: boolean) => {
    if (!newWorkspaceCommandScope) {
      return;
    }
    if (open) {
      setActiveNewWorkspaceScope(newWorkspaceCommandScope);
    } else {
      clearActiveNewWorkspaceScope(newWorkspaceCommandScope.id);
    }
  };
  useEffect(() => {
    const scopeId = newWorkspaceCommandScope?.id;
    return () => {
      if (scopeId) {
        clearActiveNewWorkspaceScope(scopeId);
      }
    };
  }, [clearActiveNewWorkspaceScope, newWorkspaceCommandScope?.id]);
  const showLocalWorkspaceActions = environmentKind !== "cloud";

  const headerRow = (
    <ProductSidebarRepoGroupHeader
      label={name}
      count={count}
      collapsed={collapsed}
      icon={<RepoGroupEnvironmentIcon kind={environmentKind} expanded={false} />}
      expandedIcon={<RepoGroupEnvironmentIcon kind={environmentKind} expanded />}
      hoverIcon={(
        <ChevronRight
          className={`size-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
      )}
      onToggleCollapsed={onToggleCollapsed}
      onContextMenuCapture={onContextMenuCapture}
      action={(
        <PopoverButton
          trigger={
            <SidebarActionButton
              title="New workspace"
              alwaysVisible
              className="absolute inset-0 rounded-md opacity-0 group-hover/folder-row:opacity-100 focus-visible:opacity-100"
            >
              <SquarePlus className="size-3" />
            </SidebarActionButton>
          }
          side="right"
          stopPropagation
          className={`w-64 ${POPOVER_SURFACE_CLASS}`}
          onOpenChange={handleCreatePopoverOpenChange}
        >
          {(close) => (
            <>
              {showLocalWorkspaceActions && (
                <>
                  <PopoverMenuItem
                    icon={<SidebarWorkspaceVariantIcon variant="local" className="size-3.5 shrink-0" />}
                    label="New local workspace"
                    trailing={(
                      <ShortcutBadge
                        label={getShortcutDisplayLabel(SHORTCUTS.newLocal)}
                        className={CREATE_WORKSPACE_SHORTCUT_CLASS}
                      />
                    )}
                    onClick={() => { close(); onNewLocalWorkspace?.(); }}
                  />
                  <PopoverMenuItem
                    icon={<SidebarWorkspaceVariantIcon variant="worktree" className="size-3.5 shrink-0" />}
                    label="New worktree"
                    trailing={(
                      <ShortcutBadge
                        label={getShortcutDisplayLabel(SHORTCUTS.newWorktree)}
                        className={CREATE_WORKSPACE_SHORTCUT_CLASS}
                      />
                    )}
                    onClick={() => { close(); onNewWorkspace?.(); }}
                  />
                </>
              )}
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
      )}
    />
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

function RepoGroupEnvironmentIcon({
  kind,
  expanded,
}: {
  kind: RepoGroupEnvironmentKind;
  expanded: boolean;
}) {
  const FolderIcon = expanded ? FolderFilled : FolderClosedFilled;

  if (kind === "cloud") {
    return <CloudIcon className="size-3.5 shrink-0" />;
  }

  if (kind === "local_cloud") {
    return (
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="absolute -bottom-0.5 -right-0.5 flex size-2.5 items-center justify-center rounded-full bg-sidebar text-sidebar-muted-foreground">
          <Globe className="size-2" />
        </span>
      </span>
    );
  }

  return <FolderIcon className="size-3.5 shrink-0" />;
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
