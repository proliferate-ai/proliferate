import { Trash } from "#product/primitives/icons/core";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";

/**
 * Destructive confirmation pane shown inside the workspace row's right-click
 * popover before "Delete workspace" fires.
 */
export function WorkspaceDeleteConfirmMenu({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="px-2.5 py-2 text-ui text-foreground">
        <div className="font-medium">Delete workspace?</div>
        <div className="mt-1 text-ui-sm leading-4 text-muted-foreground">
          This removes the local worktree, workspace record, chat history, and local agent
          artifacts for this workspace. Commits, branches, and pull requests are not deleted.
        </div>
        <div className="mt-1 text-ui-sm leading-4 text-muted-foreground">
          This cannot be undone from Proliferate.
        </div>
      </div>
      <PopoverMenuItem
        icon={<Trash className="icon-paired shrink-0 text-muted-foreground" />}
        label="Delete workspace"
        onClick={onConfirm}
      />
      <PopoverMenuItem label="Cancel" onClick={onCancel} />
    </>
  );
}
