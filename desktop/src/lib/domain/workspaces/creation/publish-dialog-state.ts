import type { PublishIntent } from "@/lib/domain/workspaces/creation/publish-workflow";

export interface PublishDialogState {
  open: boolean;
  initialIntent: PublishIntent;
  workspaceId: string | null;
}

export const CLOSED_PUBLISH_DIALOG_STATE: PublishDialogState = {
  open: false,
  initialIntent: "commit",
  workspaceId: null,
};

export function openPublishDialogState(
  workspaceId: string | null,
  initialIntent: PublishIntent,
): PublishDialogState {
  return {
    open: true,
    initialIntent,
    workspaceId,
  };
}
