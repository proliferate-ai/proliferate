import { useCallback } from "react";
import type {
  PromptDisplayAttachmentPart,
} from "@proliferate/product-domain/chats/composer/prompt-display-parts";
import { focusChatInput } from "#product/lib/domain/focus-zone";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { removeViewerTargetFromRightPanelState } from "#product/lib/domain/workspaces/shell/right-panel-state";
import { parseRightPanelHeaderEntryKey } from "#product/lib/domain/workspaces/shell/right-panel-model";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import {
  promptAttachmentViewerTarget,
  viewerTargetKey,
  type ViewerTarget,
  type ViewerTargetKey,
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

  const closeDraftAttachmentPreviews = useCallback((attachmentIds: readonly string[]) => {
    const outgoingIds = new Set(attachmentIds);
    if (outgoingIds.size === 0) {
      return;
    }
    const targetKeys = new Set<ViewerTargetKey>();
    for (const target of useWorkspaceViewerTabsStore.getState().openTargets) {
      if (isOutgoingDraftAttachmentTarget(target, outgoingIds)) {
        targetKeys.add(viewerTargetKey(target));
      }
    }
    const materializedByWorkspace = useWorkspaceUiStore.getState()
      .rightPanelMaterializedByWorkspace;
    for (const panelState of Object.values(materializedByWorkspace)) {
      for (const entryKey of new Set([
        panelState.activeEntryKey,
        ...panelState.headerOrder,
      ])) {
        const entry = parseRightPanelHeaderEntryKey(entryKey);
        if (entry?.kind === "viewer"
          && isOutgoingDraftAttachmentTarget(entry.target, outgoingIds)) {
          targetKeys.add(entry.targetKey);
        }
      }
    }
    if (targetKeys.size === 0) {
      return;
    }
    for (const targetKey of targetKeys) {
      closeViewerTarget(targetKey);
    }
    for (const [workspaceId, panelState] of Object.entries(materializedByWorkspace)) {
      if (!panelState.headerOrder.some((entryKey) => targetKeys.has(
        entryKey as ViewerTargetKey,
      )) && !targetKeys.has(panelState.activeEntryKey as ViewerTargetKey)) {
        continue;
      }
      setRightPanelMaterializedForWorkspace(workspaceId, (previous) => (
        [...targetKeys].reduce(
          (next, targetKey) => removeViewerTargetFromRightPanelState(
            next,
            targetKey,
            true,
          ),
          previous,
        )
      ));
    }
    if (targetKeys.size > 0) {
      focusChatInput();
    }
  }, [
    closeViewerTarget,
    setRightPanelMaterializedForWorkspace,
  ]);

  const closeDraftAttachmentPreview = useCallback((attachmentId: string) => {
    closeDraftAttachmentPreviews([attachmentId]);
  }, [closeDraftAttachmentPreviews]);

  return {
    openAttachmentPreview,
    closeDraftAttachmentPreview,
    closeDraftAttachmentPreviews,
  };
}

function isOutgoingDraftAttachmentTarget(
  target: ViewerTarget,
  attachmentIds: ReadonlySet<string>,
): boolean {
  return target.kind === "promptAttachment"
    && target.origin === "draft"
    && attachmentIds.has(target.attachmentId);
}
