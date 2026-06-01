import { useCallback, useRef } from "react";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import {
  elapsedMs,
  logLatency,
} from "@/lib/infra/measurement/debug-latency";
import { recordMeasurementWorkflowStep } from "@/lib/infra/measurement/debug-measurement";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";

interface PrefetchWorkspaceDirectoriesInput {
  materializedWorkspaceId: string;
  anyharnessWorkspaceId: string;
  runtimeUrl: string;
  treeStateKey: string;
  authToken?: string | null;
  isCurrent?: () => boolean;
}

export interface DeferredWorkspaceFileTreePrefetchInput extends PrefetchWorkspaceDirectoriesInput {
  workspaceId: string;
  measurementOperationId: MeasurementOperationId | null;
  startedAt: number;
  isCurrent: () => boolean;
}

export function useDeferredWorkspaceFileTreePrefetch({
  prefetchWorkspaceDirectories,
}: {
  prefetchWorkspaceDirectories: (
    input: PrefetchWorkspaceDirectoriesInput,
  ) => Promise<void>;
}) {
  const cancelDeferredFileTreePrefetchRef = useRef<(() => void) | null>(null);

  const cancelDeferredFileTreePrefetch = useCallback(() => {
    cancelDeferredFileTreePrefetchRef.current?.();
    cancelDeferredFileTreePrefetchRef.current = null;
  }, []);

  const scheduleDeferredFileTreePrefetch = useCallback((
    input: DeferredWorkspaceFileTreePrefetchInput,
  ) => {
    cancelDeferredFileTreePrefetch();
    let cancel: (() => void) | null = null;
    cancel = scheduleAfterNextPaint(() => {
      if (cancelDeferredFileTreePrefetchRef.current !== cancel) {
        return;
      }
      cancelDeferredFileTreePrefetchRef.current = null;
      if (!input.isCurrent()) {
        return;
      }
      void prefetchWorkspaceDirectories({
        materializedWorkspaceId: input.materializedWorkspaceId,
        anyharnessWorkspaceId: input.anyharnessWorkspaceId,
        runtimeUrl: input.runtimeUrl,
        treeStateKey: input.treeStateKey,
        authToken: input.authToken,
        isCurrent: input.isCurrent,
      }).then(() => {
        recordMeasurementWorkflowStep({
          operationId: input.measurementOperationId,
          step: "workspace.bootstrap.file_tree_init",
          startedAt: input.startedAt,
        });
        logLatency("workspace.select.file_tree_prefetched", {
          workspaceId: input.workspaceId,
          elapsedMs: elapsedMs(input.startedAt),
        });
      }).catch(() => {
        recordMeasurementWorkflowStep({
          operationId: input.measurementOperationId,
          step: "workspace.bootstrap.file_tree_init",
          startedAt: input.startedAt,
          outcome: "error_sanitized",
        });
      });
    });
    cancelDeferredFileTreePrefetchRef.current = cancel;
  }, [
    cancelDeferredFileTreePrefetch,
    prefetchWorkspaceDirectories,
  ]);

  return {
    cancelDeferredFileTreePrefetch,
    scheduleDeferredFileTreePrefetch,
  };
}
