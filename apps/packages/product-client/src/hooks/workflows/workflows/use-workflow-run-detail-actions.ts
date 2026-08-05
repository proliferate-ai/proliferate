import { useState } from "react";
import type {
  ManagedWorkflowOpenTarget,
} from "@proliferate/cloud-sdk";
import { workflowRunPresentation } from "@proliferate/product-domain/workflows/run-presentation";
import { useWorkflowRunDetailAccess } from "#product/hooks/access/cloud/workflows/use-workflow-run-access";
import {
  inspectWorkflowCloudError,
  projectWorkflowTargetLost,
  safeWorkflowActionError,
  type WorkflowRunOpenResult,
} from "#product/lib/domain/workflows/workflow-run-state";
import { runWorkflowOperationWithTimeout } from "#product/hooks/workflows/workflows/use-workflow-run-launch-actions";

export function useWorkflowRunDetailActions({
  authCacheScope,
  workflowDefinitionId,
  runId,
  managedRunsEnabled,
  onOpenSession,
}: {
  authCacheScope: string;
  workflowDefinitionId: string;
  runId: string;
  managedRunsEnabled: boolean;
  onOpenSession: (target: ManagedWorkflowOpenTarget) => Promise<WorkflowRunOpenResult>;
}) {
  const [targetLostInvocationId, setTargetLostInvocationId] = useState<string | null>(null);
  const targetLostByCancel = targetLostInvocationId === runId;
  const { query, actions } = useWorkflowRunDetailAccess(
    workflowDefinitionId,
    runId,
    authCacheScope,
    !targetLostByCancel,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = targetLostByCancel && query.data
    ? projectWorkflowTargetLost(query.data)
    : query.data;

  const refresh = () => {
    void query.refetch();
  };

  if (query.isLoading) {
    return { kind: "loading" as const, refresh };
  }
  const queryError = inspectWorkflowCloudError(query.error);
  if (queryError?.status === 404) {
    return { kind: "not-found" as const, refresh };
  }
  if (!run) {
    return { kind: "unavailable" as const, refresh };
  }
  if (run.workflowDefinitionId !== workflowDefinitionId) {
    return { kind: "not-found" as const, refresh };
  }

  const perform = async (operation: "deliver" | "cancel") => {
    setBusy(true);
    setActionError(null);
    try {
      if (operation === "deliver") {
        await runWorkflowOperationWithTimeout((signal) =>
          actions.deliverWorkflowInvocation({ invocationId: run.id, signal })
        );
      } else {
        await runWorkflowOperationWithTimeout((signal) =>
          actions.cancelWorkflowInvocation({ invocationId: run.id, signal })
        );
      }
    } catch (caught) {
      const cloudError = inspectWorkflowCloudError(caught);
      if (
        operation === "cancel"
        && cloudError?.status === 409
        && cloudError.code === "workflow_target_lost"
      ) {
        setTargetLostInvocationId(run.id);
        setActionError("The managed target was replaced. The final outcome is unknown.");
        await query.refetch();
      } else {
        setActionError(safeWorkflowActionError(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    const target = run.managedExecution.openTarget;
    if (!target) {
      return;
    }
    setBusy(true);
    setOpenError(null);
    try {
      const result = await onOpenSession(target);
      if (!result.opened) {
        setOpenError(result.message ?? "This workflow session is no longer available.");
      }
    } catch {
      setOpenError("This workflow session is no longer available.");
    } finally {
      setBusy(false);
    }
  };

  return {
    kind: "ready" as const,
    run,
    presentation: workflowRunPresentation(run),
    deliveryCapabilityEnabled: managedRunsEnabled,
    busy,
    actionError: actionError ?? (query.isError
      ? "The latest status could not be refreshed. The last known state is shown."
      : null),
    openSessionUnavailable: openError,
    refresh,
    startDelivery: () => {
      void perform("deliver");
    },
    cancel: () => {
      void perform("cancel");
    },
    openSession: () => {
      void open();
    },
  };
}
