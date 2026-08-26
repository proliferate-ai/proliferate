// T2-WF-1 (specs/engineering/testing/scenarios.md): the two-plane workflow trigger seam.
// Real Desktop web UI, real server, and real Postgres, exactly like this
// suite's sibling specs; the AnyHarness runtime process itself is never
// started here (TIER2_INTENT_SKIP_RUNTIME=1 in CI), so this spec proves the
// control-plane half of the courier — exactly one
// PUT /v1/workflow-invocations/{id} carrying the frozen snapshot — and then
// proves the UI survives the runtime-plane PUT failing, without asserting
// anything about a runtime this suite deliberately never boots.
//
// The runtime plane shapes the dialog before that PUT, too: the repository
// picker lists RUNTIME repo roots (GET /v1/repo-roots), not cloud repo
// configs — placement.repoConfigId is a runtime repo-root id end to end. And
// the picker's query is gated one seam earlier than the list itself: the app
// only hands the runtime URL to the query context once the harness
// connection store turns healthy (ProductProviderRoot readyRuntimeUrl), which
// requires GET /health to answer (runtime-bootstrap.ts pollUntilHealthy,
// every 500ms). So this spec controls ALL THREE runtime seams explicitly
// rather than relying on the runtime's ambient absence: it fulfills /health
// (otherwise the store never turns healthy and the repo-roots query never
// fires at all), fulfills the repo-roots list with a fixture root (otherwise
// the picker stays empty and Start run stays disabled), and aborts the
// workflow-runs PUT.
//
// This file supersedes workflow-runs.spec.ts (T2-WF-1's old collector),
// which drove gen-1's fully server-managed "Run in Cloud" model (queued /
// cancel / delivery_status over a durable admission queue) — a different
// architecture from gen-2's local trigger courier
// (lib/workflows/trigger/trigger-courier.ts): PUT /v1/workflow-invocations/{id}
// freezes a definition snapshot, then PUT /v1/workflow-runs/{run_id} against
// the *local* AnyHarness runtime materializes the workspace. Tier-2
// intentionally stops at that second seam; gen-1's cancel/history assertions
// have no gen-2 equivalent to port; they simply do not apply to a run that
// never gets past the runtime PUT.
//
// Flag: workflows_v2 (lib/domain/capabilities/workflows-v2.ts) defaults to
// `false` today and flips to `true` in this ladder's final rung, its own
// isolated commit later in this same PR. Same as workflow-definitions.spec.ts,
// this file asserts the flag-ON UI without depending on that rung: the boot
// harness serves the desktop web with `VITE_WORKFLOWS_V2=1`
// (stack/global-setup.ts's `extraDesktopEnv`), which forces the gate on
// whatever the compiled-in default is.

import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  anyharnessBaseUrl,
  apiBaseUrl,
  apiRequest,
  ensureInstanceClaimed,
  passwordLogin,
  webBaseUrl,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

const RUN_ID = Date.now();
const TITLE = `T2 workflow trigger ${RUN_ID}`;
const INPUT_NAME = "ticket";
const INPUT_VALUE = `PROL-${RUN_ID}`;
const REPO_OWNER = "t2-wf-trigger";
const REPO_NAME = `trigger-seam-${RUN_ID}`;

// What the trigger dialog renders when the run-stage PUT fails at the network
// level: workflow-trigger-failure.ts classifies a run-stage TypeError (what
// fetch throws when nothing answers) as the runtime being unreachable, so the
// person is told to reconnect rather than handed a generic sentence.
const RUNTIME_DISCONNECTED_COPY =
  "The local runtime is not connected. Reconnect it, then start this run again.";

