import { useCallback } from "react";
import type {
  PromptDisplayAttachmentPart,
} from "@proliferate/product-domain/chats/composer/prompt-display-parts";
import { focusChatInput } from "#product/lib/domain/focus-zone";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { removeViewerTargetFromRightPanelState } from "#product/lib/domain/workspaces/shell/right-panel-state";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import {
  promptAttachmentViewerTarget,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

type PreviewablePromptAttachmentPart = Exclude<
  PromptDisplayAttachmentPart,
  { type: "link" | "plan_reference" }
>;

export function usePromptAttachmentPreviewActions() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const openViewerTarget = useWorkspaceViewerTabsStore((state) => state.openTarget);
  const closeViewerTarget = useWorkspaceViewerTabsStore((state) => state.closeTarget);
  const setRightPanelMaterializedForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelMaterializedForWorkspace,
  );
  const { activateViewerTarget } = useWorkspaceShellActivation();

  const openAttachmentPreview = useCallback((args: {
    part: PreviewablePromptAttachmentPart;
    origin: "draft" | "session";
    sessionId: string | null;
  }) => {
    const target = promptAttachmentViewerTarget({
      origin: args.origin,
      sessionId: args.origin === "session" ? args.sessionId : null,
      attachmentId: args.part.attachmentId ?? args.part.id,
      name: args.part.name,
      mimeType: args.part.mimeType
        ?? (args.part.type === "image" ? "image/png" : "text/plain"),
      size: args.part.size ?? null,
      attachmentKind: args.part.type === "image" ? "image" : "text_resource",
      attachmentSource: args.part.source ?? "upload",
      objectUrl: args.origin === "draft" ? args.part.objectUrl ?? null : null,
    });
    openViewerTarget(target);
    if (materializedWorkspaceId) {
      activateViewerTarget({
        workspaceId: materializedWorkspaceId,
        shellWorkspaceId: workspaceUiKey,
        target,
        mode: "open-or-focus",
      });
    }
    focusChatInput();
  }, [activateViewerTarget, materializedWorkspaceId, openViewerTarget, workspaceUiKey]);

  const closeDraftAttachmentPreview = useCallback((attachmentId: string) => {
    const targets = useWorkspaceViewerTabsStore.getState().openTargets.filter((target) => (
      target.kind === "promptAttachment"
      && target.origin === "draft"
      && target.attachmentId === attachmentId
    ));
    for (const target of targets) {
      const targetKey = viewerTargetKey(target);
      closeViewerTarget(targetKey);
      if (materializedWorkspaceId) {
        setRightPanelMaterializedForWorkspace(
          materializedWorkspaceId,
          (previous) => removeViewerTargetFromRightPanelState(previous, targetKey, true),
        );
      }
    }
    if (targets.length > 0) {
      focusChatInput();
    }
  }, [
    closeViewerTarget,
    materializedWorkspaceId,
    setRightPanelMaterializedForWorkspace,
  ]);

  return {
    openAttachmentPreview,
    closeDraftAttachmentPreview,
  };
}
