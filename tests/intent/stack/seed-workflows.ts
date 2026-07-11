// Workflows seeding + API helpers (T2-WF-1..7). Split from seed.ts (already near
// the 600-line house convention) into a dedicated home for the workflows surface,
// same spirit as seed-integrations.ts.
//
// Everything here drives the product's own HTTP surface
// (`/v1/cloud/workflows`, `/v1/cloud/integrations/functions`,
// `/v1/cloud/integrations/admin/...`) except:
//   - `seedCloudRepoEnvironment` — a direct-DB seed of a materialized cloud
//     workspace + its repo environment. The product's create path
//     (`POST /cloud/workspaces`, cloud repo-add) is GitHub-App-gated and
//     unreachable in tier-2 (the same NEEDS-GITHUB-FIXTURE wall
//     cloud-workspace.spec.ts documents), so seeding the row a workflow trigger's
//     D16 derivation reads is the legitimate direct-DB exception (same class as
//     seed.ts's invitation-expiry / SSO-connection seeds).
//   - `readTriggerPollCursor` / `readTriggerItemStatuses` — direct-DB READS of
//     the poll seen-set + opaque cursor, which the product exposes no read API
//     for beyond the items list (cursor is internal).
//   - `runPollerTick` — invokes the REAL poller tick
//     (`run_workflow_poller_tick`) in a one-off server-venv process against the
//     profile DB. The poll loop runs only in the automations worker (not booted
//     by the tier-2 stack), and there is no HTTP endpoint to drive one tick, so
//     invoking the poller's own tick function is the honest driving seam the
//     testing README calls for — it does the real HTTP GET to the stub feed and
//     the real DB writes; it does NOT fake a poll.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { apiBaseUrl, apiRequest, databaseUrl, toPostgresDriverUrl } from "./seed.ts";

