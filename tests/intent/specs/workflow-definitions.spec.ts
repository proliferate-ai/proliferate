// T2-WFDEF-1 (specs/developing/testing/scenarios.md): workflow definition
// authoring lifecycle. This is the PR1 seam: real Desktop web UI, real server,
// and real Postgres, with AnyHarness deliberately skipped because definitions
// do not execute yet.
//
// The scenario proves the full acceptance surface: a repository seeded through
// the real product API and selected in the editor, multiple uniquely
// identifiable ordered inputs/stages/steps, and exact ordered-array assertions
// after create, hard reload, list reopen, authenticated GET, and revision 2.

import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiBaseUrl,
  apiRequest,
  ensureInstanceClaimed,
  passwordLogin,
  webBaseUrl,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

const RUN_ID = Date.now();
const ORIGINAL_TITLE = `T2 workflow ${RUN_ID}`;
const UPDATED_TITLE = `${ORIGINAL_TITLE} revised`;
const ORIGINAL_DESCRIPTION = "Definition lifecycle acceptance coverage.";
const UPDATED_DESCRIPTION = "Definition lifecycle acceptance coverage, revised.";
const REPO_OWNER = "t2-wfdef";
const REPO_NAME = `lifecycle-${RUN_ID}`;

// Each prompt embeds a unique ordinal marker so ordering assertions cannot
// pass vacuously — a swapped stage or step changes the exact arrays below.
const STAGE1_PROMPT1 = "s1p1: investigate {{inputs.ticket}} at severity {{inputs.severity}}.";
const STAGE1_PROMPT2 = "s1p2: summarize the evidence for {{inputs.ticket}}.";
const STAGE2_PROMPT1 = "s2p1: draft the fix plan for {{inputs.ticket}}.";
const UPDATED_STAGE1_PROMPT2 = "s1p2v2: summarize and rank the evidence for {{inputs.ticket}}.";
const GOAL = "Produce an evidence-backed diagnosis.";

interface ComparableStage {
  harnessConfig: { agentKind: string; modelId: string | null; effort: string | null };
  steps: Array<{ kind: "agent.prompt"; prompt: string; goal: { objective: string } | null }>;
}

const ORIGINAL_INPUTS = [
  { name: "ticket", type: "string" as const, required: true },
  { name: "severity", type: "number" as const, required: false },
];

const ORIGINAL_STAGES: ComparableStage[] = [
  {
    harnessConfig: { agentKind: "claude", modelId: "sonnet", effort: "high" },
    steps: [
      { kind: "agent.prompt" as const, prompt: STAGE1_PROMPT1, goal: { objective: GOAL } },
      { kind: "agent.prompt" as const, prompt: STAGE1_PROMPT2, goal: null },
    ],
  },
  {
    harnessConfig: { agentKind: "claude", modelId: null, effort: null },
    steps: [
      { kind: "agent.prompt" as const, prompt: STAGE2_PROMPT1, goal: null },
    ],
  },
];

const UPDATED_STAGES: ComparableStage[] = [
  {
    ...ORIGINAL_STAGES[0]!,
    steps: [
      ORIGINAL_STAGES[0]!.steps[0]!,
      { kind: "agent.prompt", prompt: UPDATED_STAGE1_PROMPT2, goal: null },
    ],
  },
  ORIGINAL_STAGES[1]!,
];

let repoConfigId: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  repoConfigId = await seedRepositoryThroughProductApi();
});

