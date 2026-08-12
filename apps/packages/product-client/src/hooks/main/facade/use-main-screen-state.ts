import type { CurrentPullRequestResponse, GitStatusSnapshot, RepoRoot, Workspace } from "@anyharness/sdk";
import { useCurrentPullRequestQuery, useGitStatusQuery } from "@anyharness/sdk-react";
import {
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import {
  useMainScreenRightPanel,
  type MainScreenRightPanelState,
} from "#product/hooks/main/facade/use-main-screen-right-panel";
import { useWorkspaceSidebarResize } from "#product/hooks/preferences/ui/use-workspace-sidebar-resize";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { useIsHotPaintGatePendingForWorkspace } from "#product/hooks/workspaces/derived/use-hot-paint-gate";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { shouldMountWorkspaceShell } from "#product/lib/domain/chat/surface/chat-surface";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  CLOSED_PUBLISH_DIALOG_STATE,
  type PublishDialogState,
} from "#product/lib/domain/workspaces/creation/publish-dialog-state";

const EMPTY_WORKSPACES: Workspace[] = [];

// The right panel's own surface is defined where it is implemented; the shell's
// layout state is that plus the sidebar and the shell-level dialogs.
export interface MainScreenLayoutState extends MainScreenRightPanelState {
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  /** True while the left separator is driving live, non-durable geometry. */
  sidebarResizing: boolean;
  terminalActivationRequest: TerminalActivationRequest | null;
  setTerminalActivationRequest: Dispatch<SetStateAction<TerminalActivationRequest | null>>;
  publishDialog: PublishDialogState;
  setPublishDialog: Dispatch<SetStateAction<PublishDialogState>>;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  onLeftSeparatorDown: (event: MouseEvent) => void;
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
  workspaceUiKey: string | null;
  selectedWorkspaceId: string | null;
  selectedWorkspace: Workspace | undefined;
  selectedRepoRoot: RepoRoot | undefined;
  selectedCloudWorkspace: CloudWorkspaceSummary | undefined;
  gitStatus: GitStatusSnapshot | undefined;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
}

export interface MainScreenState {
  layout: MainScreenLayoutState;
  data: MainScreenDataState;
}

// Owns the Main screen view-model: local layout state plus selected workspace
// data needed by the shell. User actions live in main/workflows.
export function useMainScreenState(): MainScreenState {
  const [terminalActivationRequest, setTerminalActivationRequest] =
    useState<TerminalActivationRequest | null>(null);
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
  const {
    sidebarWidth,
    setSidebarWidth,
    sidebarResizing,
    onSidebarSeparatorDown: onLeftSeparatorDown,
  } = useWorkspaceSidebarResize();

  // The right panel's frame — geometry, open state, focus requests and the
  // separator drag that can collapse it — is its own concern; this facade only
  // tells it which workspace it belongs to and whether the shell is currently
  // suppressing it.
  const rightPanel = useMainScreenRightPanel({
    workspaceUiKey,
    materializedWorkspaceId,
    isCloudWorkspaceSelected,
    rightPanelSuppressed: Boolean(pendingWorkspaceEntry),
  });

  const activeLaunchIntent = useChatLaunchIntentStore((state) => state.activeIntent);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const repoRoots = workspaceCollections?.repoRoots ?? [];
  const activeLaunchIntentIdForShell =
    selectedWorkspaceId || pendingWorkspaceEntry
      ? activeLaunchIntent?.id ?? null
      : null;
  const hasLaunchIntentOnlyShell = false;
  const hasWorkspaceShell = shouldMountWorkspaceShell({
    selectedWorkspaceId,
    hasPendingWorkspaceEntry: pendingWorkspaceEntry !== null,
    activeLaunchIntentId: activeLaunchIntentIdForShell,
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
    hasRuntimeReadyWorkspace
    && !hotPaintPending
    && Boolean(gitStatus?.currentBranch?.trim());
  const { data: currentPullRequest } = useCurrentPullRequestQuery({
    workspaceId: materializedWorkspaceId,
    enabled: shouldQueryCurrentPullRequest,
  });

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId),
    [selectedWorkspaceId, workspaces],
  );
  const selectedRepoRoot = useMemo(
    () => selectedWorkspace?.repoRootId
      ? repoRoots.find((repoRoot) => repoRoot.id === selectedWorkspace.repoRootId)
      : undefined,
    [repoRoots, selectedWorkspace?.repoRootId],
  );
  const selectedCloudWorkspace = useMemo(
    () => workspaceCollections?.cloudWorkspaces.find(
      (workspace) => workspace.id === selectedCloudWorkspaceId,
    ),
    [selectedCloudWorkspaceId, workspaceCollections?.cloudWorkspaces],
  );

  return {
    layout: {
      ...rightPanel,
      sidebarOpen,
      setSidebarOpen,
      sidebarWidth,
      setSidebarWidth,
      sidebarResizing,
      terminalActivationRequest,
      setTerminalActivationRequest,
      publishDialog,
      setPublishDialog,
      commandPaletteOpen,
      setCommandPaletteOpen,
      onLeftSeparatorDown,
    },
    data: {
      hasRuntimeReadyWorkspace,
      shouldKeepRuntimePanelsVisible,
      hasWorkspaceShell,
      hasLaunchIntentOnlyShell,
      isCloudWorkspaceSelected: selectedCloudWorkspaceId !== null,
      workspaceUiKey,
      selectedWorkspaceId,
      selectedWorkspace,
      selectedRepoRoot,
      selectedCloudWorkspace,
      gitStatus,
      existingPr: currentPullRequest?.pullRequest ?? null,
    },
  };
}
