import { useCallback, useRef, useState } from "react";
import { useWorkflowRunPut } from "#product/hooks/access/anyharness/workflows/use-workflow-run-put";
import { useWorkflowInvocationV2MutationsAccess } from "#product/hooks/access/cloud/workflows/use-workflow-trigger-access";
import { safeWorkflowActionError } from "#product/lib/domain/workflows/workflow-run-state";
import {
  runWorkflowTrigger,
  WorkflowTriggerError,
  type TriggerCourierIds,
  type TriggerCourierInput,
  type TriggerCourierResult,
} from "#product/lib/workflows/trigger/trigger-courier";

export interface WorkflowTriggerLaunch {
  runId: string;
  workspaceId: string;
}

/**
 * Binds the trigger courier's deps to the two live planes and owns nothing
 * but request state: the control-plane invocation PUT, the runtime run PUT,
 * and client-minted ids (`crypto.randomUUID`, the same minting gen-1's
 * `use-workflow-run-launch-actions.ts` uses for its invocation id).
 * Sequencing lives in `lib/workflows/trigger/trigger-courier.ts`.
 */
export function useWorkflowTriggerActions({
  authCacheScope,
  onLaunched,
}: {
  authCacheScope: string;
  onLaunched?: (launch: WorkflowTriggerLaunch) => void;
}) {
  const { putWorkflowInvocationV2 } = useWorkflowInvocationV2MutationsAccess(authCacheScope);
  const putRun = useWorkflowRunPut();
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ids held across a failed attempt. Both PUTs are idempotent, so replaying
  // the same identity is the recovery path; minting fresh ids on retry would
  // leave a second invocation behind for one user action.
  const retryIds = useRef<TriggerCourierIds>({});
  const inFlight = useRef(false);

  const triggerRun = useCallback(async (
    input: TriggerCourierInput,
  ): Promise<TriggerCourierResult | null> => {
    if (inFlight.current) {
      return null;
    }
    inFlight.current = true;
    setTriggering(true);
    setError(null);
    try {
      const result = await runWorkflowTrigger({
        putInvocation: (invocationId, body) =>
          putWorkflowInvocationV2({ invocationId, body }),
        putRun: (runId, body) => putRun(runId, body),
        mintId: () => crypto.randomUUID(),
      }, input, retryIds.current);
      retryIds.current = {};
      onLaunched?.({ runId: result.runId, workspaceId: result.workspaceId });
      return result;
    } catch (caught) {
      const failure = caught instanceof WorkflowTriggerError ? caught : null;
      if (failure) {
        retryIds.current = failure.ids;
      }
      setError(safeWorkflowActionError(failure ? failure.reason : caught));
      return null;
    } finally {
      inFlight.current = false;
      setTriggering(false);
    }
  }, [onLaunched, putRun, putWorkflowInvocationV2]);

  return { triggerRun, triggering, error };
}