test("creates, reloads, reopens, edits, and deletes a durable definition", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto(`${webBaseUrl()}/workflows`);

  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "New workflow", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "New workflow", exact: true, level: 1 })).toBeVisible();

  await page.getByLabel("Title").fill(ORIGINAL_TITLE);
  await page.getByLabel("Description").fill(ORIGINAL_DESCRIPTION);

  // The API-seeded repository must be offered and selected through the UI.
  await expect(page.getByLabel("Default repository")).toHaveValue("");
  await page.getByLabel("Default repository").selectOption(repoConfigId);

  // Two uniquely identifiable ordered inputs.
  await page.getByRole("button", { name: "Add input", exact: true }).click();
  await page.locator("#workflow-input-0-name").fill("ticket");
  await expect(page.locator("#workflow-input-0-type")).toHaveValue("string");
  await expect(page.locator("#workflow-input-0-required")).toBeChecked();
  await page.getByRole("button", { name: "Add input", exact: true }).click();
  await page.locator("#workflow-input-1-name").fill("severity");
  await page.locator("#workflow-input-1-type").selectOption("number");
  await page.locator("#workflow-input-1-required").click();
  await expect(page.locator("#workflow-input-1-required")).not.toBeChecked();

  // Stage 1: explicit model/effort, two ordered prompts, goal only on the first.
  await page.locator("#workflow-stage-0-harness").selectOption("claude");
  await page.locator("#workflow-stage-0-model").selectOption("sonnet");
  await page.locator("#workflow-stage-0-effort").selectOption("high");
  await page.locator("#workflow-stage-0-step-0-prompt").fill(STAGE1_PROMPT1);
  await page.getByRole("button", { name: "Add goal", exact: true }).first().click();
  await page.locator("#workflow-stage-0-step-0-goal").fill(GOAL);
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  await page.locator("#workflow-stage-0-step-1-prompt").fill(STAGE1_PROMPT2);

  // Stage 2: runtime-default model, one prompt.
  await page.getByRole("button", { name: "Add stage", exact: true }).click();
  await page.locator("#workflow-stage-1-harness").selectOption("claude");
  await expect(page.locator("#workflow-stage-1-model")).toHaveValue("");
  await page.locator("#workflow-stage-1-step-0-prompt").fill(STAGE2_PROMPT1);

  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && response.url() === `${apiBaseUrl()}/v1/workflows`
  );
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json() as WorkflowDefinitionResponse;
  expect(created.revision).toBe(1);
  expect(created.defaultRepoConfigId).toBe(repoConfigId);
  expect(created.inputs).toEqual(ORIGINAL_INPUTS);
  expect(normalizedStages(created.stages)).toEqual(ORIGINAL_STAGES);

  const workflowId = created.id;
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows/${workflowId}`);

  // The create transaction commits after the response; converge on revision 1
  // being durably readable before reload/list assertions depend on it.
  await awaitWorkflowRevision(page, workflowId, 1);

  // A hard browser reload forces a fresh authenticated GET from the server;
  // this proves the editor is reopening durable Postgres state rather than a
  // mutation-cache projection.
  await page.reload();
  await expectEditorState(page, {
    title: ORIGINAL_TITLE,
    description: ORIGINAL_DESCRIPTION,
    stage1Prompt2: STAGE1_PROMPT2,
  });

  // Return to the list and reopen through the product surface as well. This
  // covers list discovery/navigation independently of the durable route
  // reload above.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows`);
  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();
  await page.getByRole("button").filter({ hasText: ORIGINAL_TITLE }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows/${workflowId}`);
  await expectEditorState(page, {
    title: ORIGINAL_TITLE,
    description: ORIGINAL_DESCRIPTION,
    stage1Prompt2: STAGE1_PROMPT2,
  });

  const persisted = await authenticatedWorkflowGet(page, workflowId);
  expect(persisted.status).toBe(200);
  expect(persisted.body.revision).toBe(1);
  expect(persisted.body.title).toBe(ORIGINAL_TITLE);
  expect(persisted.body.defaultRepoConfigId).toBe(repoConfigId);
  expect(persisted.body.inputs).toEqual(ORIGINAL_INPUTS);
  expect(normalizedStages(persisted.body.stages)).toEqual(ORIGINAL_STAGES);

  await page.getByLabel("Title").fill(UPDATED_TITLE);
  await page.getByLabel("Description").fill(UPDATED_DESCRIPTION);
  await page.locator("#workflow-stage-0-step-1-prompt").fill(UPDATED_STAGE1_PROMPT2);

  const updateResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "PUT"
      && response.url() === `${apiBaseUrl()}/v1/workflows/${workflowId}`
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const updateResponse = await updateResponsePromise;
  expect(updateResponse.status()).toBe(200);
  const updated = await updateResponse.json() as WorkflowDefinitionResponse;
  expect(updated.revision).toBe(2);
  expect(updated.title).toBe(UPDATED_TITLE);
  expect(updated.defaultRepoConfigId).toBe(repoConfigId);
  expect(updated.inputs).toEqual(ORIGINAL_INPUTS);
  expect(normalizedStages(updated.stages)).toEqual(UPDATED_STAGES);

  // Converge on revision 2 before the hard reload depends on it.
  await awaitWorkflowRevision(page, workflowId, 2);

  await page.reload();
  await expectEditorState(page, {
    title: UPDATED_TITLE,
    description: UPDATED_DESCRIPTION,
    stage1Prompt2: UPDATED_STAGE1_PROMPT2,
  });

  const revisionTwo = await authenticatedWorkflowGet(page, workflowId);
  expect(revisionTwo.status).toBe(200);
  expect(revisionTwo.body.revision).toBe(2);
  expect(revisionTwo.body.defaultRepoConfigId).toBe(repoConfigId);
  expect(revisionTwo.body.inputs).toEqual(ORIGINAL_INPUTS);
  expect(normalizedStages(revisionTwo.body.stages)).toEqual(UPDATED_STAGES);

  await page.getByRole("button", { name: "Delete workflow", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delete workflow?", exact: true })).toBeVisible();
  const deleteResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "DELETE"
      && response.url().startsWith(`${apiBaseUrl()}/v1/workflows/${workflowId}`)
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(204);

  // Converge on the deletion being durably visible (404 + list absence)
  // before asserting the dependent UI state.
  await awaitWorkflowDeleted(page, workflowId);

  await expect(page).toHaveURL(`${webBaseUrl()}/workflows`);
  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText(UPDATED_TITLE, { exact: true })).toHaveCount(0);
});

// Lockout-safety contract of convergedAdminLogin, exercised with injected
// probes so delayed post-/setup commit visibility is deterministic: the
// credentialed POST happens exactly once, only after the read-only /setup
// probe reports the committed claim — never as a retried login that would
// trip the 5-failures-per-15-minutes auth throttle.
test("delayed claim visibility yields exactly one login POST", async () => {
  const setupStatuses = [200, 200, 404];
  let loginCalls = 0;
  const tokens = await convergedAdminLogin({
    probeSetupStatus: async () => setupStatuses.shift() ?? 404,
    login: async () => {
      loginCalls += 1;
      return { access_token: `token-${loginCalls}` };
    },
  });
  expect(setupStatuses).toHaveLength(0);
  expect(loginCalls).toBe(1);
  expect(tokens.access_token).toBe("token-1");
});

/**
 * Seed a repository configuration through the real product API — the same
 * PUT /v1/cloud/repositories/{owner}/{repo}/environment surface the desktop
 * app drives. The PUT response body carries the created repoConfigId
 * directly; the request-scoped DB transaction commits in dependency teardown
 * AFTER the response is sent, so visibility to other requests is then polled
 * (bounded) before the UI relies on the repository being listable. No raw
 * SQL, no GitHub dependency (a local-kind environment needs neither).
 */
async function seedRepositoryThroughProductApi(): Promise<string> {
  const tokens = await convergedAdminLogin();
  const saved = await apiRequest<{ repoConfigId?: string }>(
    `/v1/cloud/repositories/${REPO_OWNER}/${REPO_NAME}/environment`,
    {
      method: "PUT",
      token: tokens.access_token,
      body: {
        kind: "local",
        desktopInstallId: `t2-wfdef-install-${RUN_ID}`,
        localPath: `/tmp/t2-wfdef-${RUN_ID}`,
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
      const list = await apiRequest<{
        repositories: Array<{ id: string }>;
      }>("/v1/cloud/repositories", { token: tokens.access_token });
      lastList = `status ${list.status}, ${list.body?.repositories?.length ?? 0} repositories`;
      return list.status === 200
        && list.body.repositories.some((candidate) => candidate.id === seededId);
    },
  );
  return seededId;
}

const CONVERGENCE_TIMEOUT_MS = 15_000;
const CONVERGENCE_POLL_MS = 250;
const CONVERGENCE_PROBE_TIMEOUT_MS = 5_000;

/** Bounded API convergence: the server commits request transactions in
 * dependency teardown after responding, so a follow-up request may briefly
 * see the prior state. Poll with a short interval up to a hard overall
 * deadline; each probe is additionally raced against the smaller of the
 * per-probe cap and the remaining deadline, so one hung request cannot
 * exceed the bound. Probes MUST be read-only/idempotent: the race abandons
 * (does not cancel) an in-flight probe where the underlying API offers no
 * cancellation seam — the shared `apiRequest` helper takes no AbortSignal,
 * and threading one through is a suite-wide change this spec deliberately
 * avoids — so an abandoned probe may still complete server-side and overlap
 * the next attempt. Never route a mutating request (login POSTs especially:
 * auth throttles 5 failures per email/IP for 15 minutes) through this. The
 * `description` is evaluated at failure time so it can carry the last
 * observed state. */
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
 * login POST would trip the auth throttle (5 failures per email/IP locks
 * the actor out for 15 minutes), so instead poll the read-only GET /setup
 * signal — it flips to 404 only once the committed claim is visible, and
 * the account commits in the same transaction — then POST the login
 * exactly once. A real credential failure surfaces immediately instead of
 * being retried into a lockout. `deps` exists for the focused delayed-
 * visibility test below; production callers use the defaults. */
async function convergedAdminLogin(deps?: {
  probeSetupStatus?: () => Promise<number>;
  login?: () => Promise<{ access_token: string }>;
}): Promise<{ access_token: string }> {
  const probeSetupStatus = deps?.probeSetupStatus
    ?? (async () => (await fetch(`${apiBaseUrl()}/setup`)).status);
  const login = deps?.login ?? (() => passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD));

  let lastStatus = "never probed";
  await pollUntil(
    () => `GET /setup to report the committed claim as 404 (last seen: ${lastStatus})`,
    async () => {
      const status = await probeSetupStatus();
      lastStatus = `status ${status}`;
      return status === 404;
    },
  );
  return login();
}

/** Wait for the definition to be readable at the expected revision through
 * the authenticated API before dependent UI/API assertions run. */
async function awaitWorkflowRevision(
  page: Page,
  workflowId: string,
  expectedRevision: number,
): Promise<void> {
  let last: { status: number; revision?: number } = { status: -1 };
  await pollUntil(
    () => `workflow ${workflowId} at revision ${expectedRevision} (last seen: ${JSON.stringify(last)})`,
    async () => {
      const result = await authenticatedWorkflowGet(page, workflowId);
      last = { status: result.status, revision: result.body?.revision };
      return result.status === 200 && result.body.revision === expectedRevision;
    },
  );
}

/** Wait for the deletion to be durably visible: detail 404 and gone from the
 * authenticated list. */
async function awaitWorkflowDeleted(page: Page, workflowId: string): Promise<void> {
  let lastSeen = "never probed";
  await pollUntil(
    () => `workflow ${workflowId} deleted (detail 404 + absent from list; last seen: ${lastSeen})`,
    async () => {
      const detail = await authenticatedWorkflowGet(page, workflowId);
      if (detail.status !== 404) {
        lastSeen = `detail status ${detail.status}`;
        return false;
      }
      const token = await pageAccessToken(page);
      const response = await page.request.get(`${apiBaseUrl()}/v1/workflows`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json() as { workflows: Array<{ id: string }> };
      lastSeen = `detail 404, list status ${response.status()} with ${body.workflows?.length ?? 0} workflows`;
      return response.status() === 200
        && !body.workflows.some((candidate) => candidate.id === workflowId);
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

/** Assert the full editor state: repo selection plus every ordered input,
 * stage, and step control, so reload/reopen cannot pass on a subset. */
async function expectEditorState(
  page: Page,
  expected: { title: string; description: string; stage1Prompt2: string },
): Promise<void> {
  await expect(page.getByLabel("Title")).toHaveValue(expected.title);
  await expect(page.getByLabel("Description")).toHaveValue(expected.description);
  await expect(page.getByLabel("Default repository")).toHaveValue(repoConfigId);

  await expect(page.locator("#workflow-input-0-name")).toHaveValue("ticket");
  await expect(page.locator("#workflow-input-0-type")).toHaveValue("string");
  await expect(page.locator("#workflow-input-0-required")).toBeChecked();
  await expect(page.locator("#workflow-input-1-name")).toHaveValue("severity");
  await expect(page.locator("#workflow-input-1-type")).toHaveValue("number");
  await expect(page.locator("#workflow-input-1-required")).not.toBeChecked();

  await expect(page.locator("#workflow-stage-0-harness")).toHaveValue("claude");
  await expect(page.locator("#workflow-stage-0-model")).toHaveValue("sonnet");
  await expect(page.locator("#workflow-stage-0-effort")).toHaveValue("high");
  await expect(page.locator("#workflow-stage-0-step-0-prompt")).toHaveValue(STAGE1_PROMPT1);
  await expect(page.locator("#workflow-stage-0-step-0-goal")).toHaveValue(GOAL);
  await expect(page.locator("#workflow-stage-0-step-1-prompt")).toHaveValue(expected.stage1Prompt2);
  await expect(page.locator("#workflow-stage-0-step-1-goal")).toHaveCount(0);

  await expect(page.locator("#workflow-stage-1-harness")).toHaveValue("claude");
  await expect(page.locator("#workflow-stage-1-model")).toHaveValue("");
  await expect(page.locator("#workflow-stage-1-step-0-prompt")).toHaveValue(STAGE2_PROMPT1);
  await expect(page.locator("#workflow-stage-2-harness")).toHaveCount(0);
}

async function pageAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem("proliferate.auth.session");
    return raw ? (JSON.parse(raw) as { access_token?: string }).access_token ?? null : null;
  });
  expect(token).toBeTruthy();
  return token!;
}

async function authenticatedWorkflowGet(
  page: Page,
  workflowId: string,
): Promise<{ status: number; body: WorkflowDefinitionResponse }> {
  const token = await pageAccessToken(page);
  const response = await page.request.get(`${apiBaseUrl()}/v1/workflows/${workflowId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status(),
    body: await response.json() as WorkflowDefinitionResponse,
  };
}

/** Project the response stages onto the exact comparable shape: the server
 * omits unset optional fields, so normalize them before deep equality. */
function normalizedStages(
  stages: WorkflowDefinitionResponse["stages"],
): ComparableStage[] {
  return stages.map((stage) => ({
    harnessConfig: {
      agentKind: stage.harnessConfig.agentKind,
      modelId: stage.harnessConfig.modelId ?? null,
      effort: stage.harnessConfig.effort ?? null,
    },
    steps: stage.steps.map((step) => ({
      kind: step.kind,
      prompt: step.prompt,
      goal: step.goal ? { objective: step.goal.objective } : null,
    })),
  }));
}

interface WorkflowDefinitionResponse {
  id: string;
  title: string;
  revision: number;
  defaultRepoConfigId: string | null;
  inputs: Array<{ name: string; type: "string" | "number" | "boolean"; required: boolean }>;
  stages: Array<{
    harnessConfig: { agentKind: string; modelId?: string | null; effort?: string | null };
    steps: Array<{
      kind: "agent.prompt";
      prompt: string;
      goal?: { objective: string } | null;
    }>;
  }>;
}
