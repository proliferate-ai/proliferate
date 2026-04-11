import type {
  CurrentPullRequestResponse,
  GitStatusSnapshot,
  Workspace,
} from "@anyharness/sdk";
import {
  useCurrentPullRequestQuery,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import { useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import { useResize } from "@/hooks/layout/use-resize";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useSelectedWorkspace } from "@/hooks/workspaces/use-selected-workspace";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  useWorkspaceUiStore,
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
} from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useAppSurfaceStore } from "@/stores/ui/app-surface-store";
import type { RightPanelMode } from "@/components/workspace/shell/right-panel/RightPanel";

export interface MainScreenLayoutState {
  rightPanelMode: RightPanelMode;
  setRightPanelMode: Dispatch<SetStateAction<RightPanelMode>>;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  rightPanelOpen: boolean;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
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

export type MainShell = "home" | "code" | "cowork" | "cowork-pending";

export interface MainScreenDataState {
  shell: MainShell;
  isCoworkWorkspaceSelected: boolean;
  hasRuntimeReadyWorkspace: boolean;
  shouldKeepRuntimePanelsVisible: boolean;
  hasWorkspaceShell: boolean;
  isCloudWorkspaceSelected: boolean;
  selectedWorkspaceId: string | null;
  selectedWorkspace: Workspace | null;
  gitStatus: GitStatusSnapshot | undefined;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
}

export interface MainScreenState {
  layout: MainScreenLayoutState;
  data: MainScreenDataState;
}

export function useMainScreenState(): MainScreenState {
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("files");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
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
  const pendingCoworkThread = useAppSurfaceStore((state) => state.pendingCoworkThread);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { selectedWorkspace, isCoworkWorkspaceSelected } = useSelectedWorkspace();
  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const shell: MainShell = pendingCoworkThread
    ? "cowork-pending"
    : isCoworkWorkspaceSelected
      ? "cowork"
      : (selectedWorkspaceId || pendingWorkspaceEntry)
        ? "code"
        : "home";
  const hasWorkspaceShell = shell !== "home";
  const hasRuntimeReadyWorkspace = shell === "code" && Boolean(selectedWorkspaceId) && (
    selectedCloudWorkspaceId !== null
      ? selectedCloudRuntime.state?.phase === "ready"
      : true
  );
  const shouldKeepRuntimePanelsVisible = shell === "code" && Boolean(selectedWorkspaceId) && (
    selectedCloudWorkspaceId !== null
      ? selectedCloudRuntime.state?.preserveVisibleContent === true
      : false
  );
  const { data: gitStatus } = useGitStatusQuery({ enabled: hasRuntimeReadyWorkspace });
  const { data: currentPullRequest } = useCurrentPullRequestQuery({ enabled: hasRuntimeReadyWorkspace });

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
      shell,
      isCoworkWorkspaceSelected,
      hasRuntimeReadyWorkspace,
      shouldKeepRuntimePanelsVisible,
      hasWorkspaceShell,
      isCloudWorkspaceSelected: selectedCloudWorkspaceId !== null,
      selectedWorkspaceId,
      selectedWorkspace,
      gitStatus,
      existingPr: currentPullRequest?.pullRequest ?? null,
    },
  };
}
