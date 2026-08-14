import { useWorkflowRunProjectionWriter } from "@anyharness/sdk-react";
import { useCallback, useRef, useState } from "react";
import { useWorkflowRunPut } from "#product/hooks/access/anyharness/workflows/use-workflow-run-put";
import { useWorkflowInvocationV2MutationsAccess } from "#product/hooks/access/cloud/workflows/use-workflow-trigger-access";
import { workflowTriggerFailureMessage } from "#product/lib/domain/workflows/workflow-trigger-failure";
import { workflowTriggerIdentityKey } from "#product/lib/domain/workflows/workflow-trigger-identity";
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

/** Ids from a failed attempt, and the input they were minted for. */
interface WorkflowTriggerRetry {
  identityKey: string;
  ids: TriggerCourierIds;
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
  const writeRunProjection = useWorkflowRunProjectionWriter();
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ids held across a failed attempt, keyed to the input they were minted for.
  // Both PUTs are idempotent, so replaying the same identity is the recovery
  // path for an unchanged retry; minting fresh ids there would leave a second
  // invocation behind for one user action. Reusing them after the user edits
  // the repo pick or an input is the opposite mistake: the control plane 409s
  // a replayed id whose body differs, so the ids would deadlock the dialog.
  const retry = useRef<WorkflowTriggerRetry | null>(null);
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
    const identityKey = workflowTriggerIdentityKey(input);
    const ids = retry.current?.identityKey === identityKey ? retry.current.ids : {};
    try {
      const result = await runWorkflowTrigger({
        putInvocation: (invocationId, body) =>
          putWorkflowInvocationV2({ invocationId, body }),
        putRun: (runId, body) => putRun(runId, body),
        mintId: () => crypto.randomUUID(),
      }, input, ids);
      retry.current = null;
      // The PUT's response is the fresh projection, so mounted run views and
      // runs lists are served from it rather than refetching after navigation.
      writeRunProjection(result.projection);
      onLaunched?.({ runId: result.runId, workspaceId: result.workspaceId });
      return result;
    } catch (caught) {
      const failure = caught instanceof WorkflowTriggerError ? caught : null;
      retry.current = failure ? { identityKey, ids: failure.ids } : null;
      setError(workflowTriggerFailureMessage(
        failure ? failure.reason : caught,
        failure?.stage ?? null,
      ));
      return null;
    } finally {
      inFlight.current = false;
      setTriggering(false);
    }
  }, [onLaunched, putRun, putWorkflowInvocationV2, writeRunProjection]);

  return { triggerRun, triggering, error };
}
