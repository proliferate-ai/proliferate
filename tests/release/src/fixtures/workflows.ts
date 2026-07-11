/**
 * Shared workflow fixtures + helpers for the T3-WF live lane
 * (specs/developing/testing/scenarios.md, "Tier 3 — workflows").
 *
 * The version-pinned fixture DEFINITIONS live under
 * `tests/release/fixtures/workflows/*.json` (test data, same rule as the golden
 * contract fixtures: when the definition format changes, updating these is part
 * of the format change). This module loads one and drives the real server
 * workflow API (`/v1/cloud/workflows*`) — create, StartRun, run detail (which
 * returns the run row AND its step-action ledger), triggers, and trigger items.
 * Assertions read those product surfaces + the run gateway-token DB seam
 * (`scripts/workflow_probe.py`), never transcript text.
 *
 * No auth is reimplemented here: scenarios log in via `../fixtures/identity.ts`
 * exactly like T3-INT-1 and hand this module an authed `ApiClient`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { ApiClient, ApiRequestError } from "./http.js";
import { loginDurableUser } from "./identity.js";

/** Prefix-relative base for the cloud workflows router (mounted at {prefix}/v1/cloud/workflows). */
const WORKFLOWS_BASE = "/v1/cloud/workflows";

export interface WorkflowDefinition {
  version: number;
  name?: string;
  description?: string;
  inputs?: Array<Record<string, unknown>>;
  integrations?: string[];
  agents: Array<Record<string, unknown>>;
}

export interface WorkflowResponse {
  id: string;
  name: string;
  currentVersionId: string | null;
  isSeed: boolean;
}

export interface WorkflowDetailResponse {
  workflow: WorkflowResponse;
  currentVersion: { id: string; versionN: number; definition: WorkflowDefinition } | null;
  versions: Array<{ id: string; versionN: number }>;
}

export interface StepActionResponse {
  stepKey: string;
  actionKind: string;
  status: string;
  resultJson: Record<string, unknown> | null;
  errorMessage: string | null;
  attemptCount: number;
}

export interface WorkflowRunResponse {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  triggerKind: string;
  triggerId: string | null;
  scheduledFor: string | null;
  args: Record<string, unknown>;
  targetMode: string;
  resolvedPlan: Record<string, unknown>;
  status: string;
  stepCursor: number | null;
  stepOutputs: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  deliveredAt: string | null;
}

export interface WorkflowRunDetailResponse {
  run: WorkflowRunResponse;
  stepActions: StepActionResponse[];
}

export interface WorkflowTriggerResponse {
  id: string;
  workflowId: string;
  kind: string;
  enabled: boolean;
  concurrencyPolicy: string;
  missedRunPolicy: string;
  targetMode: string;
  repoFullName: string | null;
  targetWorkspaceId: string | null;
  nextRunAt: string | null;
  lastScheduledAt: string | null;
  poll: { url: string; hasAuth: boolean; intervalSecs: number; itemSchema: Record<string, unknown> | null } | null;
}

export interface WorkflowTriggerItemResponse {
  itemId: string;
  runId: string | null;
  status: string;
  errorMessage: string | null;
  receivedAt: string;
}

/** The terminal (finished) run statuses per the run status machine. */
export const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

/** Load a version-pinned fixture definition by base name (no extension). */
export async function readWorkflowFixture(name: string): Promise<WorkflowDefinition> {
  const fixturePath = path.resolve(import.meta.dirname, "../../fixtures/workflows", `${name}.json`);
  const raw = await readFile(fixturePath, "utf8");
  return JSON.parse(raw) as WorkflowDefinition;
}

/**
 * Create a workflow from a fixture definition. Names are suffixed with a random
 * token so re-runs against a durable server never collide. Returns the detail
 * payload (workflow id + current version id).
 */
export async function createWorkflow(
  client: ApiClient,
  definition: WorkflowDefinition,
  options: { nameSuffix?: string } = {},
): Promise<WorkflowDetailResponse> {
  const suffix = options.nameSuffix ?? Math.random().toString(36).slice(2, 8);
  const name = `${definition.name ?? "wf"} [e2e ${suffix}]`;
  return client.post<WorkflowDetailResponse>(WORKFLOWS_BASE, {
    name,
    description: definition.description ?? null,
    definition,
  });
}

export async function archiveWorkflow(client: ApiClient, workflowId: string): Promise<void> {
  await client.delete(`${WORKFLOWS_BASE}/${workflowId}`).catch(() => undefined);
}

export interface StartRunOptions {
  inputs?: Record<string, unknown>;
  targetMode: "local" | "personal_cloud";
  workspaceId?: string;
  triggerId?: string;
  versionId?: string;
  sessionBindings?: Record<string, string>;
}

export async function startRun(
  client: ApiClient,
  workflowId: string,
  options: StartRunOptions,
): Promise<WorkflowRunResponse> {
  const target =
    options.triggerId != null ? { triggerId: options.triggerId } : { workspaceId: options.workspaceId };
  return client.post<WorkflowRunResponse>(`${WORKFLOWS_BASE}/${workflowId}/runs`, {
    inputs: options.inputs ?? {},
    targetMode: options.targetMode,
    versionId: options.versionId,
    target,
    sessionBindings: options.sessionBindings ?? {},
  });
}

export async function getRunDetail(client: ApiClient, runId: string): Promise<WorkflowRunDetailResponse> {
  return client.get<WorkflowRunDetailResponse>(`${WORKFLOWS_BASE}/runs/${runId}`);
}

