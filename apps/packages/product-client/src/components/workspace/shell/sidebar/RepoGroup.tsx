import { type ReactNode, useEffect, useState } from "react";
import { AppShellNewChatIcon } from "#product/primitives/icons/app-shell";
import { Settings, Trash } from "#product/primitives/icons/core";
import { CloudIcon } from "#product/primitives/icons/platform";
import { FolderClosed, FolderFilled, FolderRemote } from "#product/primitives/icons/workspace";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { ConfirmationDialog } from "#product/primitives/patterns/ConfirmationDialog";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { SidebarWorkspaceVariantIcon } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import { getShortcutNativeAccelerator } from "#product/lib/domain/shortcuts/native-accelerators";
import type { NewWorkspaceCommandScope } from "#product/lib/domain/workspaces/creation/new-workspace-command";
import {
  confirmRepoRemoval,
  repoRemovalConfirmationCopy,
  requestRepoRemovalConfirmation,
} from "#product/lib/domain/workspaces/sidebar/repo-context-menu";
import {
  buildRepoGroupMenuModel,
  buildRepoGroupCreationMenuModel,
  useRepoGroupNativeContextMenu,
  type RepoGroupMenuAction,
  type RepoGroupMenuHandlers,
} from "#product/hooks/workspaces/ui/use-repo-group-native-context-menu";
import { useNewWorkspaceCommandScopeStore } from "#product/stores/workspaces/new-workspace-command-scope-store";
import { SidebarActionButton } from "#product/primitives/patterns/SidebarActionButton";
import { ProductSidebarRepoGroupHeader } from "#product/components/workspace/shell/sidebar/ProductSidebarRepositories";

