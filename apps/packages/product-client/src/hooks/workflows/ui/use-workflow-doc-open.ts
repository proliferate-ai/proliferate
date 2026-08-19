import { useCallback } from "react";
import type { WorkflowRunDocV2 } from "@anyharness/sdk";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { fileViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";

/**
 * Workflow run context docs are real files the runtime writes under this
 * workspace-relative directory, one subfolder per run (`<dir>/<runId>/`).
 */
const WORKFLOW_CONTEXT_DOCS_DIRECTORY = ".proliferate/context";

/**
 * Opens a workflow run's context doc through the exact wiring the workspace
 * file tree uses to open a file: `useFileReferenceActions.openInSidebar`
 * (`#product/hooks/workspaces/workflows/files/use-file-reference-actions.ts`)
 * registers the target as an open tab (`useWorkspaceViewerTabsStore.openTarget`
 * — the step that actually adds it to the tab strip, not just marks it
 * active) and then activates it in the workspace shell/right panel
 * (`useWorkspaceShellActivation().activateViewerTarget`). This hook composes
 * the same two calls.
 *
 * It skips that hook's stat query and fuzzy-path-correction machinery, built
 * for possibly-abbreviated paths an agent mentions in chat: a
 * `WorkflowRunDocV2` registry row's `filename` is already the canonical
 * workspace-relative path (under `.proliferate/context/`), never a guess.
 *
 * Assumes `workspaceId` is the active workspace shell's own id — the docs
 * pane only renders inside that workspace's shell, so there is no
 * cross-workspace open to support here.
 */
export function useWorkflowDocOpen(workspaceId: string): (doc: WorkflowRunDocV2) => void {
  const openTarget = useWorkspaceViewerTabsStore((state) => state.openTarget);
  const { activateViewerTarget } = useWorkspaceShellActivation();
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );

  return useCallback((doc: WorkflowRunDocV2) => {
    const path = `${WORKFLOW_CONTEXT_DOCS_DIRECTORY}/${doc.runId}/${doc.filename}`;
    const target = fileViewerTarget(path);
    openTarget(target);

    const identity = resolveSelectedWorkspaceIdentity({
      selectedLogicalWorkspaceId,
      materializedWorkspaceId: workspaceId,
    });
    activateViewerTarget({
      workspaceId,
      shellWorkspaceId: identity.workspaceUiKey,
      target,
      mode: "open-or-focus",
    });
  }, [activateViewerTarget, openTarget, selectedLogicalWorkspaceId, workspaceId]);
}
