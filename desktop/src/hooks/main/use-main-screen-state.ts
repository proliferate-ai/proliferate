import type {
  CurrentPullRequestResponse,
  GitStatusSnapshot,
  Workspace,
} from "@anyharness/sdk";
import {
  useCurrentPullRequestQuery,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { useResize } from "@/hooks/layout/use-resize";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { shouldMountWorkspaceShell } from "@/lib/domain/chat/chat-surface";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  useWorkspaceUiStore,
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
} from "@/stores/preferences/workspace-ui-store";
import {
  DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  reconcileRightPanelWorkspaceState,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/right-panel";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";
import {
  CLOSED_PUBLISH_DIALOG_STATE,
  type PublishDialogState,
} from "./publish-dialog-state";

const EMPTY_WORKSPACES: Workspace[] = [];

export interface MainScreenLayoutState {
  rightPanelState: RightPanelWorkspaceState;
  setRightPanelState: Dispatch<SetStateAction<RightPanelWorkspaceState>>;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  rightPanelOpen: boolean;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  terminalActivationRequestToken: number;
  setTerminalActivationRequestToken: Dispatch<SetStateAction<number>>;
  publishDialog: PublishDialogState;
  setPublishDialog: Dispatch<SetStateAction<PublishDialogState>>;
  filePaletteOpen: boolean;
  setFilePaletteOpen: Dispatch<SetStateAction<boolean>>;
  rightPanelWidth: number;
  setRightPanelWidth: Dispatch<SetStateAction<number>>;
  onLeftSeparatorDown: (event: MouseEvent) => void;
  onRightSeparatorDown: (event: MouseEvent) => void;
}

export interface MainScreenDataState {
  hasRuntimeReadyWorkspace: boolean;
  shouldKeepRuntimePanelsVisible: boolean;
  hasWorkspaceShell: boolean;
  isCloudWorkspaceSelected: boolean;
  selectedWorkspaceId: string | null;
  selectedWorkspace: Workspace | undefined;
  selectedCloudWorkspace: CloudWorkspaceSummary | undefined;
  gitStatus: GitStatusSnapshot | undefined;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
}

export interface MainScreenState {
  layout: MainScreenLayoutState;
  data: MainScreenDataState;
}

export function useMainScreenState(): MainScreenState {
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [terminalActivationRequestToken, setTerminalActivationRequestToken] = useState(0);
  const [publishDialog, setPublishDialog] = useState<PublishDialogState>(
    CLOSED_PUBLISH_DIALOG_STATE,
  );
  const [filePaletteOpen, setFilePaletteOpen] = useState(false);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const workspaceArrivalEvent = useHarnessStore((state) => state.workspaceArrivalEvent);
  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const isCloudWorkspaceSelected = selectedCloudWorkspaceId !== null;
  const sidebarOpen = useWorkspaceUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useWorkspaceUiStore((state) => state.setSidebarOpen);
  const sidebarWidth = useWorkspaceUiStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspaceUiStore((state) => state.setSidebarWidth);
  const persistedRightPanelState = useWorkspaceUiStore((state) =>
    selectedWorkspaceId ? state.rightPanelByWorkspace[selectedWorkspaceId] : undefined
  );
  const setRightPanelForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelForWorkspace,
  );
  const rightPanelWidth = useWorkspaceUiStore((state) =>
    selectedWorkspaceId
      ? state.rightPanelWidthByWorkspace[selectedWorkspaceId] ?? RIGHT_PANEL_DEFAULT_WIDTH
      : RIGHT_PANEL_DEFAULT_WIDTH
  );
  const setRightPanelWidthForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelWidthForWorkspace,
  );
  const rightPanelState = useMemo(
    () => reconcileRightPanelWorkspaceState(
      persistedRightPanelState ?? DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
      { isCloudWorkspaceSelected },
    ),
    [isCloudWorkspaceSelected, persistedRightPanelState],
  );
  const setRightPanelState = useCallback<Dispatch<SetStateAction<RightPanelWorkspaceState>>>(
    (value) => {
      if (!selectedWorkspaceId) {
        return;
      }
      setRightPanelForWorkspace(selectedWorkspaceId, value);
    },
    [selectedWorkspaceId, setRightPanelForWorkspace],
  );
  const setRightPanelWidth = useCallback<Dispatch<SetStateAction<number>>>(
    (value) => {
      if (!selectedWorkspaceId) {
        return;
      }
      setRightPanelWidthForWorkspace(selectedWorkspaceId, value);
    },
    [selectedWorkspaceId, setRightPanelWidthForWorkspace],
  );

  const onLeftSeparatorDown = useResize({
    direction: "horizontal",
    size: sidebarWidth,
    onResize: setSidebarWidth,
    min: WORKSPACE_SIDEBAR_MIN_WIDTH,
    max: WORKSPACE_SIDEBAR_MAX_WIDTH,
  });

  const onRightSeparatorDown = useResize({
    direction: "horizontal",
    size: rightPanelWidth,
    onResize: setRightPanelWidth,
    reverse: true,
    min: RIGHT_PANEL_MIN_WIDTH,
    max: RIGHT_PANEL_MAX_WIDTH,
  });

  const activeLaunchIntent = useChatLaunchIntentStore((state) => state.activeIntent);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const hasWorkspaceShell = shouldMountWorkspaceShell({
    selectedWorkspaceId,
    hasPendingWorkspaceEntry: pendingWorkspaceEntry !== null,
    activeLaunchIntentId: activeLaunchIntent?.id ?? null,
  });
  const hasRuntimeReadyWorkspace = Boolean(selectedWorkspaceId) && (
    selectedCloudWorkspaceId !== null
      ? selectedCloudRuntime.state?.phase === "ready"
      : true
  );
  const shouldKeepRuntimePanelsVisible = Boolean(selectedWorkspaceId) && (
    selectedCloudWorkspaceId !== null
      ? selectedCloudRuntime.state?.preserveVisibleContent === true
      : false
  );
  const { data: gitStatus } = useGitStatusQuery({
    enabled: hasRuntimeReadyWorkspace && !hotPaintPending,
  });
  const shouldQueryCurrentPullRequest =
    hasRuntimeReadyWorkspace && !hotPaintPending && Boolean(gitStatus?.currentBranch?.trim());
  const { data: currentPullRequest } = useCurrentPullRequestQuery({
    enabled: shouldQueryCurrentPullRequest,
  });

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId),
    [selectedWorkspaceId, workspaces],
  );
  const selectedCloudWorkspace = useMemo(
    () => workspaceCollections?.cloudWorkspaces.find(
      (workspace) => workspace.id === selectedCloudWorkspaceId,
    ),
    [selectedCloudWorkspaceId, workspaceCollections?.cloudWorkspaces],
  );

  useEffect(() => {
    if (pendingWorkspaceEntry) {
      setRightPanelOpen(false);
      return;
    }

    if (
      workspaceArrivalEvent?.workspaceId
      && workspaceArrivalEvent.workspaceId === selectedWorkspaceId
    ) {
      setRightPanelOpen(false);
    }
  }, [
    pendingWorkspaceEntry,
    selectedWorkspaceId,
    workspaceArrivalEvent?.workspaceId,
  ]);

  return {
    layout: {
      rightPanelState,
      setRightPanelState,
      sidebarOpen,
      setSidebarOpen,
      sidebarWidth,
      setSidebarWidth,
      rightPanelOpen,
      setRightPanelOpen,
      terminalActivationRequestToken,
      setTerminalActivationRequestToken,
      publishDialog,
      setPublishDialog,
      filePaletteOpen,
      setFilePaletteOpen,
      rightPanelWidth,
      setRightPanelWidth,
      onLeftSeparatorDown,
      onRightSeparatorDown,
    },
    data: {
      hasRuntimeReadyWorkspace,
      shouldKeepRuntimePanelsVisible,
      hasWorkspaceShell,
      isCloudWorkspaceSelected: selectedCloudWorkspaceId !== null,
      selectedWorkspaceId,
      selectedWorkspace,
      selectedCloudWorkspace,
      gitStatus,
      existingPr: currentPullRequest?.pullRequest ?? null,
    },
  };
}
