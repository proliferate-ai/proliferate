import type { PublishIntent } from "@/lib/domain/workspaces/creation/publish-workflow-model";
import type { CommitDialogStep } from "@/lib/domain/workspaces/creation/commit-dialog-state";

export interface PublishDialogState {
  open: boolean;
  initialIntent: PublishIntent;
  /** Which step the commit dialog should open on. */
  initialStep: CommitDialogStep;
  workspaceId: string | null;
}

export const CLOSED_PUBLISH_DIALOG_STATE: PublishDialogState = {
  open: false,
  initialIntent: "commit",
  initialStep: "actions",
  workspaceId: null,
};

export function openPublishDialogState(
  workspaceId: string | null,
  initialIntent: PublishIntent,
): PublishDialogState {
  return {
    open: true,
    initialIntent,
    initialStep: initialIntent === "pull_request" ? "pull_request" : "actions",
    workspaceId,
  };
}