interface ApiResult<T> {
  status: number;
  body: T;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// ── Definition builders ────────────────────────────────────────────────────

export interface WorkflowDefinition {
  version: 1;
  name?: string;
  description?: string;
  inputs?: Array<Record<string, unknown>>;
  integrations?: string[];
  agents: Array<Record<string, unknown>>;
}

/** A minimal single-agent-node definition with one `agent.prompt` step. */
export function singlePromptDefinition(prompt: string, inputs: Array<Record<string, unknown>> = []): WorkflowDefinition {
  return {
    version: 1,
    inputs,
    integrations: [],
    agents: [
      {
        slot: "main",
        harness: "claude",
        model: "sonnet",
        steps: [{ kind: "agent.prompt", prompt }],
      },
    ],
  };
}

// ── Workflow CRUD ───────────────────────────────────────────────────────────

export interface WorkflowVersionResult {
  id: string;
  workflowId: string;
  versionN: number;
  definition: Record<string, unknown>;
}

export interface WorkflowResult {
  id: string;
  ownerUserId: string | null;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  isSeed: boolean;
  seedSlug: string | null;
}

export interface WorkflowDetailResult {
  workflow: WorkflowResult;
  currentVersion: WorkflowVersionResult | null;
  versions: WorkflowVersionResult[];
}

export async function createWorkflow(
  token: string,
  params: { name: string; description?: string; definition: WorkflowDefinition },
): Promise<ApiResult<WorkflowDetailResult>> {
  return apiRequest<WorkflowDetailResult>("/v1/cloud/workflows", {
    method: "POST",
    token,
    body: { name: params.name, description: params.description, definition: params.definition },
  });
}

export async function getWorkflow(token: string, workflowId: string): Promise<ApiResult<WorkflowDetailResult>> {
  return apiRequest<WorkflowDetailResult>(`/v1/cloud/workflows/${workflowId}`, { token });
}

export async function listWorkflows(token: string): Promise<ApiResult<{ workflows: WorkflowResult[] }>> {
  return apiRequest<{ workflows: WorkflowResult[] }>("/v1/cloud/workflows", { token });
}

export async function archiveWorkflow(token: string, workflowId: string): Promise<ApiResult<WorkflowResult>> {
  return apiRequest<WorkflowResult>(`/v1/cloud/workflows/${workflowId}`, { method: "DELETE", token });
}

/**
 * Archive every non-archived workflow the caller owns, giving a clean 0-count
 * slate. The free-plan cap is ONE active workflow per user
 * (FREE_PLAN_MAX_WORKFLOWS_PER_USER), and these specs all run as the single
 * shared owner against a profile DB that persists between runs — so a workflow
 * left active by a prior test/run would 403 `workflow_limit_reached` on the next
 * create. Called before a create so each test starts from zero regardless of
 * leftover state. (Archiving is soft — runs/triggers/items are untouched, which
 * is why the poll seen-set assertions still key off freshly-created triggers.)
 */
export async function resetActiveWorkflows(token: string): Promise<void> {
  const result = await listWorkflows(token);
  if (result.status !== 200) {
    throw new Error(`listWorkflows failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  for (const workflow of result.body.workflows) {
    await archiveWorkflow(token, workflow.id);
  }
}

export async function updateWorkflow(
  token: string,
  workflowId: string,
  params: { name?: string; description?: string; definition: WorkflowDefinition },
): Promise<ApiResult<WorkflowDetailResult>> {
  return apiRequest<WorkflowDetailResult>(`/v1/cloud/workflows/${workflowId}`, {
    method: "PATCH",
    token,
    body: { name: params.name, description: params.description, definition: params.definition },
  });
}

/** Create a workflow and return its id, throwing on a non-200 (fixture setup). */
export async function createWorkflowOrThrow(
  token: string,
  params: { name: string; description?: string; definition: WorkflowDefinition },
): Promise<WorkflowDetailResult> {
  const result = await createWorkflow(token, params);
  if (result.status !== 200) {
    throw new Error(`createWorkflow failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

// ── Runs (StartRun + delivery-seam) ──────────────────────────────────────────

export interface WorkflowRunResult {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  triggerKind: string;
  triggerId: string | null;
  executorUserId: string;
  args: Record<string, unknown>;
  targetMode: string;
  resolvedPlan: Record<string, unknown>;
  status: string;
  deliveredAt: string | null;
  finishedAt: string | null;
  stoppedByUserId: string | null;
}

export async function startRun(
  token: string,
  workflowId: string,
  params: {
    targetMode: "local" | "personal_cloud";
    inputs?: Record<string, unknown>;
    workspaceId?: string;
    triggerId?: string;
    versionId?: string;
    sessionBindings?: Record<string, string>;
  },
): Promise<ApiResult<WorkflowRunResult>> {
  const target: Record<string, string> = {};
  if (params.workspaceId !== undefined) target.workspaceId = params.workspaceId;
  if (params.triggerId !== undefined) target.triggerId = params.triggerId;
  return apiRequest<WorkflowRunResult>(`/v1/cloud/workflows/${workflowId}/runs`, {
    method: "POST",
    token,
    body: {
      targetMode: params.targetMode,
      inputs: params.inputs ?? {},
      versionId: params.versionId,
      target,
      sessionBindings: params.sessionBindings ?? {},
    },
  });
}

export async function getRun(token: string, runId: string): Promise<ApiResult<{ run: WorkflowRunResult }>> {
  return apiRequest<{ run: WorkflowRunResult }>(`/v1/cloud/workflows/runs/${runId}`, { token });
}

export async function markRunDelivered(token: string, runId: string): Promise<ApiResult<WorkflowRunResult>> {
  return apiRequest<WorkflowRunResult>(`/v1/cloud/workflows/runs/${runId}/delivered`, {
    method: "POST",
    token,
  });
}

export async function cancelRun(token: string, runId: string): Promise<ApiResult<WorkflowRunResult>> {
  return apiRequest<WorkflowRunResult>(`/v1/cloud/workflows/runs/${runId}/cancel`, {
    method: "POST",
    token,
  });
}

export async function listWorkflowRuns(
  token: string,
  workflowId: string,
): Promise<ApiResult<{ runs: WorkflowRunResult[] }>> {
  return apiRequest<{ runs: WorkflowRunResult[] }>(`/v1/cloud/workflows/${workflowId}/runs`, { token });
}

// ── Triggers (schedule + poll) ────────────────────────────────────────────────

export interface TriggerPollResult {
  url: string;
  authHeader: string | null;
  hasAuth: boolean;
  intervalSecs: number;
  itemSchema: Record<string, unknown> | null;
  lastPollAt: string | null;
  lastPollError: string | null;
}

export interface TriggerScheduleResult {
  rrule: string;
  timezone: string;
  summary: string | null;
}

export interface WorkflowTriggerResult {
  id: string;
  workflowId: string;
  kind: string;
  enabled: boolean;
  concurrencyPolicy: string;
  missedRunPolicy: string;
  targetMode: string;
  repoFullName: string | null;
  targetWorkspaceId: string | null;
  schedule: TriggerScheduleResult | null;
  poll: TriggerPollResult | null;
  nextRunAt: string | null;
  args: Record<string, unknown>;
}

export interface CreateTriggerParams {
  kind: "schedule" | "poll";
  enabled?: boolean;
  concurrencyPolicy: "skip" | "queue";
  missedRunPolicy?: "run_latest" | "skip_all" | "replay_all";
  targetMode: "local" | "personal_cloud";
  repoFullName?: string;
  schedule?: { rrule: string; timezone: string };
  poll?: { url: string; authHeader?: string; authValue?: string; intervalSecs: number };
  args?: Record<string, unknown>;
}

export async function createTrigger(
  token: string,
  workflowId: string,
  params: CreateTriggerParams,
): Promise<ApiResult<WorkflowTriggerResult>> {
  const body: Record<string, unknown> = {
    kind: params.kind,
    concurrencyPolicy: params.concurrencyPolicy,
    targetMode: params.targetMode,
    args: params.args ?? {},
  };
  if (params.enabled !== undefined) body.enabled = params.enabled;
  if (params.missedRunPolicy !== undefined) body.missedRunPolicy = params.missedRunPolicy;
  if (params.repoFullName !== undefined) body.repoFullName = params.repoFullName;
  if (params.schedule !== undefined) body.schedule = params.schedule;
  if (params.poll !== undefined) {
    body.poll = {
      url: params.poll.url,
      authHeader: params.poll.authHeader,
      authValue: params.poll.authValue,
      intervalSecs: params.poll.intervalSecs,
    };
  }
  return apiRequest<WorkflowTriggerResult>(`/v1/cloud/workflows/${workflowId}/triggers`, {
    method: "POST",
    token,
    body,
  });
}

export async function getTrigger(
  token: string,
  workflowId: string,
  triggerId: string,
): Promise<ApiResult<WorkflowTriggerResult>> {
  return apiRequest<WorkflowTriggerResult>(`/v1/cloud/workflows/${workflowId}/triggers/${triggerId}`, { token });
}

export async function updateTrigger(
  token: string,
  workflowId: string,
  triggerId: string,
  patch: Record<string, unknown>,
): Promise<ApiResult<WorkflowTriggerResult>> {
  return apiRequest<WorkflowTriggerResult>(`/v1/cloud/workflows/${workflowId}/triggers/${triggerId}`, {
    method: "PATCH",
    token,
    body: patch,
  });
}

export interface TriggerItemResult {
  itemId: string;
  runId: string | null;
  status: string;
  errorMessage: string | null;
  receivedAt: string;
}

export async function listTriggerItems(
  token: string,
  workflowId: string,
  triggerId: string,
): Promise<ApiResult<{ items: TriggerItemResult[] }>> {
  return apiRequest<{ items: TriggerItemResult[] }>(
    `/v1/cloud/workflows/${workflowId}/triggers/${triggerId}/items`,
    { token },
  );
}

// ── Poll setup (flow 1: workflow-from-poll) ──────────────────────────────────

export interface PollInspectResult {
  sampleItemId: string | null;
  sampleData: Record<string, unknown> | null;
  derivedInputs: Array<{ name: string; type: string; required: boolean }>;
  skippedFields: Array<{ name: string; reason: string }>;
}

export async function inspectPoll(
  token: string,
  params: { url: string; authHeader?: string; authValue?: string },
): Promise<ApiResult<PollInspectResult>> {
  return apiRequest<PollInspectResult>("/v1/cloud/workflows/poll/inspect", {
    method: "POST",
    token,
    body: { url: params.url, authHeader: params.authHeader, authValue: params.authValue },
  });
}

// ── Function invocations CRUD ─────────────────────────────────────────────────

export interface FunctionInvocationResult {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  endpointUrl: string;
  method: string;
  argsSchema: Record<string, unknown>;
  chatScopeEnabled: boolean;
  hasHeaders: boolean;
}

export async function createFunctionInvocation(
  token: string,
  params: {
    name: string;
    endpointUrl: string;
    method: string;
    argsSchema?: Record<string, unknown>;
    headers?: Record<string, string>;
    displayName?: string;
    description?: string;
  },
): Promise<ApiResult<FunctionInvocationResult>> {
  return apiRequest<FunctionInvocationResult>("/v1/cloud/integrations/functions", {
    method: "POST",
    token,
    body: {
      name: params.name,
      endpointUrl: params.endpointUrl,
      method: params.method,
      argsSchema: params.argsSchema ?? {},
      headers: params.headers,
      displayName: params.displayName,
      description: params.description,
    },
  });
}

export async function listFunctionInvocations(
  token: string,
): Promise<ApiResult<{ items: FunctionInvocationResult[] }>> {
  return apiRequest<{ items: FunctionInvocationResult[] }>("/v1/cloud/integrations/functions", { token });
}

export async function updateFunctionInvocation(
  token: string,
  name: string,
  patch: Record<string, unknown>,
): Promise<ApiResult<FunctionInvocationResult>> {
  return apiRequest<FunctionInvocationResult>(`/v1/cloud/integrations/functions/${name}`, {
    method: "PATCH",
    token,
    body: patch,
  });
}

export async function rotateFunctionInvocationHeaders(
  token: string,
  name: string,
  headers: Record<string, string> | null,
): Promise<ApiResult<FunctionInvocationResult>> {
  return apiRequest<FunctionInvocationResult>(`/v1/cloud/integrations/functions/${name}/headers`, {
    method: "POST",
    token,
    body: { headers },
  });
}

export async function setFunctionInvocationChatScope(
  token: string,
  name: string,
  enabled: boolean,
): Promise<ApiResult<FunctionInvocationResult>> {
  return apiRequest<FunctionInvocationResult>(`/v1/cloud/integrations/functions/${name}/chat-scope-enabled`, {
    method: "PATCH",
    token,
    body: { enabled },
  });
}

export async function archiveFunctionInvocation(token: string, name: string): Promise<ApiResult<unknown>> {
  return apiRequest(`/v1/cloud/integrations/functions/${name}`, { method: "DELETE", token });
}

// ── Admin integration default-access surface (T2-WF-4) ────────────────────────

export interface AdminDefinitionResult {
  definitionId: string;
  namespace: string;
  displayName: string;
  source: string;
  policyEnabled: boolean | null;
  effectiveEnabled: boolean;
  defaultChatIncluded: boolean;
}

export async function createAdminIntegrationDefinition(
  token: string,
  organizationId: string,
  params: { displayName: string; namespace: string; mcpUrl: string; authKind?: string },
): Promise<ApiResult<AdminDefinitionResult>> {
  return apiRequest<AdminDefinitionResult>(
    `/v1/cloud/integrations/admin/organizations/${organizationId}/definitions`,
    {
      method: "POST",
      token,
      body: {
        displayName: params.displayName,
        namespace: params.namespace,
        mcpUrl: params.mcpUrl,
        authKind: params.authKind ?? "none",
      },
    },
  );
}

export async function setAdminIntegrationDefaultChatScope(
  token: string,
  organizationId: string,
  definitionId: string,
  included: boolean,
): Promise<ApiResult<AdminDefinitionResult>> {
  return apiRequest<AdminDefinitionResult>(
    `/v1/cloud/integrations/admin/organizations/${organizationId}/definitions/${definitionId}/default-chat-scope`,
    { method: "PATCH", token, body: { included } },
  );
}

// ── Direct-DB: seed a materialized cloud workspace + repo environment ─────────
// The product's cloud repo-add / workspace-create paths are GitHub-App-gated and
// unreachable in tier-2 (cloud-workspace.spec.ts's NEEDS-GITHUB-FIXTURE wall);
// a workflow trigger's D16 derivation only READS the repo environment + reuses a
// warm workspace, so seeding those rows directly is the legitimate direct-DB
// exception. The workspace carries a non-null anyharness_workspace_id so a
// personal_cloud StartRun resolves it as "materialized" (the delivery target).

export interface SeededCloudRepo {
  repoConfigId: string;
  repoEnvironmentId: string;
  workspaceId: string;
  anyharnessWorkspaceId: string;
  repoFullName: string;
  gitOwner: string;
  gitRepoName: string;
}

export async function seedCloudRepoEnvironment(
  ownerUserId: string,
  gitOwner: string,
  gitRepoName: string,
): Promise<SeededCloudRepo> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    const repoConfig = await client.query<{ id: string }>(
      `INSERT INTO repo_config (id, user_id, git_provider, git_owner, git_repo_name, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'github', $2, $3, now(), now())
       RETURNING id`,
      [ownerUserId, gitOwner, gitRepoName],
    );
    const repoConfigId = repoConfig.rows[0].id;
    const repoEnv = await client.query<{ id: string }>(
      `INSERT INTO repo_environment
         (id, repo_config_id, environment_kind, default_branch, setup_script, run_command, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'cloud', 'main', '', '', now(), now())
       RETURNING id`,
      [repoConfigId],
    );
    const repoEnvironmentId = repoEnv.rows[0].id;
    const anyharnessWorkspaceId = `ah-ws-${gitRepoName}`;
    const workspace = await client.query<{ id: string }>(
      `INSERT INTO cloud_workspace
         (id, owner_user_id, repo_environment_id, display_name, git_branch, git_base_branch,
          anyharness_workspace_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'main', $5, now(), now())
       RETURNING id`,
      [ownerUserId, repoEnvironmentId, `${gitOwner}/${gitRepoName}`, `workflow/${gitRepoName}`, anyharnessWorkspaceId],
    );
    return {
      repoConfigId,
      repoEnvironmentId,
      workspaceId: workspace.rows[0].id,
      anyharnessWorkspaceId,
      repoFullName: `${gitOwner}/${gitRepoName}`,
      gitOwner,
      gitRepoName,
    };
  } finally {
    await client.end();
  }
}

// ── Direct-DB reads: poll seen-set + opaque cursor ────────────────────────────

/** The trigger's persisted opaque poll cursor (the product exposes no read API
 * for it — only last_poll_at/last_poll_error ride the trigger response). */
export async function readTriggerPollCursor(triggerId: string): Promise<string | null> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    const result = await client.query<{ poll_cursor: string | null }>(
      `SELECT poll_cursor FROM workflow_trigger WHERE id = $1`,
      [triggerId],
    );
    return result.rows[0]?.poll_cursor ?? null;
  } finally {
    await client.end();
  }
}

