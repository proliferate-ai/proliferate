import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowGraphNodePlacement } from "#product/domain/workflows/graph-layout";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";
import {
  readWorkflowNodeLayout,
  writeWorkflowNodeLayout,
  type WorkflowNodeLayout,
  type WorkflowNodeLayoutDependencies,
} from "#product/lib/workflows/preferences/workflow-node-layout-preferences";
import {
  readPersistedJsonValue,
  writePersistedJson,
} from "#product/lib/infra/persistence/product-storage";

/**
 * A drag is a stream of placements and only the one it ends on is worth
 * storing, so the write trails the last move rather than following each frame.
 */
const PERSIST_DELAY_MS = 400;

export interface WorkflowNodeLayoutModel {
  placements: WorkflowNodeLayout;
  moveNode: (nodeKey: string, placement: WorkflowGraphNodePlacement) => void;
}

/**
 * The builder canvas's hand placements for one workflow, hydrated from and
 * written back to this machine's storage.
 *
 * `definitionId` is `null` while a workflow is still a draft: it has no
 * identity to store placements under, so they are held in memory until the
 * first save mints one and the arrangement on screen is adopted under it.
 * Switching to a DIFFERENT workflow is the opposite case and starts clean.
 */
export function useWorkflowNodeLayout(definitionId: string | null): WorkflowNodeLayoutModel {
  const storage = useProductStorageContext();
  const dependencies = useMemo<WorkflowNodeLayoutDependencies>(() => ({
    readPersistedValue: (key) => readPersistedJsonValue(storage, key),
    persistValue: (key, value) => writePersistedJson(storage, key, value),
  }), [storage]);

  const [placements, setPlacements] = useState<WorkflowNodeLayout>({});
  // What the stored copy is for, and whether anything on screen is newer than
  // it — a placement made while the read was in flight must not be overwritten
  // when it lands.
  const trackedRef = useRef<{ id: string | null; moved: boolean }>({ id: definitionId, moved: false });

  useEffect(() => {
    const tracked = trackedRef.current;
    const adopted = tracked.id === null && definitionId !== null;
    trackedRef.current = { id: definitionId, moved: adopted && tracked.moved };
    if (adopted) {
      return;
    }
    setPlacements({});
    if (definitionId === null) {
      return;
    }
    let cancelled = false;
    void readWorkflowNodeLayout(definitionId, dependencies).then((stored) => {
      if (!cancelled && !trackedRef.current.moved) {
        setPlacements(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [definitionId, dependencies]);

  // What the trailing write owes storage, held outside the timer so a teardown
  // inside the delay window can still pay it.
  const unwrittenRef = useRef<{ id: string; placements: WorkflowNodeLayout } | null>(null);

  useEffect(() => {
    if (definitionId === null || !trackedRef.current.moved) {
      return;
    }
    unwrittenRef.current = { id: definitionId, placements };
    const timer = setTimeout(() => {
      unwrittenRef.current = null;
      void writeWorkflowNodeLayout(definitionId, placements, dependencies);
    }, PERSIST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [definitionId, dependencies, placements]);

  // Leaving this workflow — switching to another, or unmounting the builder —
  // cancels the timer above. Flush what it owed first, or the last move an
  // author made before leaving is the one move that never lands.
  useEffect(() => () => {
    const unwritten = unwrittenRef.current;
    if (unwritten) {
      unwrittenRef.current = null;
      void writeWorkflowNodeLayout(unwritten.id, unwritten.placements, dependencies);
    }
  }, [definitionId, dependencies]);

  const moveNode = useCallback((nodeKey: string, placement: WorkflowGraphNodePlacement) => {
    trackedRef.current = { ...trackedRef.current, moved: true };
    setPlacements((current) => ({ ...current, [nodeKey]: placement }));
  }, []);

  return { placements, moveNode };
}
