import { useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  ArrowUp,
  Copy,
  Fork,
  GitBranch,
  GitCommit,
  GitPullRequest,
  MoreHorizontal,
  Pencil,
  Trash,
} from "@proliferate/ui/icons";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

export interface WorkspaceActionsMenuGitProps {
  branchName: string | null;
  hasExistingPr: boolean;
  gitActionsDisabledReason: string | null;
  onCopyBranch: () => void;
  onCommit: () => void;
  onPush: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
}

export interface WorkspaceActionsMenuSessionProps {
  canRename: boolean;
  canFork: boolean;
  canDismiss: boolean;
  onRename: () => void;
  onFork: () => void;
  onDismiss: () => void;
}

interface WorkspaceActionsMenuProps {
  session: WorkspaceActionsMenuSessionProps;
  git: WorkspaceActionsMenuGitProps;
}

/**
 * The workspace three-dot menu (UX_SPEC §7): chat actions on top, then a git
 * section — branch row (read-only mono, click copies), PR entry point, and
 * commit/push. This menu replaces the header git-status entry points.
 */
export function WorkspaceActionsMenu({ session, git }: WorkspaceActionsMenuProps) {
  const gitDisabled = git.gitActionsDisabledReason !== null;
  const handlePr = useCallback(() => {
    if (git.hasExistingPr) {
      git.onViewPr();
    } else {
      git.onCreatePr();
    }
  }, [git]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Chat actions"
          title="Chat actions"
          className="workspace-shell-icon-button app-region-no-drag shrink-0"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          disabled={!session.canRename}
          onSelect={session.onRename}
        >
          <Pencil className="size-4" />
          Rename chat
          <DropdownMenuShortcut>
            {getShortcutDisplayLabel(SHORTCUTS.renameSession)}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!session.canFork}
          onSelect={session.onFork}
        >
          <Fork className="size-4" />
          Fork chat
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={!session.canDismiss}
          onSelect={session.onDismiss}
        >
          <Trash className="size-4" />
          Archive chat
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {git.branchName ? (
          <DropdownMenuItem
            onSelect={git.onCopyBranch}
            title="Copy branch name"
            data-telemetry-mask="true"
          >
            <GitBranch className="size-4" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs leading-5 text-muted-foreground">
              {git.branchName}
            </span>
            <Copy className="size-3 shrink-0 text-muted-foreground/70" />
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={gitDisabled}
          title={git.gitActionsDisabledReason ?? undefined}
          onSelect={handlePr}
        >
          <GitPullRequest className="size-4" />
          {git.hasExistingPr ? "Open PR" : "Create PR"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={gitDisabled}
          title={git.gitActionsDisabledReason ?? undefined}
          onSelect={git.onCommit}
        >
          <GitCommit className="size-4" />
          Commit…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={gitDisabled}
          title={git.gitActionsDisabledReason ?? undefined}
          onSelect={git.onPush}
        >
          <ArrowUp className="size-4" />
          Push
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
