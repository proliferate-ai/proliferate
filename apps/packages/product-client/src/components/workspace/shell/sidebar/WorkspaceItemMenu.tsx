import { useCallback, useRef, useState } from "react";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import {
  Archive,
  CloudIcon,
  Folder,
  GitBranchIcon,
  GitPullRequest,
  Link2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash,
} from "@proliferate/ui/icons";
import type {
  WorkspaceAvailabilityCommand,
  WorkspaceAvailabilityCommandKind,
} from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";

interface WorkspaceItemMenuProps {
  archived: boolean;
  /** Current git branch, shown read-only in the git section. */
  branchName: string | null;
  workspaceLocationCopyLabel?: string | null;
  /** PR number for the "Open pull request" label; null shows the bare label. */
  pullRequestNumber?: number | null;
  /** Handlers are optional; omitted ones hide their menu item. */
  onOpenPullRequest?: () => void;
  onRename?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onCopyWorkspaceLocation?: () => void;
  onCopyBranchName?: () => void;
  onMarkDone?: () => void;
  /** Workspace-copy availability commands (PR 5), resolved from the shared
   * availability command model so this menu and the native menu match. */
  availabilityCommands?: WorkspaceAvailabilityCommand[];
  /** Invoked with the command kind when an actionable availability command is
   * selected. Blocker commands (unsupported Git state) render disabled. */
  onAvailabilityCommand?: (kind: WorkspaceAvailabilityCommandKind) => void;
  onShowNativeMenu?: (position?: { x: number; y: number }) => Promise<boolean>;
}

const AVAILABILITY_COMMAND_ICON: Record<WorkspaceAvailabilityCommandKind, typeof CloudIcon> = {
  "add-cloud-copy": CloudIcon,
  "open-on-this-mac": Folder,
  "link-copies": Link2,
  "relink-existing": Link2,
  "recreate-on-this-mac": RotateCcw,
  "unlink-this-mac": Link2,
  "reconcile-git-state": GitBranchIcon,
};

/**
 * Three-dot workspace menu (UX spec §2), built on the kit DropdownMenu with
 * the §7 overlay recipe. The git section carries the "Open pull request"
 * action (when a PR is known for the branch), the read-only branch row, and
 * copy branch name.
 */
export function WorkspaceItemMenu({
  archived,
  branchName,
  workspaceLocationCopyLabel,
  pullRequestNumber = null,
  onOpenPullRequest,
  onRename,
  onArchive,
  onUnarchive,
  onCopyWorkspaceLocation,
  onCopyBranchName,
  onMarkDone,
  availabilityCommands = [],
  onAvailabilityCommand,
  onShowNativeMenu,
}: WorkspaceItemMenuProps) {
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setFallbackOpen(false);
      return;
    }
    if (!onShowNativeMenu) {
      setFallbackOpen(true);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    void onShowNativeMenu(rect ? { x: rect.left, y: rect.bottom } : undefined).then((shown) => {
      if (!shown) setFallbackOpen(true);
    });
  }, [onShowNativeMenu]);
  return (
    <DropdownMenu open={fallbackOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <IconButton
          ref={triggerRef}
          tone="sidebar"
          size="xs"
          onClick={(e) => e.stopPropagation()}
          title="Workspace actions"
          className="opacity-50 hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onClick={(e) => e.stopPropagation()}
        className="min-w-[220px]"
      >
        {onRename && (
          <DropdownMenuItem onSelect={onRename}>
            <Pencil className="size-4 text-muted-foreground" />
            Rename
          </DropdownMenuItem>
        )}
        {onArchive && !archived && (
          <DropdownMenuItem onSelect={onArchive}>
            <Archive className="size-4 text-muted-foreground" />
            Archive...
          </DropdownMenuItem>
        )}
        {onUnarchive && archived && (
          <DropdownMenuItem onSelect={onUnarchive}>
            <Archive className="size-4 text-muted-foreground" />
            Unarchive
          </DropdownMenuItem>
        )}
        {onCopyWorkspaceLocation && (
          <DropdownMenuItem onSelect={onCopyWorkspaceLocation}>
            <Folder className="size-4 text-muted-foreground" />
            {workspaceLocationCopyLabel ?? "Copy workspace location"}
            <DropdownMenuShortcut>
              {getShortcutDisplayLabel(SHORTCUTS.copyWorkspacePath)}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        {availabilityCommands.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {availabilityCommands.map((command) => {
              const Icon = AVAILABILITY_COMMAND_ICON[command.kind];
              return (
                <DropdownMenuItem
                  key={command.kind}
                  onSelect={() => {
                    onAvailabilityCommand?.(command.kind);
                  }}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block">{command.label}</span>
                    {command.blocker ? (
                      <span className="block text-xs leading-[1.4] text-muted-foreground">
                        {command.blocker}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
        {(branchName || onCopyBranchName || onOpenPullRequest) && (
          <>
            <DropdownMenuSeparator />
            {onOpenPullRequest && (
              <DropdownMenuItem onSelect={onOpenPullRequest}>
                <GitPullRequest className="size-4 text-muted-foreground" />
                {pullRequestNumber !== null
                  ? `Open pull request #${pullRequestNumber}`
                  : "Open pull request"}
              </DropdownMenuItem>
            )}
            {branchName && (
              <div className="flex items-center gap-2 px-2 py-1.5 font-mono text-ui-sm text-muted-foreground">
                <GitBranchIcon className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{branchName}</span>
              </div>
            )}
            {onCopyBranchName && (
              <DropdownMenuItem onSelect={onCopyBranchName}>
                <GitBranchIcon className="size-4 text-muted-foreground" />
                Copy branch name
                <DropdownMenuShortcut>
                  {getShortcutDisplayLabel(SHORTCUTS.copyBranchName)}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
          </>
        )}
        {onMarkDone && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onMarkDone}>
              <Trash className="size-4" />
              Delete workspace...
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
