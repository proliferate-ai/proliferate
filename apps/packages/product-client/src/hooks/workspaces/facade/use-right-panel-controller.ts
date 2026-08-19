import {
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { useTerminalsQuery, useWorkflowRunsQuery } from "@anyharness/sdk-react";
import { isWorkflowsV2Enabled } from "#product/lib/domain/capabilities/workflows-v2";
import { useBackgroundWorkFinishSignal } from "#product/hooks/activity/derived/use-background-work-finish-signal";
import { useActiveSessionId } from "#product/hooks/chat/derived/use-active-session-identity";
import { useWorkflowAutoAdvanceWatch } from "#product/hooks/workflows/lifecycle/use-workflow-auto-advance-toast";
import { useRightPanelHeaderEntries } from "#product/hooks/workspaces/derived/use-right-panel-header-entries";
import {
  useRightPanelLifecycle,
  type RightPanelTerminalActivationRequest,
} from "#product/hooks/workspaces/lifecycle/right-panel/use-right-panel-lifecycle";
import { useRightPanelNewTabMenuRequest } from "#product/hooks/workspaces/ui/use-right-panel-new-tab-menu-request";
import { useRightPanelRootFocus } from "#product/hooks/workspaces/ui/use-right-panel-root-focus";
import { useRightPanelShortcutRequests } from "#product/hooks/workspaces/ui/use-right-panel-shortcut-requests";
import { useRightPanelStateUpdater } from "#product/hooks/workspaces/ui/use-right-panel-state-updater";
import { useRightPanelEntryActions } from "#product/hooks/workspaces/workflows/right-panel/use-right-panel-entry-actions";
import {
  resolveWorkflowToolAvailability,
  rightPanelToolHeaderKey,
  type RightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import { useWorkspaceFileBuffersStore } from "#product/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useTerminalStore } from "#product/stores/terminal/terminal-store";

export type { RightPanelTerminalActivationRequest };

const EMPTY_TERMINALS: readonly TerminalRecord[] = [];

export interface UseRightPanelControllerOptions {
  workspaceId: string | null;
  workspaceUiKey: string | null;
  isWorkspaceReady: boolean;
  isOpen: boolean;
  shouldKeepContentVisible?: boolean;
  isCloudWorkspaceSelected: boolean;
  state: RightPanelWorkspaceState;
  repoSettingsHref: string;
  onStateChange: Dispatch<SetStateAction<RightPanelWorkspaceState>>;
  terminalActivationRequest: RightPanelTerminalActivationRequest | null;
  focusRequestToken?: number;
  onTerminalActivationRequestHandled: (request: RightPanelTerminalActivationRequest) => void;
}

export function useRightPanelController({
  workspaceId,
  workspaceUiKey,
  isWorkspaceReady,
  isOpen,
  shouldKeepContentVisible = false,
  isCloudWorkspaceSelected,
  state,
  repoSettingsHref,
  onStateChange,
  terminalActivationRequest,
  focusRequestToken = 0,
  onTerminalActivationRequestHandled,
}: UseRightPanelControllerOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const setActiveTerminalForWorkspace = useTerminalStore(
    (store) => store.setActiveTerminalForWorkspace,
  );
  const unreadByTerminal = useTerminalStore((store) => store.unreadByTerminal);
  const openViewerTargets = useWorkspaceViewerTabsStore((store) => store.openTargets);
  const closeViewerTarget = useWorkspaceViewerTabsStore((store) => store.closeTarget);
  const reorderViewerTargets = useWorkspaceViewerTabsStore((store) => store.reorderOpenTargets);
  const setActiveViewerTarget = useWorkspaceViewerTabsStore((store) => store.setActiveTarget);
  const tabModes = useWorkspaceViewerTabsStore((store) => store.modeByTargetKey);
  const buffersByPath = useWorkspaceFileBuffersStore((store) => store.buffersByPath);
  const clearBuffer = useWorkspaceFileBuffersStore((store) => store.clearBuffer);
  const shouldRenderContent = isWorkspaceReady || shouldKeepContentVisible;
  const terminalsQuery = useTerminalsQuery({
    workspaceId,
    enabled: Boolean(workspaceId && shouldRenderContent),
  });
  const terminals = terminalsQuery.data ?? EMPTY_TERMINALS;
  // The workflow tool is offered only where there is a run to show. The query
  // never runs while the gen-2 gate is off, so a gated-off build asks the
  // runtime nothing about workflows. Watched rather than read once: a run
  // triggered into an already-panelled workspace has to raise the tab without
  // the user reloading anything.
  const workflowRunsQuery = useWorkflowRunsQuery(workspaceId, {
    enabled: isWorkflowsV2Enabled() && Boolean(workspaceId && shouldRenderContent),
    watchActiveRuns: true,
  });
  const workflowTool = resolveWorkflowToolAvailability({
    // Error counts as settled: a list that failed with nothing cached is
    // evidence the tool has nothing to show, not evidence to keep waiting.
    runsSettled: workflowRunsQuery.isSuccess || workflowRunsQuery.isError,
    hasRun: (workflowRunsQuery.data?.runs.length ?? 0) > 0,
    isActiveTool: state.activeEntryKey === rightPanelToolHeaderKey("workflow"),
  });
  // Panel-independent: the undo offer on an auto-advance must appear whatever
  // tool the panel shows and whether it is open, so the watcher hangs off this
  // controller (mounted for as long as the workspace shell) rather than off the
  // pane behind the tool switch.
  useWorkflowAutoAdvanceWatch({ workspaceId, enabled: shouldRenderContent });
  // Finish-signal ladder rung 1 (`PanelHeaderEntry` dirty dot): read
  // independent of which tool is actually active — the header strip renders
  // regardless, and `BackgroundWorkPane` itself only mounts while its own
  // tool is selected, so the dot's own read must not depend on that.
  const activeSessionId = useActiveSessionId();
  const backgroundWorkFinishSignal = useBackgroundWorkFinishSignal(activeSessionId);
  const {
    activeTool,
    activeTerminalId,
    activeViewerTarget,
    visibleTerminals,
    orderedTerminals,
    headerEntries,
  } = useRightPanelHeaderEntries({
    state,
    terminals,
    openViewerTargets,
    isCloudWorkspaceSelected,
    hasWorkflowRun: workflowTool.showTab,
  });
  const terminalActivationRequestToken = terminalActivationRequest?.workspaceId === workspaceId
    ? terminalActivationRequest.token
    : 0;
  const updateState = useRightPanelStateUpdater({
    isCloudWorkspaceSelected,
    liveViewerTargets: openViewerTargets,
    onStateChange,
  });
  const newTabMenuRequest = useRightPanelNewTabMenuRequest();
  const actions = useRightPanelEntryActions({
    workspaceId,
    shellWorkspaceId: workspaceUiKey,
    shouldRenderContent,
    isCloudWorkspaceSelected,
    state,
    repoSettingsHref,
    terminalsQuery,
    activeTerminalId,
    openViewerTargets,
    buffersByPath,
    updateState,
    setActiveTerminalForWorkspace,
    closeViewerTarget,
    reorderViewerTargets,
    setActiveViewerTarget,
    clearBuffer,
  });

  useRightPanelLifecycle({
    workspaceId,
    isOpen,
    shouldRenderContent,
    isCloudWorkspaceSelected,
    state,
    terminals,
    terminalsQueryIsSuccess: terminalsQuery.isSuccess,
    visibleTerminalCount: visibleTerminals.length,
    activeTerminalId,
    openViewerTargets,
    hasWorkflowRun: workflowTool.activeEntryAvailability,
    terminalActivationRequest,
    updateState,
    setActiveTerminalForWorkspace,
    createTerminal: actions.createTerminal,
    activateTerminalTool: actions.activateTerminalTool,
    onTerminalActivationRequestHandled,
  });

  const focusRightPanelRoot = useCallback(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useRightPanelShortcutRequests({
    activeEntryKey: state.activeEntryKey,
    entries: headerEntries,
    isOpen,
    onActivateEntry: actions.activateRightPanelEntry,
    onCloseActiveEntry: actions.closeActiveRightPanelEntry,
    onHandledRequest: focusRightPanelRoot,
  });

  const handleRootPointerDownCapture = useRightPanelRootFocus({
    rootRef,
    isOpen,
    focusRequestToken,
  });

  const shouldMountTerminalPanel = shouldRenderContent
    && (activeTerminalId !== null || orderedTerminals.length > 0);

  return {
    rootRef,
    onPointerDownCapture: handleRootPointerDownCapture,
    workspaceId,
    workspaceUiKey,
    activeEntryKey: state.activeEntryKey,
    activeTool,
    isOpen,
    activeTerminalId,
    activeViewerTarget,
    entries: headerEntries,
    // Never rendered on the active entry — enforced at the render site
    // (`RightPanelHeaderEntryList`), matching the manifest's "never set it
    // on the active entry" rule for every other tab kind's `dirty`.
    backgroundWorkDirty: backgroundWorkFinishSignal.dirty,
    unreadByTerminal,
    buffersByPath,
    tabModes,
    orderedTerminals,
    isWorkspaceReady,
    shouldRenderContent,
    shouldMountTerminalPanel,
    canConnectTerminals: terminalsQuery.isSuccess,
    isLoadingTerminals: terminalsQuery.isLoading && !terminalsQuery.data,
    terminalListErrorMessage: terminalsQuery.isError ? "Terminal list unavailable" : null,
    terminalFocusRequestToken: terminalActivationRequestToken + actions.terminalFocusNonce,
    newTabMenuRequestToken: newTabMenuRequest.token,
    newTabMenuDefaultKind: newTabMenuRequest.defaultKind,
    onActivateEntry: actions.activateRightPanelEntry,
    onSelectTerminal: actions.selectTerminal,
    onCloseTerminal: actions.handleCloseTerminal,
    onCloseViewerTarget: actions.handleCloseViewer,
    onRenameTerminal: actions.handleRenameTerminal,
    onCreateTerminal: actions.handleCreateTerminal,
    onOpenRepoSettings: actions.handleOpenRepoSettings,
    onReorderHeaderEntry: actions.handleReorderHeaderEntry,
  };
}
