import { useEffect, useRef } from "react";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";
import { hasOwnKey } from "#product/lib/domain/files/file-tree-dock-state";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import {
  selectFileTreeDurableSnapshot,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";
import {
  attachFileTreeDockPersistence,
  type FileTreeDockAttachment,
  type FileTreeDockDiagnosticSink,
  type FileTreeDockStatePort,
} from "#product/hooks/workspaces/lifecycle/files/file-tree-dock-persistence-coordinator";

/**
 * The single hydration, migration, ProductStorage attachment, and persistence
 * owner for the docked file tree. `FileEditorView` and every presentational
 * component consume only synchronous hydrated/default store state and perform no
 * persistence I/O.
 *
 * The effect is keyed by the injected storage object identity plus the telemetry
 * callback: a same-storage host/context refresh reattaches to the same authority
 * coordinator and only refreshes its diagnostic sink, while a genuinely
 * different storage object gets an isolated authority.
 */
export const fileTreeDockStorePort: FileTreeDockStatePort = {
  getDurableRevision: () => useFileTreeStore.getState().durableRevision,
  getDurableSnapshot: () => selectFileTreeDurableSnapshot(useFileTreeStore.getState()),
  prepareVisibilityPromotion: (keys) =>
    useFileTreeStore.getState().prepareRequestedVisibilityPromotion(keys),
  replaceAuthorityState: (input) =>
    useFileTreeStore.getState().replaceFileTreeDockAuthorityState(input),
  applyHydratedState: (input) =>
    useFileTreeStore.getState().applyHydratedFileTreeDockState(input),
  commitPromotions: (input) =>
    useFileTreeStore.getState().commitRequestedVisibilityPromotions(input),
};

export function useFileTreeDockPersistenceLifecycle(): void {
  const { storage, captureException } = useProductStorageContext();
  const attachmentRef = useRef<FileTreeDockAttachment | null>(null);
  const selectedWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedWorkspaceId,
  );
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });

  useEffect(() => {
    const attachment = attachFileTreeDockPersistence({
      storage,
      statePort: fileTreeDockStorePort,
      sink: createFileTreeDockDiagnosticSink(captureException),
    });
    attachmentRef.current = attachment;
    const unsubscribe = subscribeDurableMutations(attachment);
    return () => {
      unsubscribe();
      attachmentRef.current = null;
      attachment.detach();
    };
  }, [storage, captureException]);

  useEffect(() => {
    attachmentRef.current?.ensureRequestedVisibilityPromotion({
      primaryKey: workspaceUiKey,
      fallbackKey: materializedWorkspaceId,
    });
  }, [storage, captureException, workspaceUiKey, materializedWorkspaceId]);
}

/**
 * Relay each new `durableRevision` plus its affected field category to the
 * attached authority coordinator. Non-durable commits (hydration merge,
 * promotion acknowledgement) do not carry a new revision and only refresh the
 * comparison baseline.
 */
function subscribeDurableMutations(attachment: FileTreeDockAttachment): () => void {
  let previous = selectFileTreeDurableSnapshot(useFileTreeStore.getState());
  let previousRevision = useFileTreeStore.getState().durableRevision;
  return useFileTreeStore.subscribe((state) => {
    const snapshot = selectFileTreeDurableSnapshot(state);
    if (state.durableRevision === previousRevision) {
      previous = snapshot;
      return;
    }
    const widthChanged = snapshot.width !== previous.width;
    const changedVisibilityKeys = diffVisibilityKeys(
      previous.requestedVisibilityByWorkspace,
      snapshot.requestedVisibilityByWorkspace,
    );
    previous = snapshot;
    previousRevision = state.durableRevision;
    attachment.noteDurableMutation({
      revision: state.durableRevision,
      snapshot,
      widthChanged,
      changedVisibilityKeys,
    });
  });
}

function diffVisibilityKeys(
  before: Readonly<Record<string, boolean>>,
  after: Readonly<Record<string, boolean>>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) =>
      hasOwnKey(before, key) !== hasOwnKey(after, key)
      || before[key] !== after[key],
  );
}

function createFileTreeDockDiagnosticSink(
  captureException: (error: unknown, context?: { tags?: Record<string, string> }) => void,
): FileTreeDockDiagnosticSink {
  // Categorical only: operation and outcome. Never a payload, key contents,
  // path, or workspace identifier.
  return (event) => {
    captureException(
      new Error(`file_tree_dock_persistence_${event.operation}_${event.outcome}`),
      {
        tags: {
          domain: "file_tree_dock_persistence",
          operation: event.operation,
          outcome: event.outcome,
        },
      },
    );
  };
}
