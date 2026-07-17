import { type ReactNode, useEffect, useState } from "react";
import { ChevronRight, CloudIcon, FolderClosedFilled, FolderFilled, FolderRemote, MoreHorizontal, Plus, Settings, Trash } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { ShortcutBadge } from "@proliferate/ui/layout/ShortcutBadge";
import { SidebarWorkspaceVariantIcon } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import type { NewWorkspaceCommandScope } from "#product/lib/domain/workspaces/creation/new-workspace-command";
import {
  confirmRepoRemoval,
  repoRemovalConfirmationCopy,
  requestRepoRemovalConfirmation,
} from "#product/lib/domain/workspaces/sidebar/repo-context-menu";
import {
  buildRepoGroupMenuModel,
  useRepoGroupNativeContextMenu,
  type RepoGroupMenuAction,
  type RepoGroupMenuHandlers,
} from "#product/hooks/workspaces/ui/use-repo-group-native-context-menu";
import { useNewWorkspaceCommandScopeStore } from "#product/stores/workspaces/new-workspace-command-scope-store";
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
  onRemoveRepo?: () => Promise<void> | void;
  onOpenSettings?: () => void;
  /** True when the repo has a supported GitHub identity (Cloud-capable). */
  isGitHubRepo?: boolean;
  /** Desktop + non-disabled managed Cloud can offer "Set up Cloud". */
  canSetUpCloud?: boolean;
  /** Opens the Cloud action dialog / recovery surface for this repo. */
  onSetUpCloud?: () => void;
  /** Desktop-only: register an existing local folder for this Cloud repo. */
  onAddToThisMac?: () => void;
  /** Opens the repo's Cloud settings surface. */
  onOpenCloudSettings?: () => void;
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
  isGitHubRepo = false,
  canSetUpCloud = false,
  onSetUpCloud,
  onAddToThisMac,
  onOpenCloudSettings,
}: RepoGroupProps) {
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const setActiveNewWorkspaceScope = useNewWorkspaceCommandScopeStore((state) => state.setActiveScope);
  const clearActiveNewWorkspaceScope = useNewWorkspaceCommandScopeStore((state) => state.clearActiveScope);
  const handleRequestRemove = () => requestRepoRemovalConfirmation(
    () => setRemoveConfirmOpen(true),
  );
  const handleConfirmRemove = async () => {
    setRemovePending(true);
    setRemoveError(null);
    try {
      await confirmRepoRemoval({
        closeConfirmation: () => setRemoveConfirmOpen(false),
        removeRepo: onRemoveRepo,
      });
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Could not remove repository.");
    } finally {
      setRemovePending(false);
    }
  };
  const removeConfirmationCopy = repoRemovalConfirmationCopy(name, environmentKind !== "local");
  const menuModel = buildRepoGroupMenuModel({
    environmentKind,
    isGitHubRepo,
    canSetUpCloud: canSetUpCloud && !!onSetUpCloud,
    canAddToThisMac: !!onAddToThisMac,
    canOpenCloudSettings: !!onOpenCloudSettings,
    canOpenRepositorySettings: !!onOpenSettings,
    canRemoveRepo: !!onRemoveRepo,
  });
  const menuHandlers: RepoGroupMenuHandlers = {
    "set-up-cloud": onSetUpCloud,
    "add-to-this-mac": onAddToThisMac,
    "cloud-settings": onOpenCloudSettings,
    "repository-settings": onOpenSettings,
    "remove-repository": handleRequestRemove,
  };
  const { onContextMenuCapture } = useRepoGroupNativeContextMenu(menuModel, menuHandlers);
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
        <>
        <PopoverButton
          trigger={
            <SidebarActionButton
              title="New workspace"
              alwaysVisible
              className="rounded-md opacity-0 group-hover/folder-row:opacity-100 focus-visible:opacity-100"
            >
              <Plus className="size-3" />
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
        {menuModel.length > 0 ? (
          <PopoverButton
            trigger={
              <SidebarActionButton
                title="Repository options"
                alwaysVisible
                className="opacity-0 group-hover/folder-row:opacity-100 focus-visible:opacity-100"
              >
                <MoreHorizontal className="size-3" />
              </SidebarActionButton>
            }
            side="right"
            stopPropagation
            className={`w-52 ${POPOVER_SURFACE_CLASS}`}
          >
            {(close) => (
              <RepoContextMenuContent
                model={menuModel}
                handlers={menuHandlers}
                onClose={close}
              />
            )}
          </PopoverButton>
        ) : null}
        </>
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
            model={menuModel}
            handlers={menuHandlers}
            onClose={close}
          />
        )}
      </PopoverButton>
      <ConfirmationDialog
        open={removeConfirmOpen}
        title={removeConfirmationCopy.title}
        description={removeError
          ? `${removeConfirmationCopy.description} ${removeError}`
          : removeConfirmationCopy.description}
        confirmLabel={removeConfirmationCopy.confirmLabel}
        confirmVariant={removeConfirmationCopy.confirmVariant}
        disableClose={removePending}
        loading={removePending}
        onClose={() => {
          setRemoveConfirmOpen(false);
          setRemoveError(null);
        }}
        onConfirm={() => void handleConfirmRemove()}
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
  // Codex parity: remote-capable repos use the fused folder+globe glyph —
  // one icon, never a badge overlay.
  if (kind === "cloud" || kind === "local_cloud") {
    return <FolderRemote className="size-4 shrink-0" />;
  }

  const FolderIcon = expanded ? FolderFilled : FolderClosedFilled;
  return <FolderIcon className="size-4 shrink-0" />;
}

function repoMenuActionIcon(id: RepoGroupMenuAction["id"]) {
  switch (id) {
    case "set-up-cloud":
    case "add-to-this-mac":
    case "cloud-settings":
      return <CloudIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "repository-settings":
      return <Settings className="size-3.5 shrink-0 text-muted-foreground" />;
    case "remove-repository":
      return <Trash className="size-3.5 shrink-0" />;
  }
}

function RepoContextMenuContent({
  model,
  handlers,
  onClose,
}: {
  model: RepoGroupMenuAction[];
  handlers: RepoGroupMenuHandlers;
  onClose: () => void;
}) {
  return (
    <>
      {model.map((action, index) => (
        <div key={action.id}>
          {action.destructive && index > 0 ? (
            <div className="my-1 h-px bg-border" />
          ) : null}
          <PopoverMenuItem
            icon={repoMenuActionIcon(action.id)}
            label={action.label}
            variant="sidebar"
            className={action.destructive ? "text-destructive hover:text-destructive" : undefined}
            onClick={() => { onClose(); handlers[action.id]?.(); }}
          />
        </div>
      ))}
    </>
  );
}