/**
 * Time-shift a poll trigger's `last_poll_at` back an hour so it is due again for
 * the next poller tick. This is the same accepted time-shift pattern as
 * `backdateInvitationExpiry` / tier-2's Stripe test clocks (move real state in
 * time; there is no clock object to drive the poll cadence) — it does NOT fake
 * the poll's RESULT: the tick it enables still does a REAL outbound GET to the
 * stub feed and a REAL seen-set dedup + cursor write. Used only to exercise the
 * replay-dedup contract without waiting out the 60s minimum poll interval.
 */
export async function makePollTriggerDue(triggerId: string): Promise<void> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    await client.query(
      `UPDATE workflow_trigger SET last_poll_at = now() - interval '1 hour' WHERE id = $1`,
      [triggerId],
    );
  } finally {
    await client.end();
  }
}

/** The resolved user id for an email (to scope direct-DB seeds to the owner). */
export async function readUserIdForEmail(email: string): Promise<string> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    const result = await client.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`No user row for email ${email}`);
    return id;
  } finally {
    await client.end();
  }
}

// ── Poller drive ──────────────────────────────────────────────────────────────

export interface PollerTickResult {
  spawned: number;
  ok: boolean;
  stderr: string;
}

/**
 * Run ONE real poll pass by invoking `run_workflow_poller_tick` in a one-off
 * server-venv process against the profile DB. This is the honest driving seam
 * (README: "invoke the poller's tick function"): the automations worker that
 * runs the loop is not booted by the tier-2 stack, and there is no HTTP endpoint
 * to trigger a single tick. The tick does the real outbound GET to the stub feed
 * and the real seen-set/cursor/run writes — it fakes nothing. DEBUG=true is set so
 * the SSRF guard (guard_poll_endpoint) is bypassed for the 127.0.0.1 stub, exactly
 * as the booted server runs it.
 */