export async function listRuns(
  client: ApiClient,
  workflowId: string,
): Promise<{ runs: WorkflowRunResponse[] }> {
  return client.get<{ runs: WorkflowRunResponse[] }>(`${WORKFLOWS_BASE}/${workflowId}/runs`);
}

/** Poll a run until `predicate(run)` holds or the timeout elapses. Returns the last run seen. */
export async function pollRun(
  client: ApiClient,
  runId: string,
  predicate: (run: WorkflowRunResponse) => boolean,
  options: { timeoutMs: number; pollMs?: number } = { timeoutMs: 300_000 },
): Promise<WorkflowRunDetailResponse> {
  const pollMs = options.pollMs ?? 4000;
  const deadline = Date.now() + options.timeoutMs;
  let last = await getRunDetail(client, runId);
  while (!predicate(last.run) && Date.now() < deadline) {
    await sleep(pollMs);
    last = await getRunDetail(client, runId);
  }
  return last;
}

export async function pollRunTerminal(
  client: ApiClient,
  runId: string,
  options: { timeoutMs: number; pollMs?: number } = { timeoutMs: 300_000 },
): Promise<WorkflowRunDetailResponse> {
  return pollRun(client, runId, (run) => TERMINAL_RUN_STATUSES.has(run.status), options);
}

export interface CreateTriggerOptions {
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
  client: ApiClient,
  workflowId: string,
  options: CreateTriggerOptions,
): Promise<WorkflowTriggerResponse> {
  return client.post<WorkflowTriggerResponse>(`${WORKFLOWS_BASE}/${workflowId}/triggers`, {
    kind: options.kind,
    enabled: options.enabled ?? true,
    concurrencyPolicy: options.concurrencyPolicy,
    missedRunPolicy: options.missedRunPolicy ?? "run_latest",
    targetMode: options.targetMode,
    repoFullName: options.repoFullName ?? null,
    schedule: options.schedule ?? null,
    poll: options.poll ?? null,
    args: options.args ?? {},
  });
}

export async function getTrigger(
  client: ApiClient,
  workflowId: string,
  triggerId: string,
): Promise<WorkflowTriggerResponse> {
  return client.get<WorkflowTriggerResponse>(`${WORKFLOWS_BASE}/${workflowId}/triggers/${triggerId}`);
}

export async function listTriggerItems(
  client: ApiClient,
  workflowId: string,
  triggerId: string,
): Promise<{ items: WorkflowTriggerItemResponse[] }> {
  return client.get<{ items: WorkflowTriggerItemResponse[] }>(
    `${WORKFLOWS_BASE}/${workflowId}/triggers/${triggerId}/items`,
  );
}

/** Flow-1 /init inference: probe a poll endpoint's reserved /init path. */
export async function inspectPoll(
  client: ApiClient,
  body: { url: string; authHeader?: string; authValue?: string },
): Promise<{
  sampleItemId: string | null;
  sampleData: Record<string, unknown> | null;
  derivedInputs: Array<{ name: string; type: string; required: boolean }>;
  skippedFields: Array<{ name: string; reason: string }>;
}> {
  return client.post(`${WORKFLOWS_BASE}/poll/inspect`, {
    url: body.url,
    authHeader: body.authHeader ?? null,
    authValue: body.authValue ?? null,
  });
}

export function isApiError(error: unknown, ...codes: string[]): error is ApiRequestError {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  if (codes.length === 0) {
    return true;
  }
  const body = error.body as { code?: unknown; detail?: { code?: unknown } } | null;
  const code = typeof body?.code === "string" ? body.code : undefined;
  const detailCode =
    body && typeof body.detail === "object" && body.detail && typeof body.detail.code === "string"
      ? body.detail.code
      : undefined;
  return codes.includes(code ?? "") || codes.includes(detailCode ?? "");
}

/** The frozen per-run gateway token scope_json, via the DB seam (no HTTP surface). */
export interface RunGatewayScopeProbe {
  runId: string;
  tokenStatus: string | null;
  scopeJson: Record<string, { integrations?: string[] }> | null;
  grantedNamespaces: string[];
  error?: string;
}

export async function runGatewayScopeProbe(
  runId: string,
  databaseUrl: string,
): Promise<RunGatewayScopeProbe> {
  const scriptPath = path.resolve(import.meta.dirname, "../../scripts/workflow_probe.py");
  const serverDir = path.resolve(import.meta.dirname, "../../../../server");
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", scriptPath, "run-gateway-scope", runId], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`workflow_probe.py exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop() ?? "{}"));
      } catch (error) {
        reject(new Error(`workflow_probe.py did not print valid JSON: ${stdout}\n${error}`));
      }
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log in the durable e2e user and return an authed client. Reads the durable
 * identity from the environment (seeded per-run on the local lane by
 * cli/run.ts, a repo secret on staging). Auth is the same password login
 * T3-INT-1 uses — never reimplemented here.
 */
export async function openDurableWorkflowClient(serverUrl: string): Promise<ApiClient> {
  const session = await loginDurableUser({
    serverUrl,
    email: process.env.RELEASE_E2E_DURABLE_USER_EMAIL as string,
    password: process.env.RELEASE_E2E_DURABLE_USER_PASSWORD as string,
    organizationId: process.env.RELEASE_E2E_DURABLE_ORG_ID ?? "",
  });
  return new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);
}
