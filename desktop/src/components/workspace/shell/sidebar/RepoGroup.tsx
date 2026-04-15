import { type ReactNode, useState } from "react";
import { ChevronRight, CloudIcon, Folder, FolderFilled, GitBranchIcon, Plus, Settings, Trash } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { SHORTCUTS } from "@/config/shortcuts";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import { SidebarActionButton } from "./SidebarActionButton";

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

const POPOVER_ROW =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-sidebar-accent";

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
  const headerRow = (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggleCollapsed}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleCollapsed();
        }
      }}
      className="group/folder-row flex cursor-pointer select-none items-center justify-between overflow-x-hidden text-sm rounded-lg hover:bg-sidebar-accent py-0.5 h-[30px] focus-visible:outline focus-visible:outline-offset-2"
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
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {name}
        </span>

        <div className="relative ml-auto size-6 shrink-0">
          <span className="absolute inset-0 flex items-center justify-center font-mono text-sm text-foreground/40 transition-opacity group-hover/folder-row:opacity-0">
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
            className="w-64 rounded-xl border border-border bg-popover p-1 shadow-floating"
          >
            {(close) => (
              <>
                <button
                  type="button"
                  onClick={() => { close(); onNewLocalWorkspace?.(); }}
                  className={POPOVER_ROW}
                >
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-left">New local workspace</span>
                  <span className="shrink-0 text-xs text-muted-foreground/60">{SHORTCUTS.newLocal.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => { close(); onNewWorkspace?.(); }}
                  className={POPOVER_ROW}
                >
                  <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-left">New worktree</span>
                  <span className="shrink-0 text-xs text-muted-foreground/60">{SHORTCUTS.newWorktree.label}</span>
                </button>
                {onCloudWorkspaceAction && cloudWorkspaceLabel && (
                  cloudWorkspaceEnabled ? (
                    <button
                      type="button"
                      onClick={() => { close(); onCloudWorkspaceAction(); }}
                      className={POPOVER_ROW}
                    >
                      <CloudIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-left">{cloudWorkspaceLabel}</span>
                      <span className="shrink-0 text-xs text-muted-foreground/60">{getShortcutDisplayLabel(SHORTCUTS.newCloud)}</span>
                    </button>
                  ) : (
                    <Tooltip
                      content={cloudWorkspaceTooltip ?? "Cloud workspaces require a reachable control plane."}
                      className="block w-full"
                    >
                      <button
                        type="button"
                        aria-disabled="true"
                        onClick={(event) => { event.preventDefault(); }}
                        className={`${POPOVER_ROW} cursor-not-allowed opacity-60`}
                      >
                        <CloudIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-left">{cloudWorkspaceLabel}</span>
                        <span className="shrink-0 text-xs text-muted-foreground/60">{getShortcutDisplayLabel(SHORTCUTS.newCloud)}</span>
                      </button>
                    </Tooltip>
                  )
                )}
              </>
            )}
          </PopoverButton>
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full min-w-0">
      {/* Repo header with context menu */}
      <PopoverButton
        trigger={headerRow}
        triggerMode="contextMenu"
        stopPropagation
        className="w-52 rounded-xl border border-border bg-popover p-1 shadow-floating"
      >
        {(close) => (
          <RepoContextMenuContent
            onOpenSettings={onOpenSettings}
            onRemoveRepo={onRemoveRepo}
            onClose={close}
          />
        )}
      </PopoverButton>

      {/* Workspace items */}
      {!collapsed && <div className="flex w-full min-w-0 flex-col gap-px">{children}</div>}
    </div>
  );
}

function RepoContextMenuContent({
  onOpenSettings,
  onRemoveRepo,
  onClose,
}: {
  onOpenSettings?: () => void;
  onRemoveRepo?: () => void;
  onClose: () => void;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  return (
    <>
      {onOpenSettings && (
        <button
          type="button"
          onClick={() => { onClose(); onOpenSettings(); }}
          className={POPOVER_ROW}
        >
          <Settings className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-left">Settings</span>
        </button>
      )}
      {onOpenSettings && onRemoveRepo && (
        <div className="my-1 h-px bg-border" />
      )}
      {onRemoveRepo && !confirmingRemove && (
        <button
          type="button"
          onClick={() => setConfirmingRemove(true)}
          className={`${POPOVER_ROW} text-destructive hover:text-destructive`}
        >
          <Trash className="size-3.5 shrink-0" />
          <span className="flex-1 truncate text-left">Remove repository</span>
        </button>
      )}
      {onRemoveRepo && confirmingRemove && (
        <button
          type="button"
          onClick={() => { onClose(); onRemoveRepo(); }}
          className={`${POPOVER_ROW} text-destructive hover:text-destructive`}
        >
          <Trash className="size-3.5 shrink-0" />
          <span className="flex-1 truncate text-left">Confirm remove?</span>
        </button>
      )}
    </>
  );
}
