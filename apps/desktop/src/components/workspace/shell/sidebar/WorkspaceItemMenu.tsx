import { SHORTCUTS } from "@/config/shortcuts/registry";
import {
  Archive,
  Folder,
  GitBranch,
  GitPullRequest,
  MoreHorizontal,
  Pencil,
  Trash,
} from "@proliferate/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

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
}

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
}: WorkspaceItemMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
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
                <GitBranch className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{branchName}</span>
              </div>
            )}
            {onCopyBranchName && (
              <DropdownMenuItem onSelect={onCopyBranchName}>
                <GitBranch className="size-4 text-muted-foreground" />
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
