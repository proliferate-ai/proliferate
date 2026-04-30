import type { RightPanelMode } from "@/components/workspace/shell/right-panel/RightPanel";
import type { PublishIntent } from "@/lib/domain/workspaces/publish-workflow";

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

export function reviewDiffsFromPublishState(): {
  publishDialog: PublishDialogState;
  rightPanelOpen: boolean;
  rightPanelMode: RightPanelMode;
} {
  return {
    publishDialog: CLOSED_PUBLISH_DIALOG_STATE,
    rightPanelOpen: true,
    rightPanelMode: "changes",
  };
}
