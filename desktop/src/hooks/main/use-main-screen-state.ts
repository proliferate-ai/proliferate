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
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { useResize } from "@/hooks/layout/use-resize";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { shouldMountWorkspaceShell } from "@/lib/domain/chat/chat-surface";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  useWorkspaceUiStore,
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
} from "@/stores/preferences/workspace-ui-store";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";
import type { RightPanelMode } from "@/components/workspace/shell/right-panel/RightPanel";

const EMPTY_WORKSPACES: Workspace[] = [];

export interface MainScreenLayoutState {
  rightPanelMode: RightPanelMode;
  setRightPanelMode: Dispatch<SetStateAction<RightPanelMode>>;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  rightPanelOpen: boolean;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  terminalCollapsed: boolean;
  setTerminalCollapsed: Dispatch<SetStateAction<boolean>>;
  terminalFocusRequestToken: number;
  setTerminalFocusRequestToken: Dispatch<SetStateAction<number>>;
  commitOpen: boolean;
  setCommitOpen: Dispatch<SetStateAction<boolean>>;
  pushOpen: boolean;
  setPushOpen: Dispatch<SetStateAction<boolean>>;
  prOpen: boolean;
  setPrOpen: Dispatch<SetStateAction<boolean>>;
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
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("files");
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [terminalFocusRequestToken, setTerminalFocusRequestToken] = useState(0);
  const [commitOpen, setCommitOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const [filePaletteOpen, setFilePaletteOpen] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const sidebarOpen = useWorkspaceUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useWorkspaceUiStore((state) => state.setSidebarOpen);
  const sidebarWidth = useWorkspaceUiStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspaceUiStore((state) => state.setSidebarWidth);

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
    min: 260,
    max: 700,
  });

  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const workspaceArrivalEvent = useHarnessStore((state) => state.workspaceArrivalEvent);
  const activeLaunchIntent = useChatLaunchIntentStore((state) => state.activeIntent);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
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
  const { data: gitStatus } = useGitStatusQuery({ enabled: hasRuntimeReadyWorkspace });
  const shouldQueryCurrentPullRequest =
    hasRuntimeReadyWorkspace && Boolean(gitStatus?.currentBranch?.trim());
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
      rightPanelMode,
      setRightPanelMode,
      sidebarOpen,
      setSidebarOpen,
      sidebarWidth,
      setSidebarWidth,
      rightPanelOpen,
      setRightPanelOpen,
      terminalCollapsed,
      setTerminalCollapsed,
      terminalFocusRequestToken,
      setTerminalFocusRequestToken,
      commitOpen,
      setCommitOpen,
      pushOpen,
      setPushOpen,
      prOpen,
      setPrOpen,
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
