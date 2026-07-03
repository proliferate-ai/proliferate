import { Trash } from "@proliferate/ui/icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";

interface WorkspaceDeleteConfirmMenuProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Inline delete-confirmation step for the workspace row context menu. Explains
 * exactly what the "Delete workspace" action removes (local worktree, record,
 * chat history, agent artifacts) versus what it preserves (commits, branches,
 * PRs), then offers the destructive confirm and a cancel.
 */
export function WorkspaceDeleteConfirmMenu({ onConfirm, onCancel }: WorkspaceDeleteConfirmMenuProps) {
  return (
    <>
      <div className="px-2.5 py-2 text-sm text-foreground">
        <div className="font-medium">Delete workspace?</div>
        <div className="mt-1 text-xs leading-4 text-muted-foreground">
          This removes the local worktree, workspace record, chat history, and local agent
          artifacts for this workspace. Commits, branches, and pull requests are not deleted.
        </div>
        <div className="mt-1 text-xs leading-4 text-muted-foreground">
          This cannot be undone from Proliferate.
        </div>
      </div>
      <PopoverMenuItem
        icon={<Trash className="size-3.5 shrink-0 text-muted-foreground" />}
        label="Delete workspace"
        variant="sidebar"
        onClick={onConfirm}
      />
      <PopoverMenuItem
        label="Cancel"
        variant="sidebar"
        onClick={onCancel}
      />
    </>
  );
}
