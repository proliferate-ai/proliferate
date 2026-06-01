import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/derived/use-hot-paint-gate";
import { buildPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import type {
  FileViewerMode,
  ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import {
  useWorkspaceFileBuffersStore,
  type WorkspaceFileBuffer,
} from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const EMPTY_OPEN_TARGETS: ViewerTarget[] = [];
const EMPTY_BUFFERS_BY_PATH: Record<string, WorkspaceFileBuffer> = {};
const EMPTY_TAB_MODES: Record<string, FileViewerMode> = {};

export function useWorkspaceHeaderTabsWorkspaceState() {
  const rawOpenTargets = useWorkspaceViewerTabsStore((s) => s.openTargets);
  const rawBuffersByPath = useWorkspaceFileBuffersStore((s) => s.buffersByPath);
  const rawTabModes = useWorkspaceViewerTabsStore((s) => s.modeByTargetKey);
  const viewerStoreMaterializedWorkspaceId = useWorkspaceViewerTabsStore(
    (s) => s.materializedWorkspaceId,
  );

  const selectedWorkspaceId = useSessionSelectionStore((s) => s.selectedWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((s) => s.pendingWorkspaceEntry);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (s) => s.selectedLogicalWorkspaceId,
  );
  const selectedIdentity = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const { workspaceUiKey, materializedWorkspaceId } = selectedIdentity;
  const activeSessionId = useSessionSelectionStore((s) => s.activeSessionId);
  const pendingWorkspaceUiKey = pendingWorkspaceEntry
    ? buildPendingWorkspaceUiKey(pendingWorkspaceEntry)
    : null;
  const activeSessionWorkspaceId = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.workspaceId ?? null : null
  );
  const resolvedSessionWorkspaceId = materializedWorkspaceId ?? workspaceUiKey;
  const sessionWorkspaceId =
    pendingWorkspaceUiKey && activeSessionWorkspaceId === pendingWorkspaceUiKey
      ? pendingWorkspaceUiKey
      : resolvedSessionWorkspaceId;
  const isViewerStoreCurrent = Boolean(
    materializedWorkspaceId
      && viewerStoreMaterializedWorkspaceId === materializedWorkspaceId,
  );
  const openTargets = isViewerStoreCurrent ? rawOpenTargets : EMPTY_OPEN_TARGETS;
  const buffersByPath = isViewerStoreCurrent ? rawBuffersByPath : EMPTY_BUFFERS_BY_PATH;
  const tabModes = isViewerStoreCurrent ? rawTabModes : EMPTY_TAB_MODES;
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);

  return {
    activeSessionId,
    activeSessionWorkspaceId,
    buffersByPath,
    hotPaintPending,
    materializedWorkspaceId,
    openTargets,
    pendingWorkspaceEntry,
    pendingWorkspaceUiKey,
    resolvedSessionWorkspaceId,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    sessionWorkspaceId,
    tabModes,
    workspaceUiKey,
  };
}
