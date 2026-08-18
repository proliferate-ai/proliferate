import type { Workspace } from "@anyharness/sdk";
import { useWorkflowRunProjectionWriter } from "@anyharness/sdk-react";
import { useCallback, useRef, useState } from "react";
import { useWorkflowRunPut } from "#product/hooks/access/anyharness/workflows/use-workflow-run-put";
import { useWorkflowInvocationV2MutationsAccess } from "#product/hooks/access/cloud/workflows/use-workflow-trigger-access";
import { useWorkspaceCollectionsInvalidationActions } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { getWorkspace } from "#product/lib/access/anyharness/workspaces";
import { workflowTriggerFailureMessage } from "#product/lib/domain/workflows/workflow-trigger-failure";
import { workflowTriggerIdentityKey } from "#product/lib/domain/workflows/workflow-trigger-identity";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import {
  runWorkflowTrigger,
  WorkflowTriggerError,
  type TriggerCourierIds,
  type TriggerCourierInput,
  type TriggerCourierResult,
} from "#product/lib/workflows/trigger/trigger-courier";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

/** Bounded read-back of the launched workspace; see `readBackLaunchedWorkspace`. */
const WORKSPACE_READ_BACK_ATTEMPTS = 3;
const WORKSPACE_READ_BACK_DELAY_MS = 150;

/**
 * Stable lowercase class for a non-courier launch error, from its name only,
 * normalized into the renderer diagnostic classification charset (a value
 * outside `/^[a-z0-9][a-z0-9._:-]*$/` voids the whole record).
 */
function classifyUnknownLaunchError(caught: unknown): string {
  if (!(caught instanceof Error)) {
    return "unknown";
  }
  const normalized = caught.name.toLowerCase().replace(/[^a-z0-9._:-]/g, "_");
  return /^[a-z0-9]/.test(normalized) ? normalized : "unknown";
}

/**
 * The workspace a launch just materialized, read from the runtime.
 *
 * This read is the only thing that makes the new workspace selectable: the
 * collections cache was last filled before it existed, and refreshing that
 * cache cannot help the navigation about to happen — selection already holds
 * the snapshot it was rendered with. So one refused read would turn a
 * successful launch into "Workspace not found", and the read is retried
 * briefly rather than attempted once. `null` only after every attempt failed.
 */
async function readBackLaunchedWorkspace(
  runtimeUrl: string,
  workspaceId: string,
): Promise<Workspace | null> {
  for (let attempt = 0; attempt < WORKSPACE_READ_BACK_ATTEMPTS; attempt += 1) {
    const workspace = await getWorkspace({ runtimeUrl }, workspaceId).catch(() => null);
    if (workspace) {
      return workspace;
    }
    if (attempt < WORKSPACE_READ_BACK_ATTEMPTS - 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, WORKSPACE_READ_BACK_DELAY_MS * (attempt + 1));
      });
    }
  }
  return null;
}

export interface WorkflowTriggerLaunch {
  runId: string;
  workspaceId: string;
  /**
   * The workspace the run PUT just materialized, read back from the runtime.
   * Selection cannot find it in the workspace-collections cache — that cache
   * was last filled before this workspace existed — so the launch carries the
   * record itself as selection's `knownWorkspace` hint. `null` only if the
   * read-back failed; navigation is still attempted from the id.
   */
  workspace: Workspace | null;
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
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateWorkspaceCollectionsForRuntime } = useWorkspaceCollectionsInvalidationActions();
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
      recordRendererDiagnostic({
        name: "renderer.workflows.launch_submitted",
        severity: "info",
        kind: "milestone",
        privacy: "operational",
        correlation: {
          workflowId: result.runId,
          workspaceId: result.workspaceId,
        },
      });
      // The run PUT is what creates this workspace, so nothing else in the
      // client knows it exists: read it back for selection's `knownWorkspace`
      // hint and refresh the collections cache so the sidebar lists it.
      let workspace = await readBackLaunchedWorkspace(runtimeUrl, result.workspaceId);
      // Selection takes its collections snapshot when it is called, so a
      // refreshed cache resolves the workspace even with no hint at all. That
      // is the fallback for a read-back that never answered: wait for it, then
      // read once more however it settled. A refusal and a snapshot that
      // simply does not carry the new workspace yet leave selection with the
      // same nothing, and by then the runtime has had the whole refresh
      // attempt to answer for a row it has already committed. With a hint in
      // hand none of that is needed and the refresh settles behind the
      // navigation.
      const collectionsRefreshed = invalidateWorkspaceCollectionsForRuntime(runtimeUrl);
      if (workspace) {
        collectionsRefreshed.catch(() => {});
      } else {
        await collectionsRefreshed.catch(() => {});
        workspace = await readBackLaunchedWorkspace(runtimeUrl, result.workspaceId);
      }
      onLaunched?.({ runId: result.runId, workspaceId: result.workspaceId, workspace });
      return result;
    } catch (caught) {
      const failure = caught instanceof WorkflowTriggerError ? caught : null;
      recordRendererDiagnostic({
        name: "renderer.workflows.launch_failed",
        severity: "error",
        kind: "message",
        privacy: "operational",
        correlation: failure
          ? { workflowId: failure.ids.runId }
          : undefined,
        fields: {
          stage: diagnosticField(failure?.stage ?? "unknown", "operational"),
        },
        // Lowercase into the prevalidator's classification charset; a value
        // outside it drops the whole record.
        errorClassification: failure
          ? `trigger_${failure.stage}`
          : classifyUnknownLaunchError(caught),
      });
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
  }, [
    invalidateWorkspaceCollectionsForRuntime,
    onLaunched,
    putRun,
    putWorkflowInvocationV2,
    runtimeUrl,
    writeRunProjection,
  ]);

  return { triggerRun, triggering, error };
}
