/**
 * Local AnyHarness workflow-run access (spec 3.2 desktop lane).
 *
 * The desktop hands a resolved plan to its *local* runtime itself and then
 * relays observed state back to the server. The `@anyharness/sdk` client has no
 * workflow-run surface yet, so this is a thin typed `fetch` against the local
 * runtime — kept behind the AnyHarness access boundary like every other runtime
 * call.
 */

import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

/** Local (or SSH-tunnelled) runtime connection. Local runs carry no auth token. */
export interface LocalRuntimeConnection {
  runtimeUrl: string;
  authToken?: string;
}

/** Mirrors anyharness `WorkflowRunStatus` (observed vocabulary). */
export type LocalWorkflowRunStatus =
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface LocalWorkflowStepRunView {
  stepIndex: number;
  kind: string;
  status: string;
  output?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** Mirrors anyharness `WorkflowRunView` (the shape POST echoes / GET returns). */
export interface LocalWorkflowRunView {
  runId: string;
  workspaceId: string;
  status: LocalWorkflowRunStatus;
  stepCursor: number;
  sessionIds?: string[];
  steps?: LocalWorkflowStepRunView[];
  errorCode?: string | null;
  errorMessage?: string | null;
}

const WORKFLOW_RUNS_PATH = "/v1/workflow-runs";

function headers(connection: LocalRuntimeConnection): HeadersInit {
  const base: Record<string, string> = { "content-type": "application/json" };
  if (connection.authToken) {
    base.authorization = `Bearer ${connection.authToken}`;
  }
  return base;
}

function runtimeBase(connection: LocalRuntimeConnection): string {
  return connection.runtimeUrl.replace(/\/+$/, "");
}

async function parseError(response: Response, action: string): Promise<Error> {
  let detail = "";
  try {
    const body = (await response.json()) as { detail?: string; title?: string };
    detail = body.detail ?? body.title ?? "";
  } catch {
    detail = "";
  }
  return new Error(
    detail
      ? `Failed to ${action}: ${detail}`
      : `Failed to ${action} (status ${response.status}).`,
  );
}

/**
 * Deliver the resolved plan to the local runtime. Idempotent on the plan's
 * `run_id`: a re-POST echoes the existing run (202).
 */
export async function createLocalWorkflowRun(
  connection: LocalRuntimeConnection,
  request: { plan: unknown; workspaceId: string },
  options?: { signal?: AbortSignal },
): Promise<LocalWorkflowRunView> {
  const response = await fetch(`${runtimeBase(connection)}${WORKFLOW_RUNS_PATH}`, {
    method: "POST",
    headers: headers(connection),
    body: JSON.stringify(request),
    signal: options?.signal,
  });
  if (!response.ok) {
    throw await parseError(response, "deliver the workflow run");
  }
  return (await response.json()) as LocalWorkflowRunView;
}

export async function getLocalWorkflowRun(
  connection: LocalRuntimeConnection,
  runId: string,
  options?: { signal?: AbortSignal },
): Promise<LocalWorkflowRunView> {
  const response = await fetch(
    `${runtimeBase(connection)}${WORKFLOW_RUNS_PATH}/${encodeURIComponent(runId)}`,
    { method: "GET", headers: headers(connection), signal: options?.signal },
  );
  if (!response.ok) {
    throw await parseError(response, "read the workflow run");
  }
  return (await response.json()) as LocalWorkflowRunView;
}

export async function resolveLocalWorkflowApproval(
  connection: LocalRuntimeConnection,
  runId: string,
  approve: boolean,
): Promise<LocalWorkflowRunView> {
  const response = await fetch(
    `${runtimeBase(connection)}${WORKFLOW_RUNS_PATH}/${encodeURIComponent(runId)}/approval`,
    {
      method: "POST",
      headers: headers(connection),
      body: JSON.stringify({ approve }),
    },
  );
  if (!response.ok) {
    throw await parseError(response, approve ? "approve the step" : "deny the step");
  }
  return (await response.json()) as LocalWorkflowRunView;
}

/**
 * The local workflow executor's runtime deps (`WorkflowExecutorDeps` in
 * `lib/workflows/local-workflow-executor.ts`), wired to the local runtime's
 * AnyHarness client. Kept behind the AnyHarness access boundary — the claim
 * poller hook passes a `runtimeUrl` and gets back typed callbacks, never the
 * raw client.
 */
export function buildLocalWorkflowExecutorDeps(runtimeUrl: string) {
  const connection: AnyHarnessClientConnection = { runtimeUrl };
  const client = getAnyHarnessClient(connection);
  return {
    createWorktree: (input: Parameters<typeof client.workspaces.createWorktree>[0]) =>
      client.workspaces.createWorktree(input),
    getSetupStatus: (workspaceId: string) => client.workspaces.getSetupStatus(workspaceId),
    startSetup: (
      workspaceId: string,
      setupInput: Parameters<typeof client.workspaces.startSetup>[1],
    ) => client.workspaces.startSetup(workspaceId, setupInput),
    deliverPlan: (payload: { plan: unknown; workspaceId: string }) =>
      createLocalWorkflowRun({ runtimeUrl }, { plan: payload.plan, workspaceId: payload.workspaceId }),
  };
}
