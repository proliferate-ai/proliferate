/**
 * T2-SURFACE-SESSION — surface/session Tier-2 inventory (PR 8, workstream 2).
 *
 * Six manifest cases proved at the HTTP seam against the ONE booted Tier-2
 * stack (no billing, `requireStripe: false`): cloud workspace create-request
 * validation (T2-WS-1), repo-environment-kind Add-Repo validation boundaries
 * (T2-WS-2), the passive-read half of workspace/session projection (T2-WS-4),
 * the server-side session-mutation authz seam (T2-SESSION-1), admin-gated
 * settings routes (T2-SETTINGS-1), and the merged workflow definitions +
 * invocations API (T2-WF-1). Follows `t2-repo-policy.ts`/`t2-identity-org.ts`
 * exactly, including the local `withEmptyEvidence` wrapper (no billing/
 * Stripe/policy evidence applies to any of these six cases) and the
 * `UNREACHABLE AT THIS SEAM` comment discipline for clauses this stack
 * (no AnyHarness runtime, no E2B/GitHub App, no browser) cannot reach.
 *
 * This stack boots with `E2B_API_KEY`/`E2B_TEMPLATE_NAME` unset (the plain
 * `bootBillingStack`/`bootStack` default — see `tests/intent/stack/boot.ts`),
 * so `settings.cloud_provisioning_config_error` is `None` under `DEBUG=true`
 * and `require_cloud_provisioning_configured()` never fires; the reachable
 * cloud-workspace negatives are therefore the repo-environment-not-found 404
 * (`create_cloud_workspace_for_user`, server/proliferate/server/cloud/
 * workspaces/service.py:124-146) and the GitHub-authority 409/gating below it
 * — not the E2B-half-configured 503 `cloud-provisioning-gating.spec.ts` (a
 * dedicated ephemeral `DEBUG=false` boot) covers. Ported/extended rather than
 * re-litigated, per the task brief.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { makeTier2MatrixScenario } from "./harness.js";
import type { Tier2CaseResult, Tier2CellContext, Tier2CellHandler } from "./types.js";
import { adminContext } from "./fixtures.js";
import * as seed from "../../../../intent/stack/seed.ts";

export const T2_SURFACE_SESSION_ID = "T2-SURFACE-SESSION";

const PASSWORD = "Tier2SurfaceSession!Passw0rd";

// ── Shared workflow HTTP helpers (no seed.ts equivalent exists yet — this
// file's first consumer of the merged workflow definitions/invocations
// surface at the Tier-2 seam) ────────────────────────────────────────────

interface WorkflowDefinitionPayload {
  id: string;
  userId: string;
  title: string;
  description: string;
  schemaVersion: 1;
  revision: number;
  validatedCatalogVersion: string;
  defaultRepoConfigId: string | null;
  inputs: unknown[];
  stages: unknown[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function workflowPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "T2-WF-1 diagnose ticket",
    description: "Investigate one ticket and report the result.",
    defaultRepoConfigId: null,
    inputs: [{ name: "ticket", type: "string", required: true }],
    stages: [
      {
        harnessConfig: { agentKind: "claude", modelId: "sonnet", effort: "high" },
        steps: [{ kind: "agent.prompt", prompt: "Investigate {{inputs.ticket}}.", goal: null }],
      },
    ],
    ...overrides,
  };
}

async function createWorkflowDefinition(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: WorkflowDefinitionPayload }> {
  return seed.apiRequest<WorkflowDefinitionPayload>("/v1/workflows", {
    method: "POST",
    token,
    body: workflowPayload(overrides),
  });
}

async function getWorkflowDefinition(
  token: string,
  id: string,
): Promise<{ status: number; body: WorkflowDefinitionPayload }> {
  return seed.apiRequest<WorkflowDefinitionPayload>(`/v1/workflows/${id}`, { token });
}

async function updateWorkflowDefinition(
  token: string,
  id: string,
  overrides: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return seed.apiRequest(`/v1/workflows/${id}`, {
    method: "PUT",
    token,
    body: workflowPayload(overrides),
  });
}

async function deleteWorkflowDefinition(
  token: string,
  id: string,
  expectedRevision: number,
): Promise<{ status: number; body: unknown }> {
  return seed.apiRequest(`/v1/workflows/${id}?expectedRevision=${expectedRevision}`, {
    method: "DELETE",
    token,
  });
}

async function getWorkflowRunEligibility(
  token: string,
  id: string,
): Promise<{ status: number; body: { eligible: boolean; blockers: Array<{ code: string }> } }> {
  return seed.apiRequest(`/v1/workflows/${id}/run-eligibility`, { token });
}

async function putWorkflowInvocation(
  token: string,
  invocationId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return seed.apiRequest(`/v1/workflow-invocations/${invocationId}`, {
    method: "PUT",
    token,
    body,
  });
}

async function getWorkflowInvocation(
  token: string,
  invocationId: string,
): Promise<{ status: number; body: unknown }> {
  return seed.apiRequest(`/v1/workflow-invocations/${invocationId}`, { token });
}

function invocationBody(definitionId: string, ticket: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    workflowDefinitionId: definitionId,
    expectedRevision: 1,
    arguments: { ticket },
    target: { kind: "managedCloud" },
  };
}

// ── T2-WS-1: cloud workspace happy request reaches pending/materializing and
// the projected UI shell; missing repo configuration, billing block,
// duplicate request, and lost response create no duplicate workspace ──────
//
// Ports cloud-workspace.spec.ts's missing-repo-configuration 404 seam onto
// the runner and extends it: a LOCAL repo environment (reachable without a
// real GitHub App) still 409s the cloud-only gate before it ever reaches
// provisioning, and repeated identical requests against the SAME
// unconfigured repo never create a workspace row (the closest observable
// proxy for "duplicate request creates no duplicate workspace" this seam
// supports — see the UNREACHABLE note below for the idempotency-key half).
const t2WsHappyPathAndGuards: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token } = await adminContext();
  const runId = Date.now();

  // Missing repo configuration: no cloud repo environment at all for this
  // owner/repo — 404 cloud_repo_environment_not_found before any GitHub App
  // call, exactly cloud-workspace.spec.ts's documented seam.
  const noRepoOwner = `t2surfsess-norepo-owner-${runId}`;
  const noRepoName = `norepo-repo-${runId}`;
  const missingRepo = await seed.createCloudWorkspace(token, {
    gitOwner: noRepoOwner,
    gitRepoName: noRepoName,
    branchName: "feature/does-not-matter",
  });
  assert.equal(missingRepo.status, 404);
  const missingRepoDetail = (missingRepo.body as { detail?: { code?: string } }).detail;
  assert.equal(missingRepoDetail?.code, "cloud_repo_environment_not_found");

  // Duplicate request against the same unconfigured repo: repeating the
  // identical create twice never creates a workspace row either time (both
  // fail at the same 404 seam, before any workspace insert) — the observable
  // proxy for "no duplicate workspace" available without a configured repo
  // environment/provider.
  const secondAttempt = await seed.createCloudWorkspace(token, {
    gitOwner: noRepoOwner,
    gitRepoName: noRepoName,
    branchName: "feature/does-not-matter",
  });
  assert.equal(secondAttempt.status, 404, "repeating the same create request is equally rejected, not half-applied");
  const list = await seed.apiRequest<{ repositories: Array<{ gitOwner: string; gitRepoName: string }> }>(
    "/v1/cloud/repositories",
    { token },
  );
  assert.equal(list.status, 200);
  assert.equal(
    list.body.repositories.some((r) => r.gitOwner === noRepoOwner && r.gitRepoName === noRepoName),
    false,
    "a create attempt against a repo with no environment leaves no repo config row behind either",
  );

  // LOCAL repo environment configured (reachable without a real GitHub App)
  // but the create endpoint only ever looks up a CLOUD-kind environment
  // (repositories_store.get_cloud_repo_environment filters
  // RepoEnvironmentKind.cloud) — so a local-only configuration still 404s
  // cloud_repo_environment_not_found, proving the create path never silently
  // treats a local dev environment as cloud-provisionable.
  const localOwner = `t2surfsess-local-owner-${runId}`;
  const localRepoName = `local-repo-${runId}`;
  const localEnv = await seed.apiRequest(`/v1/cloud/repositories/${localOwner}/${localRepoName}/environment`, {
    method: "PUT",
    token,
    body: {
      kind: "local",
      desktopInstallId: `t2surfsess-install-${runId}`,
      localPath: "/home/dev/repo",
      defaultBranch: "main",
    },
  });
  assert.equal(localEnv.status, 200);
  const withOnlyLocalEnv = await seed.createCloudWorkspace(token, {
    gitOwner: localOwner,
    gitRepoName: localRepoName,
    branchName: `feature/t2ws1-${runId}`,
  });
  assert.equal(withOnlyLocalEnv.status, 404);
  const withOnlyLocalEnvDetail = (withOnlyLocalEnv.body as { detail?: { code?: string } }).detail;
  assert.equal(
    withOnlyLocalEnvDetail?.code,
    "cloud_repo_environment_not_found",
    "a local-kind environment is never mistaken for a cloud-provisionable one",
  );

  // Cloud-kind environment write itself 409s the GitHub-authority gate first
  // (no GitHub App connected) — the same seam T2-WS-3 (t2-repo-policy.ts)
  // documents; reproduced here because it is also this row's "missing
  // [GitHub] configuration" clause for the create path specifically: even if
  // a cloud environment COULD be saved, the create endpoint's own repo lookup
  // would then find it and proceed to require_github_cloud_repo_authority,
  // which 409s the same way.
  const cloudOwner = `t2surfsess-cloud-owner-${runId}`;
  const cloudRepoName = `cloud-repo-${runId}`;
  const cloudEnvAttempt = await seed.apiRequest(
    `/v1/cloud/repositories/${cloudOwner}/${cloudRepoName}/environment`,
    { method: "PUT", token, body: { kind: "cloud", defaultBranch: "main" } },
  );
  assert.equal(cloudEnvAttempt.status, 409);
  const cloudEnvDetail = (cloudEnvAttempt.body as { detail?: { code?: string } }).detail;
  assert.equal(cloudEnvDetail?.code, "github_app_authorization_required");

  // Cleanup the local repo config row so reruns start clean.
  await seed.apiRequest(`/v1/cloud/repositories/${localOwner}/${localRepoName}/environment`, {
    method: "DELETE",
    token,
  });

  // UNREACHABLE AT THIS SEAM:
  // - The happy path (200, workspace reaching pending/materializing, and the
  //   "projected UI shell" it feeds) — needs a real GitHub App installation
  //   PAST require_github_cloud_repo_authority, and a real E2B-provisioned
  //   sandbox/AnyHarness runtime past _load_ready_runtime_access. Both are
  //   NEEDS-GITHUB-FIXTURE/NEEDS-PROVIDER-FIXTURE dependencies this stack
  //   (no GitHub App, no E2B template, TIER2_INTENT_SKIP_RUNTIME) cannot
  //   supply. "The projected UI shell" itself is a browser-rendering concern,
  //   not observable at the HTTP seam at all.
  // - Billing block: this stack boots CLOUD_BILLING_MODE=off (the plain
  //   bootBillingStack/bootStack default), so
  //   assert_cloud_sandbox_resume_allowed_for_owner's enforce-mode gate is a
  //   guaranteed no-op — there is no way to observe the billing-block clause
  //   without a dedicated enforce-mode boot (T2-BILL owns that stack shape;
  //   re-booting a second full stack here is out of scope for this file).
  // - Lost response / true idempotency-key replay: the create endpoint
  //   accepts no idempotency key or client-supplied request id at all (no
  //   such field on CreateCloudWorkspaceRequest, no header read in
  //   create_cloud_workspace_endpoint) — a genuine "the client's PENDING
  //   request retried after a dropped response is recognized as the same
  //   request" contract does not exist as built. The repeated-request proxy
  //   above (same failure, no partial workspace row) is the strongest
  //   available substitute; a true replay-recognition claim would be a false
  //   positive.
  return { status: "green" };
};

// ── T2-WS-2: local, linked-local, worktree, and cloud Add-Repo branches
// validate inputs and native/web capability boundaries truthfully ─────────
//
// Server-seam half: drives the repository registration endpoint
// (PUT /v1/cloud/repositories/{owner}/{repo}/environment,
// server/proliferate/server/cloud/repositories/api.py) for the `local` and
// `cloud` RepoEnvironmentKind values with valid + invalid inputs. There is
// no separate "linked-local" or "worktree" RepoEnvironmentKind on main
// (RepoEnvironmentKind = local | cloud, server/proliferate/constants/
// cloud.py:76-78) — the manifest row's four named branches map onto this
// two-valued enum at the server seam; "linked-local" and "worktree" are
// desktop-side Add-Repo UI flows that both terminate in a `local`-kind PUT
// with different local_path provenance, indistinguishable from the server's
// perspective (both call sites send the same body shape).
const t2WsAddRepoValidation: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token } = await adminContext();
  const runId = Date.now();

  // Valid local: full body succeeds and round-trips (kind, all fields).
  const localOwner = `t2ws2-local-owner-${runId}`;
  const localRepo = `local-repo-${runId}`;
  const validLocal = await seed.apiRequest<{ kind: string; localPath: string }>(
    `/v1/cloud/repositories/${localOwner}/${localRepo}/environment`,
    {
      method: "PUT",
      token,
      body: {
        kind: "local",
        desktopInstallId: `t2ws2-install-${runId}`,
        localPath: "/Users/dev/repo",
        defaultBranch: "main",
      },
    },
  );
  assert.equal(validLocal.status, 200);
  assert.equal(validLocal.body.kind, "local");
  assert.equal(validLocal.body.localPath, "/Users/dev/repo");

  // Invalid local: missing local_path 400s local_path_required (the
  // reachable "validates inputs" negative for the local branch).
  const missingPath = await seed.apiRequest(
    `/v1/cloud/repositories/${localOwner}/${localRepo}-nopath/environment`,
    {
      method: "PUT",
      token,
      body: { kind: "local", desktopInstallId: `t2ws2-install-${runId}`, defaultBranch: "main" },
    },
  );
  assert.equal(missingPath.status, 400);
  const missingPathDetail = (missingPath.body as { detail?: { code?: string } }).detail;
  assert.equal(missingPathDetail?.code, "local_path_required");

  // Invalid local: missing desktop_install_id 400s desktop_install_id_required
  // — the desktop-identity half of the local/linked-local/worktree input
  // contract (every desktop-originated environment write carries the
  // installing desktop's id).
  const missingInstall = await seed.apiRequest(
    `/v1/cloud/repositories/${localOwner}/${localRepo}-noinstall/environment`,
    {
      method: "PUT",
      token,
      body: { kind: "local", localPath: "/Users/dev/repo", defaultBranch: "main" },
    },
  );
  assert.equal(missingInstall.status, 400);
  const missingInstallDetail = (missingInstall.body as { detail?: { code?: string } }).detail;
  assert.equal(missingInstallDetail?.code, "desktop_install_id_required");

  // Cloud Add-Repo branch: valid shape still 409s the GitHub-authority gate
  // (no GitHub App connected) — the "capability boundary" this seam can
  // truthfully assert for the cloud branch: it never silently accepts a
  // cloud-kind write without provider authority, whatever the input shape.
  const cloudOwner = `t2ws2-cloud-owner-${runId}`;
  const cloudRepo = `cloud-repo-${runId}`;
  const cloudAttempt = await seed.apiRequest(`/v1/cloud/repositories/${cloudOwner}/${cloudRepo}/environment`, {
    method: "PUT",
    token,
    body: { kind: "cloud", defaultBranch: "main" },
  });
  assert.equal(cloudAttempt.status, 409);
  const cloudDetail = (cloudAttempt.body as { detail?: { code?: string } }).detail;
  assert.equal(cloudDetail?.code, "github_app_authorization_required");

  // Malformed kind: an unrecognized environment kind 422s at the FastAPI/
  // Pydantic validation layer (RepoEnvironmentKind is a closed enum), never a
  // 5xx and never silently coerced to a valid kind.
  const badKind = await seed.apiRequest(`/v1/cloud/repositories/${cloudOwner}/${cloudRepo}-badkind/environment`, {
    method: "PUT",
    token,
    body: { kind: "worktree", defaultBranch: "main" },
  });
  assert.ok(badKind.status === 422, `an unsupported environment kind is rejected 422, got ${badKind.status}`);

  // Cleanup.
  await seed.apiRequest(`/v1/cloud/repositories/${localOwner}/${localRepo}/environment`, {
    method: "DELETE",
    token,
  });

  // UNREACHABLE AT THIS SEAM: "native/web capability boundary truthfulness"
  // — whether the Add-Repo UI on a given surface (desktop native vs. hosted
  // web) truthfully disables/hides a branch it cannot fulfill (e.g. local/
  // linked-local/worktree are desktop-only capabilities that a web session
  // has no filesystem to back) is a client-rendering decision with no
  // server-side capability-gate endpoint to drive; observable only in a
  // browser against the real desktop/web client code, not at this HTTP seam.
  // The cloud-kind happy path (a real GitHub App installation, branch
  // validated against real GitHub branches) is the same NEEDS-GITHUB-FIXTURE
  // gap T2-WS-1 and T2-WS-3 (t2-repo-policy.ts) already document.
  return { status: "green" };
};

// ── T2-WS-4: pending workspace/session projection hands off once to durable
// ids; passive reads never wake a paused sandbox; archived or superseded
// targets reject late results ──────────────────────────────────────────────
//
// Reachable server-seam parts only: this stack has no E2B/provider and no
// AnyHarness runtime, so there is no sandbox to wake and no runtime session
// to hand off to — nothing here can go from "pending" to a durable runtime
// id. What IS reachable and worth proving: reading a workspace/its runtime
// status is a pure read (never mutates, never triggers wake-adjacent side
// effects) regardless of how many times it is called, and a workspace that
// does not exist for this caller is denied the same way on every read (no
// "first read creates/discovers it" surprise).
const t2WsProjectionPassiveRead: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token } = await adminContext();
  const runId = Date.now();

  // A workspace id that was never created for this caller: repeated GETs
  // (list, detail, runtime-status) all 404 identically and idempotently —
  // no "wakes something into existence" side effect from merely reading.
  const phantomId = randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const detail = await seed.apiRequest(`/v1/cloud/workspaces/${phantomId}`, { token });
    assert.equal(detail.status, 404, `repeated passive detail reads of a nonexistent workspace stay 404 (attempt ${attempt})`);
    const status = await seed.apiRequest(`/v1/cloud/workspaces/${phantomId}/runtime-status`, { token });
    assert.equal(status.status, 404, `repeated passive runtime-status reads stay 404 (attempt ${attempt})`);
  }

  // The active-workspace list is itself a pure read: calling it repeatedly
  // never grows the count on its own (no side effect from listing), and it
  // never 5xxs even with zero cloud sandbox/provider configured.
  const before = await seed.apiRequest<{ length?: number } & unknown[]>("/v1/cloud/workspaces", { token });
  assert.equal(before.status, 200);
  const beforeCount = Array.isArray(before.body) ? before.body.length : 0;
  const again = await seed.apiRequest<unknown[]>("/v1/cloud/workspaces", { token });
  assert.equal(again.status, 200);
  const againCount = Array.isArray(again.body) ? again.body.length : 0;
  assert.equal(againCount, beforeCount, "listing workspaces twice in a row never itself creates or mutates a row");

  // A cross-account read of a real but foreign workspace resource is denied
  // the same way as a phantom id (no leak of "exists but is someone else's"
  // vs. "does not exist" through a different status code) — this stack has
  // no way to materialize a REAL workspace row without a provider, so the
  // strongest available proxy is that the SAME phantom-id probe above is
  // denial-shaped (404), not an information leak (never a 403 that would
  // imply existence, and never a 5xx).
  return { status: "green" };

  // UNREACHABLE AT THIS SEAM (needs a real materialized workspace + a real
  // AnyHarness runtime session, both NEEDS-PROVIDER-FIXTURE at this stack):
  // - "Hands off once to durable ids": the pending -> anyharness_workspace_id
  //   transition itself, and proving it happens exactly once (not re-issued
  //   on a retried create or a repeated read).
  // - "Passive reads never wake a paused sandbox": proving a GET against a
  //   real PAUSED sandbox does not trigger ensure_cloud_sandbox_ready/wake —
  //   there is no sandbox to pause without a real E2B-backed one, and the
  //   read endpoints this stack DOES expose (list/detail/runtime-status) call
  //   only load_personal_cloud_sandbox (a pure DB read), never
  //   ensure_cloud_sandbox_ready/wake_cloud_sandbox — verified by inspection
  //   of get_cloud_workspace_runtime_status
  //   (server/proliferate/server/cloud/workspaces/service.py:388-401), which
  //   is the strongest claim this seam can support without a live sandbox to
  //   observe not waking.
  // - "Archived or superseded targets reject late results": rejecting a late
  //   runtime callback/result against an archived/superseded workspace is a
  //   runtime->server callback path with no client-facing HTTP surface to
  //   drive directly; it requires the AnyHarness runtime itself to be live.
};

// ── T2-SESSION-1: create, prompt, queued-prompt edit/delete, config update,
// cancel, dismiss/restore, close, fork, title, goal, loop, and
// workflow-held mutation boundaries reach the correct runtime seam and
// preserve idempotency keys ─────────────────────────────────────────────────
//
// The tier-2 stack skips the AnyHarness runtime (TIER2_INTENT_SKIP_RUNTIME),
// and every session-lifecycle operation this row names (create, prompt,
// queued-prompt edit/delete, config update, cancel, dismiss/restore, close,
// fork, title) is implemented as a runtime call
// (proliferate.integrations.anyharness.sessions: create_runtime_session,
// prompt_runtime_session, close_runtime_session, apply_runtime_reasoning_
// effort) with NO server-owned session row/table and no server HTTP route of
// its own — the product's session surface is the gateway HTTP/WS proxy
// (POST/GET/WS .../cloud-sandbox/anyharness/{path}, server/proliferate/
// server/cloud/gateway/api.py) straight through to the runtime's own
// /v1/sessions/* routes. So there is no server-side session-mutation authz
// seam separate from the gateway's own access gate — proving THIS seam means
// proving the gateway access gate itself denies/allows correctly before any
// runtime call is even attempted.
const t2SessionMutationAuthzBoundary: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token } = await adminContext();
  const runId = Date.now();

  // Unauthenticated: the gateway HTTP proxy requires current_product_user —
  // no token at all is denied before any runtime dial is attempted, for any
  // path/method shape a session mutation would use (POST create, POST
  // prompt-shaped path, DELETE close-shaped path).
  const unauthedCreate = await seed.apiRequest(`/v1/gateway/cloud-sandbox/anyharness/v1/sessions`, {
    method: "POST",
    body: { workspaceId: randomUUID(), agentKind: "claude" },
  });
  assert.ok(
    [401, 403].includes(unauthedCreate.status),
    `an unauthenticated session-create attempt through the gateway must deny, got ${unauthedCreate.status}`,
  );

  const fakeSessionId = randomUUID();
  const unauthedPrompt = await seed.apiRequest(
    `/v1/gateway/cloud-sandbox/anyharness/v1/sessions/${fakeSessionId}/prompt`,
    { method: "POST", body: { text: "hello" } },
  );
  assert.ok(
    [401, 403].includes(unauthedPrompt.status),
    `an unauthenticated prompt attempt through the gateway must deny, got ${unauthedPrompt.status}`,
  );

  const unauthedClose = await seed.apiRequest(
    `/v1/gateway/cloud-sandbox/anyharness/v1/sessions/${fakeSessionId}/close`,
    { method: "POST" },
  );
  assert.ok(
    [401, 403].includes(unauthedClose.status),
    `an unauthenticated close attempt through the gateway must deny, got ${unauthedClose.status}`,
  );

  // Authenticated but against a workspace this caller does not own: the
  // gateway access gate resolves the CALLER's own personal cloud sandbox
  // (ensure_cloud_sandbox_gateway_access -> ensure_cloud_sandbox_ready(db,
  // user) — never a path parameter naming someone else's sandbox), so there
  // is no cross-account "foreign workspace id" shape to attempt against this
  // route; a member with no cloud sandbox of their own reaches the SAME
  // provisioning-not-configured/creating-state seam every fresh caller does,
  // never a 5xx and never routed to another account's runtime.
  const email = `t2session1-member-${runId}@example.com`;
  const { organizationId } = await adminContext();
  const memberToken = await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");
  const memberAttempt = await seed.apiRequest(`/v1/gateway/cloud-sandbox/anyharness/v1/sessions`, {
    method: "POST",
    token: memberToken,
    body: { workspaceId: randomUUID(), agentKind: "claude" },
  });
  assert.ok(memberAttempt.status < 500, `an authenticated member's own gateway attempt must never 5xx, got ${memberAttempt.status}`);
  assert.notEqual(
    memberAttempt.status,
    401,
    "an authenticated caller with no cloud sandbox yet must not be denied with an auth-shaped 401",
  );

  return { status: "green" };

  // UNREACHABLE AT THIS SEAM (needs a live AnyHarness runtime,
  // TIER2_INTENT_SKIP_RUNTIME at this stack):
  // - create/prompt/config-update/cancel/dismiss-restore/close/fork/title/
  //   goal/loop/workflow-held mutation semantics themselves — all runtime
  //   operations proxied straight through to the runtime's own /v1/sessions/*
  //   surface once the gateway access gate passes; there is no server-side
  //   business logic for any of them to assert independently of the runtime
  //   actually running.
  // - Idempotency-key preservation across a retried prompt/create — the
  //   gateway proxy forwards the request body/headers verbatim
  //   (proxy_http_to_anyharness), so whatever idempotency contract exists is
  //   entirely inside the runtime's own session handling, unreachable without
  //   a live runtime process to observe it against.
};

// ── T2-SETTINGS-1: member-hidden/direct admin routes and server mutations
// deny consistently; owner/admin routes work ───────────────────────────────
//
// Server-seam half only: drives two independent admin-gated route families
// (organization profile PATCH — already asserted in t2-identity-org.ts's
// T2-ORG-2 for one representative pair — extended here with the org
// usage/budget-limits admin routes, a family T2-ORG-2 does not cover) across
// owner/admin/member/outsider actors, plus GitHub App / SSO admin listing
// routes as a third and fourth family, all gated by the same
// `current_path_org_admin` dependency.
const t2SettingsAdminBoundaries: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token: ownerToken, organizationId } = await adminContext();
  const runId = Date.now();

  const memberEmail = `t2settings1-member-${runId}@example.com`;
  const memberToken = await seed.registerFreshMember(ownerToken, organizationId, memberEmail, PASSWORD, "member");

  const adminEmail = `t2settings1-admin-${runId}@example.com`;
  const adminToken = await seed.registerFreshMember(ownerToken, organizationId, adminEmail, PASSWORD, "member");
  const members = await seed.listMembers(ownerToken, organizationId);
  const adminMembership = members.find((m) => m.email === adminEmail)!;
  await seed.updateMembership(ownerToken, organizationId, adminMembership.membershipId, { role: "admin" });

  type Actor = { name: string; token: string | undefined };
  const actors: Actor[] = [
    { name: "owner", token: ownerToken },
    { name: "admin", token: adminToken },
    { name: "member", token: memberToken },
    { name: "outsider", token: undefined },
  ];

  for (const actor of actors) {
    const isAdmin = actor.name === "owner" || actor.name === "admin";

    // Org usage/budget-limits admin family: GET/PUT both current_path_org_admin.
    const limitsRead = await seed.apiRequest(`/v1/organizations/${organizationId}/limits`, { token: actor.token });
    assertDenyOrAllow(limitsRead.status, isAdmin, `org budget limits read (${actor.name})`);
    const limitsWrite = await seed.apiRequest(`/v1/organizations/${organizationId}/limits`, {
      method: "PUT",
      token: actor.token,
      body: { limits: [] },
    });
    assertDenyOrAllow(limitsWrite.status, isAdmin, `org budget limits write (${actor.name})`);

    const usageByUser = await seed.apiRequest(`/v1/organizations/${organizationId}/usage/by-user`, {
      token: actor.token,
    });
    assertDenyOrAllow(usageByUser.status, isAdmin, `org usage-by-user read (${actor.name})`);

    // GitHub App organization admin route (installation-start URL
    // generation) — same current_path_org_admin gate, a distinct route
    // family from usage/limits. Note: the sibling GET .../installation
    // (status) is current_path_org_member (member-readable by design), so
    // this deliberately probes the admin-only .../installation/start
    // variant instead.
    const githubAppInstallStart = await seed.apiRequest(
      `/v1/cloud/organizations/${organizationId}/github-app/installation/start`,
      { token: actor.token },
    );
    assertDenyOrAllow(githubAppInstallStart.status, isAdmin, `github app installation start (${actor.name})`);

    // SSO connections admin listing — same gate, a fourth independent family.
    const ssoConnections = await seed.apiRequest(`/v1/organizations/${organizationId}/sso/connections`, {
      token: actor.token,
    });
    assertDenyOrAllow(ssoConnections.status, isAdmin, `org sso connections list (${actor.name})`);
  }

  return { status: "green" };

  // UNREACHABLE AT THIS SEAM: section order, renamed-route redirects, focus
  // deep links, Web filtering, Integrations/Workflows/Plugins placement,
  // status vocabulary, and telemetry section ids are all client-rendered
  // settings-UI structure with no server endpoint describing them — a
  // browser/desktop-client concern, not observable over HTTP.
};

function assertDenyOrAllow(status: number, shouldAllow: boolean, label: string): void {
  assert.ok(status < 500, `${label}: must never 5xx, got ${status}`);
  if (shouldAllow) {
    assert.ok(status >= 200 && status < 300, `${label}: expected allow (2xx), got ${status}`);
  } else {
    assert.ok([401, 403, 404].includes(status), `${label}: expected deny (401/403/404), got ${status}`);
  }
}

// ── T2-WF-1: UI definition creation/edit, immutable versions, live reference
// validation, input coercion/interpolation, manual launch, and local/cloud
// delivery intent ────────────────────────────────────────────────────────────
//
// Server-seam: full CRUD + revision-conflict + owner-isolation + catalog
// validation over the merged personal workflow definitions API
// (server/proliferate/server/workflows/api.py), mirroring server/tests/
// integration/test_workflow_definitions_api.py's own observed contract, plus
// the invocation snapshot/replay/conflict round-trip
// (test_workflow_invocations_api.py) and the run-eligibility endpoint (the
// reachable half of "manual launch" — the run engine itself is not merged).
const t2WorkflowDefinitionsAndInvocations: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token: ownerToken } = await adminContext();
  const runId = Date.now();
  const otherEmail = `t2wf1-other-${runId}@example.com`;
  const { organizationId } = await adminContext();
  const otherToken = await seed.registerFreshMember(ownerToken, organizationId, otherEmail, PASSWORD, "member");

  // Create + immutable-version CRUD: create starts at revision 1; PUT bumps
  // it; a stale PUT (expectedRevision behind current) 409s
  // workflow_definition_revision_conflict rather than silently overwriting —
  // this IS the "immutable versions" contract as built (append-only
  // revision counter, optimistic-concurrency guarded, not a version history
  // list).
  const created = await createWorkflowDefinition(ownerToken);
  assert.equal(created.status, 201);
  assert.equal(created.body.revision, 1);
  const definitionId = created.body.id;

  const updated = await updateWorkflowDefinition(ownerToken, definitionId, {
    title: "T2-WF-1 diagnose ticket (edited)",
    expectedRevision: 1,
  });
  assert.equal(updated.status, 200);
  const updatedBody = updated.body as { revision: number; title: string };
  assert.equal(updatedBody.revision, 2, "an edit bumps the revision counter");
  assert.equal(updatedBody.title, "T2-WF-1 diagnose ticket (edited)");

  const staleEdit = await updateWorkflowDefinition(ownerToken, definitionId, {
    title: "Should not land",
    expectedRevision: 1,
  });
  assert.equal(staleEdit.status, 409, "a stale expectedRevision is rejected, never silently overwritten");
  const staleDetail = (staleEdit.body as { detail?: { code?: string } }).detail;
  assert.equal(staleDetail?.code, "workflow_definition_revision_conflict");

  // Owner isolation: another account cannot read, edit, or delete this
  // definition — 404, not 403 (never confirming existence to a non-owner).
  const foreignRead = await getWorkflowDefinition(otherToken, definitionId);
  assert.equal(foreignRead.status, 404);
  const foreignEdit = await updateWorkflowDefinition(otherToken, definitionId, { expectedRevision: 2 });
  assert.equal(foreignEdit.status, 404);
  const foreignDelete = await deleteWorkflowDefinition(otherToken, definitionId, 2);
  assert.equal(foreignDelete.status, 404);

  // Live reference validation: an unknown agent/model/effort is rejected 400
  // invalid_workflow_definition / workflow_catalog_selection_unavailable at
  // create time — proving definitions are validated live against the
  // current agent catalog, not accepted blind.
  const badHarness = await createWorkflowDefinition(ownerToken, {
    stages: [
      {
        harnessConfig: { agentKind: "not-a-real-agent-kind", modelId: null, effort: null },
        steps: [{ kind: "agent.prompt", prompt: "Investigate.", goal: null }],
      },
    ],
  });
  assert.equal(badHarness.status, 400);
  const badHarnessDetail = (badHarness.body as { detail?: { code?: string; path?: string } }).detail;
  assert.equal(badHarnessDetail?.code, "workflow_catalog_selection_unavailable");
  assert.equal(badHarnessDetail?.path, "stages.0.harnessConfig.agentKind");

  // Input coercion/interpolation: {{inputs.ticket}} in a step prompt is
  // stored verbatim on the definition (interpolation happens at invocation
  // time, proved next) — round-tripping through create confirms the
  // template placeholder survives validation unmangled.
  const loaded = await getWorkflowDefinition(ownerToken, definitionId);
  assert.equal(loaded.status, 200);
  const stages = loaded.body.stages as Array<{ steps: Array<{ prompt: string }> }>;
  assert.equal(stages[0].steps[0].prompt, "Investigate {{inputs.ticket}}.");

  // Manual launch (reachable half): run-eligibility reports eligible with no
  // blockers for a definition using only catalog-valid selections and no
  // default repo — the pre-flight check a manual "launch" action reads
  // before ever creating an invocation.
  const eligibility = await getWorkflowRunEligibility(ownerToken, definitionId);
  assert.equal(eligibility.status, 200);
  assert.deepEqual(eligibility.body, { eligible: true, blockers: [] });

  // Invocation freeze + snapshot/replay/conflict (the input-coercion ->
  // interpolation contract's other half: arguments are frozen into a
  // portable snapshot at invocation time, not re-resolved against a later-
  // edited definition) + delivery intent: target.kind: "managedCloud" is the
  // only delivery-intent shape the wire model accepts (ManagedCloudWorkflow
  // Target is the sole discriminated variant) — proving the cloud delivery
  // intent is captured on the frozen invocation.
  const invocationId = randomUUID();
  const request = invocationBody(definitionId, "PROL-1");
  request.expectedRevision = 2; // current revision after the edit above.
  const frozen = await putWorkflowInvocation(ownerToken, invocationId, request);
  assert.equal(frozen.status, 201);
  const frozenBody = frozen.body as { target: { kind: string }; definitionRevision: number };
  assert.equal(frozenBody.target.kind, "managedCloud", "the frozen invocation carries the cloud delivery intent");
  assert.equal(frozenBody.definitionRevision, 2);

  // Replay with the identical body is idempotent (200, same snapshot); a
  // mismatched replay (different arguments, same id) 409s rather than
  // silently mutating the frozen snapshot.
  const replay = await putWorkflowInvocation(ownerToken, invocationId, request);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, frozenBody);
  const mismatch = { ...request, arguments: { ticket: "OTHER" } };
  const conflict = await putWorkflowInvocation(ownerToken, invocationId, mismatch);
  assert.equal(conflict.status, 409);
  const conflictDetail = (conflict.body as { detail?: { code?: string } }).detail;
  assert.equal(conflictDetail?.code, "workflow_invocation_conflict");

  const fetchedInvocation = await getWorkflowInvocation(ownerToken, invocationId);
  assert.equal(fetchedInvocation.status, 200);
  assert.deepEqual(fetchedInvocation.body, frozenBody);

  // Owner isolation on invocations too: a foreign account cannot read it.
  const foreignInvocationRead = await getWorkflowInvocation(otherToken, invocationId);
  assert.equal(foreignInvocationRead.status, 404);

  // Cleanup: delete the definition at its current revision.
  await deleteWorkflowDefinition(ownerToken, definitionId, 2);

  return { status: "green" };

  // UNREACHABLE AT THIS SEAM:
  // - UI definition creation/edit as a UI flow (the form, live validation
  //   feedback while typing, immutable-version history browsing) — a
  //   client-rendering concern; only the API contract it drives is asserted
  //   here.
  // - Actually LAUNCHING/running the eligible invocation: the workflow run
  //   engine is not merged (no /run or /launch endpoint exists past
  //   run-eligibility on main — get_workflow_run_eligibility_endpoint is the
  //   full extent of the launch-adjacent surface today); eligibility is the
  //   reachable pre-flight half, launch itself is a known gap, not silently
  //   skipped.
  // - Local delivery intent: ManagedCloudWorkflowTarget is the only
  //   WorkflowInvocationCreateRequest.target variant on main — there is no
  //   "local" delivery-intent shape to submit and observe; the wire model's
  //   closed discriminated union IS the proof that no such intent exists yet,
  //   not a gap in this file's coverage.
};

function withEmptyEvidence(handler: Tier2CellHandler): Tier2CellHandler {
  return async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
    const result = await handler(ctx);
    if (result.status === "green") {
      // No billing ledger/Stripe/policy surface applies to any of these six
      // cases; the evidence carries the case id with empty/zero fields so the
      // green-requires-evidence gate holds uniformly, same as T2-IDENTITY-ORG
      // and T2-REPO-POLICY.
      ctx.policy.record({});
    }
    return result;
  };
}

const cases: Record<string, Tier2CellHandler> = {
  "T2-WS-1": withEmptyEvidence(t2WsHappyPathAndGuards),
  "T2-WS-2": withEmptyEvidence(t2WsAddRepoValidation),
  "T2-WS-4": withEmptyEvidence(t2WsProjectionPassiveRead),
  "T2-SESSION-1": withEmptyEvidence(t2SessionMutationAuthzBoundary),
  "T2-SETTINGS-1": withEmptyEvidence(t2SettingsAdminBoundaries),
  "T2-WF-1": withEmptyEvidence(t2WorkflowDefinitionsAndInvocations),
};

export const t2SurfaceSession = makeTier2MatrixScenario({
  id: T2_SURFACE_SESSION_ID,
  title: "Tier-2 surface/session inventory: cloud workspace create guards, Add-Repo validation, passive projection reads, session-gateway authz, settings admin boundaries, workflow definitions/invocations",
  registryFlowRef: "specs/developing/testing/core-release-validation.md#t2-surface-session",
  requiredEnv: [],
  requireStripe: false,
  cases,
});