interface RepoGroupProps {
  name: string;
  collapsed: boolean;
  environmentKind?: RepoGroupEnvironmentKind;
  children: ReactNode;
  onToggleCollapsed: () => void;
  onNewChat?: () => void;
  onNewWorkspace?: () => void;
  onNewLocalWorkspace?: () => void;
  onCloudWorkspaceAction?: () => void;
  newWorkspaceCommandScope?: NewWorkspaceCommandScope | null;
  cloudWorkspaceLabel?: string;
  /**
   * False when this host cannot create local workspaces at all (Web). The
   * context menu then offers only the cloud action, so it stops describing
   * that action as the "cloud" one.
   */
  localWorkspacesSupported?: boolean;
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
  collapsed,
  environmentKind = "local",
  children,
  onToggleCollapsed,
  onNewChat,
  onNewWorkspace,
  onNewLocalWorkspace,
  onCloudWorkspaceAction,
  newWorkspaceCommandScope,
  cloudWorkspaceLabel = "New cloud workspace",
  localWorkspacesSupported = true,
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
  const managementMenuModel = buildRepoGroupMenuModel({
    environmentKind,
    isGitHubRepo,
    canSetUpCloud: canSetUpCloud && !!onSetUpCloud,
    canAddToThisMac: !!onAddToThisMac,
    canOpenCloudSettings: !!onOpenCloudSettings,
    canOpenRepositorySettings: !!onOpenSettings,
    canRemoveRepo: !!onRemoveRepo,
  });
  const showLocalWorkspaceActions = localWorkspacesSupported && environmentKind !== "cloud";
  const creationMenuModel = buildRepoGroupCreationMenuModel({
    showLocalWorkspaceActions,
    cloudWorkspaceLabel: onCloudWorkspaceAction && cloudWorkspaceLabel
      ? cloudWorkspaceLabel
      : null,
    cloudWorkspaceEnabled,
    cloudWorkspaceTooltip,
    shortcuts: {
      local: {
        accelerator: getShortcutNativeAccelerator(SHORTCUTS.newLocal) ?? undefined,
        label: getShortcutDisplayLabel(SHORTCUTS.newLocal),
      },
      worktree: {
        accelerator: getShortcutNativeAccelerator(SHORTCUTS.newWorktree) ?? undefined,
        label: getShortcutDisplayLabel(SHORTCUTS.newWorktree),
      },
      cloud: {
        accelerator: getShortcutNativeAccelerator(SHORTCUTS.newCloud) ?? undefined,
        label: getShortcutDisplayLabel(SHORTCUTS.newCloud),
      },
    },
  });
  const menuModel = [
    ...creationMenuModel,
    ...managementMenuModel.map((action, index) => (
      index === 0 && creationMenuModel.length > 0
        ? { ...action, separatorBefore: true }
        : action
    )),
  ];
  const menuHandlers: RepoGroupMenuHandlers = {
    "new-local-workspace": onNewLocalWorkspace,
    "new-worktree": onNewWorkspace,
    "new-cloud-workspace": onCloudWorkspaceAction,
    "set-up-cloud": onSetUpCloud,
    "add-to-this-mac": onAddToThisMac,
    "cloud-settings": onOpenCloudSettings,
    "repository-settings": onOpenSettings,
    "remove-repository": handleRequestRemove,
  };
  const { onContextMenuCapture } = useRepoGroupNativeContextMenu(menuModel, menuHandlers);
  const handleContextMenuOpenChange = (open: boolean) => {
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

  const repositoryIcon = (
    <RepoGroupEnvironmentIcon kind={environmentKind} expanded={!collapsed} />
  );
  const headerRow = (
    <ProductSidebarRepoGroupHeader
      label={name}
      collapsed={collapsed}
      icon={repositoryIcon}
      hoverIcon={repositoryIcon}
      onToggleCollapsed={onToggleCollapsed}
      onContextMenuCapture={onContextMenuCapture}
      action={(
        onNewChat ? (
          <SidebarActionButton
            title={`New chat in ${name}`}
            alwaysVisible
            onClick={onNewChat}
            className="[&_svg]:icon-indicator"
          >
            <AppShellNewChatIcon className="icon-indicator" />
          </SidebarActionButton>
        ) : null
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
        onOpenChange={handleContextMenuOpenChange}
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
  // Remote-capable repos use the fused folder+globe glyph —
  // one icon, never a badge overlay.
  if (kind === "cloud" || kind === "local_cloud") {
    return <FolderRemote className="icon-indicator shrink-0" />;
  }

  const FolderIcon = expanded ? FolderFilled : FolderClosed;
  return <FolderIcon className="icon-indicator shrink-0" />;
}

function repoMenuActionIcon(id: RepoGroupMenuAction["id"]) {
  switch (id) {
    case "new-local-workspace":
      return (
        <SidebarWorkspaceVariantIcon
          variant="local"
          className="icon-paired shrink-0 [font-size:var(--text-sidebar-row)]"
        />
      );
    case "new-worktree":
      return (
        <SidebarWorkspaceVariantIcon
          variant="worktree"
          className="icon-paired shrink-0 [font-size:var(--text-sidebar-row)]"
        />
      );
    case "new-cloud-workspace":
      return <CloudIcon className="icon-paired shrink-0 [font-size:var(--text-sidebar-row)]" />;
    case "set-up-cloud":
    case "add-to-this-mac":
    case "cloud-settings":
      return <CloudIcon className="icon-paired shrink-0 text-muted-foreground [font-size:var(--text-sidebar-row)]" />;
    case "repository-settings":
      return <Settings className="icon-paired shrink-0 text-muted-foreground" />;
    case "remove-repository":
      return <Trash className="icon-paired shrink-0" />;
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
          {(action.separatorBefore || action.destructive) && index > 0 ? (
            <div className="my-1 h-px bg-border" />
          ) : null}
          <PopoverMenuItem
            icon={repoMenuActionIcon(action.id)}
            label={action.label}
            title={action.disabledReason}
            disabled={action.disabled}
            trailing={action.shortcutLabel ? (
              <ShortcutBadge
                label={action.shortcutLabel}
                className={CREATE_WORKSPACE_SHORTCUT_CLASS}
              />
            ) : null}
            className={action.destructive ? "text-destructive hover:text-destructive" : undefined}
            onClick={() => {
              if (action.disabled) return;
              onClose();
              handlers[action.id]?.();
            }}
          />
        </div>
      ))}
    </>
  );
}
