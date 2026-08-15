import {
  useEffect,
  useRef,
  type SetStateAction,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import {
  reconcileRightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-state-normalization";
import {
  rightPanelStateEqual,
} from "#product/lib/domain/workspaces/shell/right-panel-view";
import type { RightPanelWorkspaceState } from "#product/lib/domain/workspaces/shell/right-panel-model";
import type { ViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";

export interface RightPanelTerminalActivationRequest {
  token: number;
  workspaceId: string;
}

type RightPanelStateUpdater = (value: SetStateAction<RightPanelWorkspaceState>) => void;

interface UseRightPanelLifecycleOptions {
  workspaceId: string | null;
  isOpen: boolean;
  shouldRenderContent: boolean;
  isCloudWorkspaceSelected: boolean;
  state: RightPanelWorkspaceState;
  terminals: readonly TerminalRecord[];
  terminalsQueryIsSuccess: boolean;
  visibleTerminalCount: number;
  activeTerminalId: string | null;
  openViewerTargets: readonly ViewerTarget[];
  /**
   * Run-scoped availability of the workflow tool (tri-state; `undefined` while
   * the runs list has not settled). Reconciled here rather than only filtered
   * in the header, so an active workflow entry cannot outlive the run that
   * justified it — a pane rendering under no highlighted tab.
   */
  hasWorkflowRun: boolean | undefined;
  terminalActivationRequest: RightPanelTerminalActivationRequest | null;
  updateState: RightPanelStateUpdater;
  setActiveTerminalForWorkspace: (workspaceId: string, terminalId: string | null) => void;
  createTerminal: (options?: { activate?: boolean }) => Promise<string | null>;
  activateTerminalTool: () => Promise<void>;
  onTerminalActivationRequestHandled: (request: RightPanelTerminalActivationRequest) => void;
}

export function useRightPanelLifecycle({
  workspaceId,
  isOpen,
  shouldRenderContent,
  isCloudWorkspaceSelected,
  state,
  terminals,
  terminalsQueryIsSuccess,
  visibleTerminalCount,
  activeTerminalId,
  openViewerTargets,
  hasWorkflowRun,
  terminalActivationRequest,
  updateState,
  setActiveTerminalForWorkspace,
  createTerminal,
  activateTerminalTool,
  onTerminalActivationRequestHandled,
}: UseRightPanelLifecycleOptions) {
  const handledActivationRequestRef = useRef<string | null>(null);
  // One-shot per mounted shell: users who close the starter terminal should not
  // get a replacement every time they revisit the workspace in the same session.
  const autoTerminalWorkspaceIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const next = reconcileRightPanelWorkspaceState(state, {
      isCloudWorkspaceSelected,
      liveTerminals: terminalsQueryIsSuccess ? terminals : undefined,
      liveViewerTargets: openViewerTargets,
      hasWorkflowRun,
    });
    if (rightPanelStateEqual(state, next)) {
      return;
    }
    updateState(next);
  }, [
    hasWorkflowRun,
    isCloudWorkspaceSelected,
    openViewerTargets,
    state,
    terminals,
    terminalsQueryIsSuccess,
    updateState,
  ]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    setActiveTerminalForWorkspace(workspaceId, activeTerminalId);
  }, [
    activeTerminalId,
    setActiveTerminalForWorkspace,
    workspaceId,
  ]);

  useEffect(() => {
    if (
      !workspaceId
      || !isOpen
      || !shouldRenderContent
      || !terminalsQueryIsSuccess
      || autoTerminalWorkspaceIdsRef.current.has(workspaceId)
    ) {
      return;
    }

    autoTerminalWorkspaceIdsRef.current.add(workspaceId);
    if (visibleTerminalCount > 0) {
      return;
    }

    void createTerminal({ activate: false });
  }, [
    createTerminal,
    isOpen,
    shouldRenderContent,
    terminalsQueryIsSuccess,
    visibleTerminalCount,
    workspaceId,
  ]);

  useEffect(() => {
    const activationRequestKey = terminalActivationRequest
      ? `${terminalActivationRequest.workspaceId}:${terminalActivationRequest.token}`
      : null;
    if (
      !terminalActivationRequest
      || terminalActivationRequest.workspaceId !== workspaceId
      || handledActivationRequestRef.current === activationRequestKey
    ) {
      return;
    }
    if (!workspaceId || !shouldRenderContent) {
      return;
    }
    handledActivationRequestRef.current = activationRequestKey;
    onTerminalActivationRequestHandled(terminalActivationRequest);
    void activateTerminalTool();
  }, [
    activateTerminalTool,
    onTerminalActivationRequestHandled,
    shouldRenderContent,
    terminalActivationRequest,
    workspaceId,
  ]);
}