export function runPollerTick(): PollerTickResult {
  const python = path.join(REPO_ROOT, "server", ".venv", "bin", "python");
  const script =
    "import asyncio, json, sys;" +
    "from proliferate.db import engine as e;" +
    "from proliferate.server.cloud.workflows.poller import run_workflow_poller_tick;" +
    "n = asyncio.run(run_workflow_poller_tick(session_factory=e.async_session_factory));" +
    'print(json.dumps({"spawned": n}))';
  const result = spawnSync(python, ["-c", script], {
    cwd: path.join(REPO_ROOT, "server"),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(),
      DEBUG: "true",
      SINGLE_ORG_MODE: "true",
      // The booted server has API_BASE_URL; this one-off process needs it too so
      // worker_cloud_base_url() is non-empty when start_run mints the per-run
      // gateway token (a personal_cloud poll run's plan carries the gateway block).
      API_BASE_URL: apiBaseUrl(),
    },
    encoding: "utf8",
  });
  let spawned = 0;
  const stdout = result.stdout ?? "";
  const match = stdout.match(/\{"spawned":\s*(\d+)\}/);
  if (match) spawned = Number(match[1]);
  return { spawned, ok: result.status === 0 && match !== null, stderr: (result.stderr ?? "") + stdout };
}

// ── Poll-feed stub control (over HTTP; the stub lives in the setup process) ────

export function invocationStubBaseUrl(): string {
  const value = process.env.TIER2_INTENT_INVOCATION_STUB_BASE_URL;
  if (!value) {
    throw new Error("TIER2_INTENT_INVOCATION_STUB_BASE_URL is not set — did globalSetup run?");
  }
  return value;
}

export function pollFeedUrl(): string {
  return `${invocationStubBaseUrl()}/poll-feed`;
}

/** Toggle the poll feed's 503 fail mode (the "endpoint down" case) without
 * killing the shared stub. */
export async function setPollFeedFailing(failing: boolean): Promise<void> {
  const response = await fetch(`${invocationStubBaseUrl()}/__poll-feed`, {
    method: failing ? "POST" : "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Could not toggle poll-feed fail mode (${response.status}).`);
  }
}
