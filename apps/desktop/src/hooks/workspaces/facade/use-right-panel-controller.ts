import {
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { useTerminalsQuery } from "@anyharness/sdk-react";
import { useRightPanelHeaderEntries } from "@/hooks/workspaces/derived/use-right-panel-header-entries";
import {
  useRightPanelLifecycle,
  type RightPanelTerminalActivationRequest,
} from "@/hooks/workspaces/lifecycle/right-panel/use-right-panel-lifecycle";
import { useRightPanelNewTabMenuRequest } from "@/hooks/workspaces/ui/use-right-panel-new-tab-menu-request";
import { useRightPanelRootFocus } from "@/hooks/workspaces/ui/use-right-panel-root-focus";
import { useRightPanelShortcutRequests } from "@/hooks/workspaces/ui/use-right-panel-shortcut-requests";
import { useRightPanelStateUpdater } from "@/hooks/workspaces/ui/use-right-panel-state-updater";
import { useRightPanelEntryActions } from "@/hooks/workspaces/workflows/right-panel/use-right-panel-entry-actions";
import type { RightPanelWorkspaceState } from "@/lib/domain/workspaces/shell/right-panel-model";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useTerminalStore } from "@/stores/terminal/terminal-store";

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
  nativeOverlaysHidden?: boolean;
  onOpenPanel: () => void;
  onTogglePanel: () => void;
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
  nativeOverlaysHidden = false,
  onOpenPanel,
  onTogglePanel,
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
  const {
    activeTool,
    activeTerminalId,
    activeBrowserId,
    activeViewerTarget,
    visibleTerminals,
    orderedTerminals,
    browserTabs,
    headerEntries,
  } = useRightPanelHeaderEntries({
    state,
    terminals,
    openViewerTargets,
    isCloudWorkspaceSelected,
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
    onOpenPanel,
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
    terminalActivationRequest,
    updateState,
    setActiveTerminalForWorkspace,
    createTerminal: actions.createTerminal,
    activateTerminalTool: actions.activateTerminalTool,
    handleCreateBrowser: actions.handleCreateBrowser,
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
  const shouldMountBrowserPanel = browserTabs.length > 0;

  return {
    rootRef,
    onPointerDownCapture: handleRootPointerDownCapture,
    workspaceId,
    workspaceUiKey,
    activeEntryKey: state.activeEntryKey,
    activeTool,
    activeBrowserId,
    activeTerminalId,
    activeViewerTarget,
    entries: headerEntries,
    unreadByTerminal,
    buffersByPath,
    tabModes,
    browserTabs,
    orderedTerminals,
    isOpen,
    isWorkspaceReady,
    shouldRenderContent,
    shouldMountBrowserPanel,
    shouldMountTerminalPanel,
    canConnectTerminals: terminalsQuery.isSuccess,
    isLoadingTerminals: terminalsQuery.isLoading && !terminalsQuery.data,
    terminalListErrorMessage: terminalsQuery.isError ? "Terminal list unavailable" : null,
    terminalFocusRequestToken: terminalActivationRequestToken + actions.terminalFocusNonce,
    newTabMenuRequestToken: newTabMenuRequest.token,
    newTabMenuDefaultKind: newTabMenuRequest.defaultKind,
    nativeOverlaysHidden,
    onActivateEntry: actions.activateRightPanelEntry,
    onSelectTerminal: actions.selectTerminal,
    onCloseTerminal: actions.handleCloseTerminal,
    onCloseBrowser: actions.handleCloseBrowser,
    onCloseViewerTarget: actions.handleCloseViewer,
    onRenameTerminal: actions.handleRenameTerminal,
    onCreateTerminal: actions.handleCreateTerminal,
    onCreateBrowser: actions.handleCreateBrowser,
    onOpenRepoSettings: actions.handleOpenRepoSettings,
    onReorderHeaderEntry: actions.handleReorderHeaderEntry,
    onUpdateBrowserUrl: actions.handleUpdateBrowserUrl,
    onTogglePanel,
  };
}