let workflowId: string;
let repoConfigId: string;
let ownerToken: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await convergedAdminLogin()).access_token;
  repoConfigId = await seedRepositoryThroughProductApi();

  const created = await apiRequest<{ id: string; schemaVersion: number }>("/v1/workflows", {
    method: "POST",
    token: ownerToken,
    body: {
      title: TITLE,
      description: "Trigger seam acceptance coverage.",
      defaultRepoConfigId: null,
      definition: {
        schemaVersion: 2,
        nodes: [{
          id: "step-1",
          type: "agent",
          title: "Investigate",
          prompt: `Investigate @input:${INPUT_NAME}.`,
        }],
        edges: [],
        inputs: [{ name: INPUT_NAME, description: "Ticket id to investigate.", required: true }],
        docTemplates: [],
      },
    },
  });
  expect(created.status).toBe(201);
  expect(created.body.schemaVersion).toBe(2);
  workflowId = created.body.id;
  await awaitWorkflowReadable(workflowId);
});

test("fires exactly one invocation PUT and survives a failed runtime placement", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  // First runtime seam — the connection gate. Bootstrap starts polling
  // GET /health the moment the authenticated shell mounts, so this route
  // must exist before sign-in. The body is a complete HealthResponse
  // (anyharness/sdk types/runtime.ts): confirmRuntimeReady only cares that
  // the call succeeds, but other shell surfaces read health fields, and a
  // shape lie here could crash them and trip this spec's pageErrors gate.
  await page.route(
    (url) => url.href.startsWith(anyharnessBaseUrl()) && url.pathname === "/health",
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        version: "0.0.0-t2-intent-fixture",
        runtimeHome: `/tmp/t2-wf-trigger-runtime-${RUN_ID}`,
        executionStoreId: `t2-wf-trigger-store-${RUN_ID}`,
        capabilities: { replay: false },
        agentReconcile: {
          alreadyInstalled: 0,
          failed: 0,
          installed: 0,
          skipped: 0,
          status: "completed",
          currentAgent: null,
        },
        agentSeed: {
          lastAction: "none",
          ownership: "not_configured",
          source: "none",
          repairedArtifactCount: 0,
          seedOwnedArtifactCount: 0,
          skippedExistingArtifactCount: 0,
          seededAgents: [],
          seedVersion: null,
          failureKind: null,
        },
        resourcePressure: null,
      }),
    }),
  );

  await signInThroughUi(page);
  await page.goto(`${webBaseUrl()}/workflows`);
  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();

  // The dialog's repository picker queries the runtime's repo-root list the
  // moment it opens; with no runtime in this suite that list would be empty
  // and Start run would stay disabled. Fulfill the exact list route (child
  // routes untouched) with one fixture root. It reuses the seeded
  // repository's id so the spec stays agnostic about whether the control
  // plane cross-checks the id, while still proving the picker's selected
  // value is exactly what the courier sends as placement.repoConfigId.
  const rootSeededAt = new Date().toISOString();
  await page.route(
    (url) => url.href.startsWith(anyharnessBaseUrl()) && url.pathname === "/v1/repo-roots",
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: repoConfigId,
        kind: "external",
        path: `/work/${REPO_OWNER}/${REPO_NAME}`,
        displayName: REPO_NAME,
        defaultBranch: "main",
        createdAt: rootSeededAt,
        updatedAt: rootSeededAt,
      }]),
    }),
  );

  const row = page.getByRole("button").filter({ hasText: TITLE });
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: `Run ${TITLE}`, exact: true }).click();

  // The trigger dialog's title is the definition's own title (ModalShell ->
  // Radix DialogTitle -> h2), not a fixed "Run workflow" caption.
  await expect(page.getByRole("heading", { name: TITLE, exact: true, level: 2 })).toBeVisible();

  await page.locator(`#workflow-trigger-input-${INPUT_NAME}`).fill(INPUT_VALUE);

  // Choose placement explicitly rather than leaving the segmented control's
  // default ("New worktree") untouched — otherwise the placement the courier
  // sends could pass this assertion even if the chosen value were never
  // wired through at all.
  await page.getByRole("radio", { name: "Repo root", exact: true }).click();

  await expect(page.locator(`#workflow-trigger-repository option[value="${repoConfigId}"]`)).toHaveCount(1);
  await page.locator("#workflow-trigger-repository").selectOption(repoConfigId);

  let invocationPutCount = 0;
  let invocationBody: unknown = null;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/v1/workflow-invocations/")) {
      invocationPutCount += 1;
      invocationBody = request.postDataJSON();
    }
  });

  // The runtime plane is never started in this suite
  // (TIER2_INTENT_SKIP_RUNTIME=1); force its PUT to fail deterministically
  // rather than rely on that ambient absence — a stray local process
  // answering on the same port would otherwise make this flaky on a dev
  // machine. An aborted request surfaces as fetch's TypeError, which the
  // trigger failure classifier (workflow-trigger-failure.ts) maps on the run
  // stage to the runtime-disconnected sentence — the same rendering an
  // actually-unreachable runtime gets, without this spec depending on
  // @anyharness/sdk's error-parsing internals.
  await page.route(
    (url) => url.href.startsWith(`${anyharnessBaseUrl()}/v1/workflow-runs/`),
    (route) => route.abort(),
  );

  const invocationResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "PUT"
      && response.url().includes("/v1/workflow-invocations/")
  );
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  const invocationResponse = await invocationResponsePromise;
  // A fresh invocation id places the run: 201 Created. 200 is the idempotent
  // replay of an already-placed id (server workflows/api.py returns
  // 201-if-created else 200), and this spec's RUN_ID is unique per run.
  expect(invocationResponse.status()).toBe(201);

  const invocation = await invocationResponse.json() as {
    schemaVersion: number;
    workflowDefinitionId: string;
    arguments: Record<string, string>;
    placement: { repoConfigId: string; mode: string };
  };
  expect(invocation.schemaVersion).toBe(2);
  expect(invocation.workflowDefinitionId).toBe(workflowId);
  expect(invocation.arguments).toEqual({ [INPUT_NAME]: INPUT_VALUE });
  expect(invocation.placement).toEqual({ repoConfigId, mode: "repo_root" });
  expect(invocationBody).toMatchObject({
    schemaVersion: 2,
    workflowDefinitionId: workflowId,
    arguments: { [INPUT_NAME]: INPUT_VALUE },
    placement: { repoConfigId, mode: "repo_root" },
  });

  // The seam: the flow stops here. The control plane succeeded and unlocked
  // the runtime PUT, which this route forces to fail — the dialog must
  // surface that failure rather than crash, hang, or silently navigate away
  // as if the run had launched.
  await expect(page.getByText(RUNTIME_DISCONNECTED_COPY, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: TITLE, exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows`);

  expect(invocationPutCount).toBe(1);
  expect(pageErrors).toEqual([]);
});

// ── helpers ──

const CONVERGENCE_TIMEOUT_MS = 15_000;
const CONVERGENCE_POLL_MS = 250;
const CONVERGENCE_PROBE_TIMEOUT_MS = 5_000;

/** Bounded API convergence, ported unchanged from this suite's
 * workflow-definitions.spec.ts (itself ported unchanged from this file's
 * gen-1 predecessor) — the convergence hazard is a server property common to
 * every spec in this suite, not something gen-2-specific. */
async function pollUntil(
  description: string | (() => string),
  probe: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + CONVERGENCE_TIMEOUT_MS;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const probeBudget = Math.min(CONVERGENCE_PROBE_TIMEOUT_MS, deadline - Date.now());
    let timer: NodeJS.Timeout | undefined;
    const timeoutSentinel = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), probeBudget);
    });
    try {
      const outcome = await Promise.race([
        probe().catch(() => false),
        timeoutSentinel,
      ]);
      if (outcome === true) {
        return;
      }
    } finally {
      clearTimeout(timer);
    }
    if (Date.now() + CONVERGENCE_POLL_MS >= deadline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, CONVERGENCE_POLL_MS));
  }
  const rendered = typeof description === "function" ? description() : description;
  throw new Error(
    `Timed out after ${CONVERGENCE_TIMEOUT_MS}ms (${attempts} probes) waiting for: ${rendered}`,
  );
}

/** Converge the admin login without lockout risk: a clean first-run claim
 * commits its transaction after the /setup response, so the admin account
 * may briefly be invisible to other requests. Retrying the credentialed
 * login POST would trip the auth throttle (5 failures per email/IP locks the
 * actor out for 15 minutes), so instead poll the read-only GET /setup signal
 * — it flips to 404 only once the committed claim is visible — then POST the
 * login exactly once. Ported from this file's gen-1 predecessor, minus its
 * injectable `deps` (that copy's own dedicated lockout-safety unit test is
 * this suite's shared invariant, not a gen-2-specific one — not re-derived
 * here to avoid asserting the same contract twice from two spec files). */
async function convergedAdminLogin(): Promise<{ access_token: string }> {
  let lastStatus = "never probed";
  await pollUntil(
    () => `GET /setup to report the committed claim as 404 (last seen: ${lastStatus})`,
    async () => {
      const status = (await fetch(`${apiBaseUrl()}/setup`)).status;
      lastStatus = `status ${status}`;
      return status === 404;
    },
  );
  return passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * Seed a repository configuration through the real product API — the same
 * PUT /v1/cloud/repositories/{owner}/{repo}/environment surface the desktop
 * app drives, ported from this suite's workflow-definitions.spec.ts gen-1
 * predecessor. The gen-2 builder itself has no repository picker, but the
 * trigger dialog's placement step still needs at least one existing
 * repository configuration to select — a distinct concern from the
 * definition's own (always-null) `defaultRepoConfigId`.
 */
async function seedRepositoryThroughProductApi(): Promise<string> {
  // Saving a local environment requires the desktop install to be enrolled to
  // the caller (403 desktop_install_not_owned otherwise), so enroll it through
  // the same worker-enrollment surface the desktop app drives.
  const installId = `t2-wf-trigger-install-${RUN_ID}`;
  const enrollment = await apiRequest<{ enrollmentToken?: string }>(
    "/v1/cloud/workers/desktop/enrollment",
    { method: "POST", token: ownerToken, body: { desktopInstallId: installId } },
  );
  if (enrollment.status !== 200 || !enrollment.body.enrollmentToken) {
    throw new Error(`Desktop enrollment ticket failed (${enrollment.status}): ${JSON.stringify(enrollment.body)}`);
  }
  const enrolled = await apiRequest("/v1/cloud/worker/enroll", {
    method: "POST",
    body: { enrollmentToken: enrollment.body.enrollmentToken },
  });
  if (enrolled.status !== 200) {
    throw new Error(`Worker enrollment failed (${enrolled.status}): ${JSON.stringify(enrolled.body)}`);
  }
  const saved = await apiRequest<{ repoConfigId?: string }>(
    `/v1/cloud/repositories/${REPO_OWNER}/${REPO_NAME}/environment`,
    {
      method: "PUT",
      token: ownerToken,
      body: {
        kind: "local",
        desktopInstallId: installId,
        localPath: `/tmp/t2-wf-trigger-${RUN_ID}`,
      },
    },
  );
  if (saved.status !== 200 || !saved.body.repoConfigId) {
    throw new Error(`Repository seed failed (${saved.status}): ${JSON.stringify(saved.body)}`);
  }
  const seededId = saved.body.repoConfigId;
  let lastList = "never listed";
  await pollUntil(
    () => `repository ${REPO_OWNER}/${REPO_NAME} (${seededId}) visible in /v1/cloud/repositories (last seen: ${lastList})`,
    async () => {
      const list = await apiRequest<{ repositories: Array<{ id: string }> }>(
        "/v1/cloud/repositories",
        { token: ownerToken },
      );
      lastList = `status ${list.status}, ${list.body?.repositories?.length ?? 0} repositories`;
      return list.status === 200
        && list.body.repositories.some((candidate) => candidate.id === seededId);
    },
  );
  return seededId;
}

async function awaitWorkflowReadable(definitionId: string): Promise<void> {
  let lastStatus = "never probed";
  await pollUntil(
    () => `workflow ${definitionId} durably readable (last seen: ${lastStatus})`,
    async () => {
      const result = await apiRequest(`/v1/workflows/${definitionId}`, { token: ownerToken });
      lastStatus = `status ${result.status}`;
      return result.status === 200;
    },
  );
}

async function signInThroughUi(page: Page): Promise<void> {
  await page.goto(webBaseUrl());
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
}
