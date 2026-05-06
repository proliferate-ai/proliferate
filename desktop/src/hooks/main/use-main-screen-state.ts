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
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import {
  DEFAULT_RIGHT_PANEL_DURABLE_STATE,
  DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  clampRightPanelWidth,
  normalizeRightPanelDurableState,
  reconcileRightPanelWorkspaceState,
  type RightPanelDurableState,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/right-panel";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/workspace-keyed-preferences";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
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
  rightPanelFocusRequestToken: number;
  requestRightPanelFocus: () => void;
  terminalActivationRequest: TerminalActivationRequest | null;
  setTerminalActivationRequest: Dispatch<SetStateAction<TerminalActivationRequest | null>>;
  publishDialog: PublishDialogState;
  setPublishDialog: Dispatch<SetStateAction<PublishDialogState>>;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  rightPanelWidth: number;
  setRightPanelWidth: Dispatch<SetStateAction<number>>;
  onLeftSeparatorDown: (event: MouseEvent) => void;
  onRightSeparatorDown: (event: MouseEvent) => void;
}

export interface TerminalActivationRequest {
  token: number;
  workspaceId: string;
}

export interface MainScreenDataState {
  hasRuntimeReadyWorkspace: boolean;
  shouldKeepRuntimePanelsVisible: boolean;
  hasWorkspaceShell: boolean;
  hasLaunchIntentOnlyShell: boolean;
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
  const [rightPanelUserOpenOverride, setRightPanelUserOpenOverride] = useState<{
    materializedWorkspaceId: string;
    nonce: number;
  } | null>(null);
  // The right panel frame is shell-level; only its selected content is workspace-scoped.
  const [rightPanelSessionDurableState, setRightPanelSessionDurableState] =
    useState<RightPanelDurableState | null>(null);
  const [terminalActivationRequest, setTerminalActivationRequest] =
    useState<TerminalActivationRequest | null>(null);
  const [rightPanelFocusRequestToken, setRightPanelFocusRequestToken] = useState(0);
  const [publishDialog, setPublishDialog] = useState<PublishDialogState>(
    CLOSED_PUBLISH_DIALOG_STATE,
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const isCloudWorkspaceSelected = selectedCloudWorkspaceId !== null;
  const sidebarOpen = useWorkspaceUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useWorkspaceUiStore((state) => state.setSidebarOpen);
  const sidebarWidth = useWorkspaceUiStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspaceUiStore((state) => state.setSidebarWidth);
  const rightPanelDurableByWorkspace = useWorkspaceUiStore(
    (state) => state.rightPanelDurableByWorkspace,
  );
  const rightPanelMaterializedByWorkspace = useWorkspaceUiStore(
    (state) => state.rightPanelMaterializedByWorkspace,
  );
  const setRightPanelDurableForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelDurableForWorkspace,
  );
  const setRightPanelMaterializedForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelMaterializedForWorkspace,
  );
  const rightPanelDurableFallback = resolveWithWorkspaceFallback(
    rightPanelDurableByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const persistedRightPanelDurableState = normalizeRightPanelDurableState(
    rightPanelDurableFallback.value ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE,
  );
  const rightPanelDurableState = rightPanelSessionDurableState
    ?? persistedRightPanelDurableState;
  const rightPanelMaterializedState = materializedWorkspaceId
    ? rightPanelMaterializedByWorkspace[materializedWorkspaceId]
      ?? DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE
    : DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE;
  const rightPanelWidth = rightPanelDurableState.width ?? RIGHT_PANEL_DEFAULT_WIDTH;
  const rightPanelState = useMemo(
    () => reconcileRightPanelWorkspaceState(rightPanelMaterializedState, {
      isCloudWorkspaceSelected,
    }),
    [isCloudWorkspaceSelected, rightPanelMaterializedState],
  );
  useEffect(() => {
    if (
      !workspaceUiKey
      || !rightPanelDurableFallback.shouldWriteBack
      || !rightPanelDurableFallback.value
    ) {
      return;
    }
    setRightPanelDurableForWorkspace(workspaceUiKey, rightPanelDurableFallback.value);
  }, [
    rightPanelDurableFallback.shouldWriteBack,
    rightPanelDurableFallback.value,
    setRightPanelDurableForWorkspace,
    workspaceUiKey,
  ]);
  const setRightPanelState = useCallback<Dispatch<SetStateAction<RightPanelWorkspaceState>>>(
    (value) => {
      if (!workspaceUiKey) {
        return;
      }
      const next = typeof value === "function"
        ? (value as (previous: RightPanelWorkspaceState) => RightPanelWorkspaceState)(
            rightPanelState,
          )
        : value;
      if (materializedWorkspaceId) {
        setRightPanelMaterializedForWorkspace(
          materializedWorkspaceId,
          reconcileRightPanelWorkspaceState(next, { isCloudWorkspaceSelected }),
        );
      }
    },
    [
      isCloudWorkspaceSelected,
      materializedWorkspaceId,
      rightPanelState,
      setRightPanelMaterializedForWorkspace,
      workspaceUiKey,
    ],
  );
  const setRightPanelWidth = useCallback<Dispatch<SetStateAction<number>>>(
    (value) => {
      if (!workspaceUiKey) {
        return;
      }
      const nextWidth = typeof value === "function"
        ? (value as (previous: number) => number)(rightPanelDurableState.width)
        : value;
      const nextDurableState = {
        ...rightPanelDurableState,
        width: clampRightPanelWidth(nextWidth),
      };
      setRightPanelSessionDurableState(nextDurableState);
      setRightPanelDurableForWorkspace(workspaceUiKey, nextDurableState);
    },
    [
      rightPanelDurableState,
      setRightPanelDurableForWorkspace,
      workspaceUiKey,
    ],
  );
  const setRightPanelOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      if (!workspaceUiKey) {
        return;
      }
      const nextOpen = typeof value === "function"
        ? (value as (previous: boolean) => boolean)(rightPanelDurableState.open)
        : value;
      const nextDurableState = {
        ...rightPanelDurableState,
        open: nextOpen,
      };
      setRightPanelSessionDurableState(nextDurableState);
      setRightPanelDurableForWorkspace(workspaceUiKey, nextDurableState);
      if (nextOpen && materializedWorkspaceId) {
        setRightPanelUserOpenOverride((current) => ({
          materializedWorkspaceId,
          nonce: (current?.nonce ?? 0) + 1,
        }));
      } else {
        setRightPanelUserOpenOverride(null);
      }
    },
    [
      materializedWorkspaceId,
      rightPanelDurableState.open,
      rightPanelDurableState,
      setRightPanelDurableForWorkspace,
      workspaceUiKey,
    ],
  );
  const requestRightPanelFocus = useCallback(() => {
    setRightPanelFocusRequestToken((token) => token + 1);
  }, []);

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
  const hasLaunchIntentOnlyShell = Boolean(
    activeLaunchIntent
    && !selectedWorkspaceId
    && pendingWorkspaceEntry === null,
  );
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
    workspaceId: materializedWorkspaceId,
    enabled: hasRuntimeReadyWorkspace && !hotPaintPending,
  });
  const shouldQueryCurrentPullRequest =
    hasRuntimeReadyWorkspace && !hotPaintPending && Boolean(gitStatus?.currentBranch?.trim());
  const { data: currentPullRequest } = useCurrentPullRequestQuery({
    workspaceId: materializedWorkspaceId,
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

  const rightPanelSuppressed = Boolean(pendingWorkspaceEntry);
  const userOpenOverrideActive = Boolean(
    rightPanelUserOpenOverride
    && rightPanelUserOpenOverride.materializedWorkspaceId === materializedWorkspaceId
    && rightPanelSuppressed,
  );
  const rightPanelOpen = rightPanelDurableState.open
    && (!rightPanelSuppressed || userOpenOverrideActive);

  useDebugValueChange("main_screen.inputs", "state_refs", {
    pendingWorkspaceEntry,
    selectedWorkspaceId,
    selectedLogicalWorkspaceId,
    workspaceUiKey,
    materializedWorkspaceId,
    hotPaintPending,
    sidebarOpen,
    sidebarWidth,
    rightPanelDurableByWorkspace,
    rightPanelMaterializedByWorkspace,
    rightPanelDurableState,
    rightPanelMaterializedState,
    rightPanelState,
    rightPanelOpen,
    rightPanelWidth,
    rightPanelUserOpenOverride,
    terminalActivationRequest,
    publishDialog,
    commandPaletteOpen,
    activeLaunchIntent,
    selectedCloudRuntimeState: selectedCloudRuntime.state,
    workspaceCollections,
    selectedWorkspace,
    selectedCloudWorkspace,
    gitStatus,
    currentPullRequest,
    hasWorkspaceShell,
    hasLaunchIntentOnlyShell,
    hasRuntimeReadyWorkspace,
    shouldKeepRuntimePanelsVisible,
  });

  useEffect(() => {
    if (
      !rightPanelUserOpenOverride
      || rightPanelUserOpenOverride.materializedWorkspaceId !== materializedWorkspaceId
      || !rightPanelSuppressed
    ) {
      setRightPanelUserOpenOverride(null);
    }
  }, [
    materializedWorkspaceId,
    rightPanelSuppressed,
    rightPanelUserOpenOverride,
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
      rightPanelFocusRequestToken,
      requestRightPanelFocus,
      terminalActivationRequest,
      setTerminalActivationRequest,
      publishDialog,
      setPublishDialog,
      commandPaletteOpen,
      setCommandPaletteOpen,
      rightPanelWidth,
      setRightPanelWidth,
      onLeftSeparatorDown,
      onRightSeparatorDown,
    },
    data: {
      hasRuntimeReadyWorkspace,
      shouldKeepRuntimePanelsVisible,
      hasWorkspaceShell,
      hasLaunchIntentOnlyShell,
      isCloudWorkspaceSelected: selectedCloudWorkspaceId !== null,
      selectedWorkspaceId,
      selectedWorkspace,
      selectedCloudWorkspace,
      gitStatus,
      existingPr: currentPullRequest?.pullRequest ?? null,
    },
  };
}
