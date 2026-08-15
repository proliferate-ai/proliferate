// T2-WFDEF-1 (specs/TESTING/scenarios.md): gen-2 workflow definition
// authoring lifecycle. This is the PR7 seam: real Desktop web UI, real
// server, and real Postgres, with AnyHarness deliberately skipped because
// definitions do not execute yet.
//
// The scenario proves the full acceptance surface: a linear chain of two
// uniquely identifiable ordered nodes (agent, human_in_loop) whose prompts
// reference declared names via @input:/@doc: tokens, authored through the
// inputs panel and doc-templates panel rather than free-standing
// stages/steps; live validation blocks save while a prompt references an
// unresolved name and unblocks the moment the reference is declared; and
// exact ordered node/edge/input/docTemplate arrays after create, hard
// reload, list reopen, authenticated GET, and the revision-2 update (which
// also reorders the chain, so the ordering assertions cannot pass
// vacuously). Then delete and assert both the list and the authenticated API
// no longer expose it.
//
// The gen-2 builder has no repository picker (see
// lib/domain/workflows/workflow-builder-draft.ts's own comment on this): a
// definition's `defaultRepoConfigId` is never set by this surface, so it is
// asserted `null` throughout rather than seeded.
//
// Flag: workflows_v2 (lib/domain/capabilities/workflows-v2.ts) defaults to
// `false` today and flips to `true` in this ladder's final rung, landed as its
// own isolated commit later in this same PR. This spec asserts the flag-ON UI
// and does not wait for that rung: the boot harness serves the desktop web
// with `VITE_WORKFLOWS_V2=1` (stack/global-setup.ts's `extraDesktopEnv`),
// which forces the gate on in either direction, so this file passes before and
// after the default flips.

import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiBaseUrl,
  ensureInstanceClaimed,
  webBaseUrl,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

const RUN_ID = Date.now();
const ORIGINAL_TITLE = `T2 workflow v2 ${RUN_ID}`;
const UPDATED_TITLE = `${ORIGINAL_TITLE} revised`;
const ORIGINAL_DESCRIPTION = "Gen-2 definition lifecycle acceptance coverage.";
const UPDATED_DESCRIPTION = "Gen-2 definition lifecycle acceptance coverage, revised.";

const NODE1_TITLE = `Investigate ${RUN_ID}`;
const NODE2_TITLE = `Approve ${RUN_ID}`;
const STAGE1_PROMPT = "s1p1: investigate @input:ticket at severity @input:severity.";
const STAGE2_PROMPT = "s2p1: review @doc:findings for @input:ticket.";
const UPDATED_STAGE2_PROMPT =
  "s2p1v2: review @doc:findings for @input:ticket, then flag any blocking risk.";
const DOC_BODY = "# Findings\n";

const ORIGINAL_INPUTS = [
  { name: "ticket", description: "Ticket id to investigate.", required: true },
  { name: "severity", description: "Optional severity rating.", required: false },
];

interface ComparableNode {
  id: string;
  type: "agent" | "human_in_loop";
  title: string;
  prompt: string;
  model: { agentKind: string; modelId: string | null; modeId: string | null } | null;
}

const ORIGINAL_NODES: ComparableNode[] = [
  { id: "step-1", type: "agent", title: NODE1_TITLE, prompt: STAGE1_PROMPT, model: null },
  { id: "step-2", type: "human_in_loop", title: NODE2_TITLE, prompt: STAGE2_PROMPT, model: null },
];
const ORIGINAL_EDGES = [{ from: "step-1", to: "step-2" }];

// Revision 2 both edits content AND reorders the chain (step-2 moves to the
// front): a swapped, non-vacuous ordering assertion, mirroring gen-1's own
// "unique ordinal marker" rationale for its stage/step arrays.
const UPDATED_NODES: ComparableNode[] = [
  { id: "step-2", type: "human_in_loop", title: NODE2_TITLE, prompt: UPDATED_STAGE2_PROMPT, model: null },
  { id: "step-1", type: "agent", title: NODE1_TITLE, prompt: STAGE1_PROMPT, model: null },
];
const UPDATED_EDGES = [{ from: "step-2", to: "step-1" }];

const DOC_TEMPLATES = [{ slug: "findings", producingNodeId: "step-1", body: DOC_BODY }];

let workflowId: string;

test("creates, reloads, reopens, edits, and deletes a durable gen-2 definition", async ({ page }) => {
  await ensureInstanceClaimed();
  // `ensureInstanceClaimed`'s claim POST commits its transaction in dependency
  // teardown after responding (same hazard `seedRepositoryThroughProductApi`
  // guards against in this file's gen-1 predecessor); this spec has no
  // repository-seeding step to absorb that delay before the first login, so
  // it waits for the claim to be visible on the read-only signal directly
  // rather than racing a UI-driven sign-in against it.
  await awaitInstanceClaimVisible();
  await signInThroughUi(page);

  await page.goto(`${webBaseUrl()}/workflows`);
  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();

  // "New workflow options" is the trigger's accessible name (an explicit
  // aria-label on WorkflowMainNewMenu), distinct from its visible "New
  // workflow" text.
  await page.getByRole("button", { name: "New workflow options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Blank workflow", exact: true }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows/new`);
  await expect(page.getByRole("heading", { name: "New workflow", exact: true, level: 1 })).toBeVisible();

  await page.locator("#workflow-builder-title").fill(ORIGINAL_TITLE);
  await page.locator("#workflow-builder-description").fill(ORIGINAL_DESCRIPTION);

  // Two uniquely identifiable inputs, declared before the prompts that
  // reference them so the only issue introduced below is the one the
  // negative control below is about.
  await page.getByRole("button", { name: "Add input", exact: true }).click();
  await page.locator("#workflow-builder-input-0-name").fill("ticket");
  await page.locator("#workflow-builder-input-0-description").fill("Ticket id to investigate.");
  await expect(page.locator("#workflow-builder-input-0-required")).toBeChecked();

  await page.getByRole("button", { name: "Add input", exact: true }).click();
  await page.locator("#workflow-builder-input-1-name").fill("severity");
  await page.locator("#workflow-builder-input-1-description").fill("Optional severity rating.");
  await page.locator("#workflow-builder-input-1-required").click();
  await expect(page.locator("#workflow-builder-input-1-required")).not.toBeChecked();

  // Node 1 (step-1, agent): both @input: refs already resolved by the inputs
  // above, so this alone introduces no issue.
  await page.locator("#workflow-builder-node-step-1-title").fill(NODE1_TITLE);
  await page.locator("#workflow-builder-node-step-1-prompt").fill(STAGE1_PROMPT);

  // Node 2 (step-2, human_in_loop): references @doc:findings, which is not
  // declared yet — this is the negative control.
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.locator("#workflow-builder-node-step-2-approval").click();
  await page.locator("#workflow-builder-node-step-2-title").fill(NODE2_TITLE);
  await page.locator("#workflow-builder-node-step-2-prompt").fill(STAGE2_PROMPT);

  // Negative control: an unresolved @doc: reference blocks save with an
  // exact, non-generic message, and the chip preview marks it unresolved.
  const saveButton = page.getByRole("button", { name: "Save", exact: true });
  await expect(
    page.getByText(
      "Fix 1 issue before saving. Node “step-2” prompt references unknown doc template “@doc:findings”.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await expect(page.locator('span[data-resolved="false"]')).toHaveCount(1);
  await expect(page.locator('span[data-resolved="false"]')).toHaveText("@doc:findings");

  // Fix: declare the doc template the prompt already references. Save
  // unblocks the instant the reference resolves.
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  await page.locator("#workflow-builder-doc-0-slug").fill("findings");
  await page.locator("#workflow-builder-doc-0-producing-node").selectOption("step-1");
  await page.locator("#workflow-builder-doc-0-body").fill(DOC_BODY);
  await expect(page.locator('span[data-resolved="false"]')).toHaveCount(0);
  await expect(saveButton).toBeEnabled();

  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && response.url() === `${apiBaseUrl()}/v1/workflows`
  );
  await saveButton.click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json() as WorkflowDefinitionRecordV2Response;
  expect(created.schemaVersion).toBe(2);
  expect(created.revision).toBe(1);
  expect(created.defaultRepoConfigId).toBeNull();
  expect(created.title).toBe(ORIGINAL_TITLE);
  expect(created.description).toBe(ORIGINAL_DESCRIPTION);
  expect(normalizedNodes(created.definition.nodes)).toEqual(ORIGINAL_NODES);
  expect(created.definition.edges).toEqual(ORIGINAL_EDGES);
  expect(created.definition.inputs).toEqual(ORIGINAL_INPUTS);
  expect(created.definition.docTemplates).toEqual(DOC_TEMPLATES);

  workflowId = created.id;
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows/${workflowId}`);

  await awaitWorkflowRevision(page, workflowId, 1);

  // A hard browser reload forces a fresh authenticated GET: proves the
  // builder is reopening durable Postgres state, not a mutation cache.
  await page.reload();
  await expectBuilderState(page, {
    title: ORIGINAL_TITLE,
    description: ORIGINAL_DESCRIPTION,
    nodes: ORIGINAL_NODES,
  });

  // Return to the list and reopen through the product surface as well —
  // covers list discovery/navigation independently of the reload above.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows`);
  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();
  const originalRow = page.getByRole("button").filter({ hasText: ORIGINAL_TITLE });
  await expect(originalRow).toBeVisible();
  await originalRow.hover();
  await originalRow.getByRole("button", { name: `Edit ${ORIGINAL_TITLE}`, exact: true }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows/${workflowId}`);
  await expectBuilderState(page, {
    title: ORIGINAL_TITLE,
    description: ORIGINAL_DESCRIPTION,
    nodes: ORIGINAL_NODES,
  });

  const persisted = await authenticatedWorkflowGet(page, workflowId);
  expect(persisted.status).toBe(200);
  expect(persisted.body.revision).toBe(1);
  expect(persisted.body.title).toBe(ORIGINAL_TITLE);
  expect(persisted.body.defaultRepoConfigId).toBeNull();
  expect(normalizedNodes(persisted.body.definition.nodes)).toEqual(ORIGINAL_NODES);
  expect(persisted.body.definition.edges).toEqual(ORIGINAL_EDGES);
  expect(persisted.body.definition.inputs).toEqual(ORIGINAL_INPUTS);
  expect(persisted.body.definition.docTemplates).toEqual(DOC_TEMPLATES);

  // Edit: title/description, reorder the chain (step-2 moves up), and edit
  // step-2's prompt — content and order both change, so reload cannot pass
  // by re-reading either the old order or the old text.
  await page.locator("#workflow-builder-title").fill(UPDATED_TITLE);
  await page.locator("#workflow-builder-description").fill(UPDATED_DESCRIPTION);
  await page.getByRole("button", { name: "Move step 2 up", exact: true }).click();
  await page.locator("#workflow-builder-node-step-2-prompt").fill(UPDATED_STAGE2_PROMPT);

  const updateResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "PUT"
      && response.url() === `${apiBaseUrl()}/v1/workflows/${workflowId}`
  );
  await saveButton.click();
  const updateResponse = await updateResponsePromise;
  expect(updateResponse.status()).toBe(200);
  const updated = await updateResponse.json() as WorkflowDefinitionRecordV2Response;
  expect(updated.revision).toBe(2);
  expect(updated.title).toBe(UPDATED_TITLE);
  expect(updated.description).toBe(UPDATED_DESCRIPTION);
  expect(updated.defaultRepoConfigId).toBeNull();
  expect(normalizedNodes(updated.definition.nodes)).toEqual(UPDATED_NODES);
  expect(updated.definition.edges).toEqual(UPDATED_EDGES);
  expect(updated.definition.inputs).toEqual(ORIGINAL_INPUTS);
  expect(updated.definition.docTemplates).toEqual(DOC_TEMPLATES);

  await awaitWorkflowRevision(page, workflowId, 2);

  await page.reload();
  await expectBuilderState(page, {
    title: UPDATED_TITLE,
    description: UPDATED_DESCRIPTION,
    nodes: UPDATED_NODES,
  });

  const revisionTwo = await authenticatedWorkflowGet(page, workflowId);
  expect(revisionTwo.status).toBe(200);
  expect(revisionTwo.body.revision).toBe(2);
  expect(revisionTwo.body.defaultRepoConfigId).toBeNull();
  expect(normalizedNodes(revisionTwo.body.definition.nodes)).toEqual(UPDATED_NODES);
  expect(revisionTwo.body.definition.edges).toEqual(UPDATED_EDGES);
  expect(revisionTwo.body.definition.inputs).toEqual(ORIGINAL_INPUTS);
  expect(revisionTwo.body.definition.docTemplates).toEqual(DOC_TEMPLATES);

  // Delete via the row's confirm dialog.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows`);
  const updatedRow = page.getByRole("button").filter({ hasText: UPDATED_TITLE });
  await expect(updatedRow).toBeVisible();
  await updatedRow.hover();
  await updatedRow.getByRole("button", { name: `${UPDATED_TITLE} actions`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete...", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delete this workflow?", exact: true })).toBeVisible();
  await expect(page.getByText(
    `“${UPDATED_TITLE}” and its saved definition will be removed. Runs already started are not affected.`,
    { exact: true },
  )).toBeVisible();

  const deleteResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "DELETE"
      && response.url().startsWith(`${apiBaseUrl()}/v1/workflows/${workflowId}`)
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(204);

  await awaitWorkflowDeleted(page, workflowId);

  await expect(page).toHaveURL(`${webBaseUrl()}/workflows`);
  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText(UPDATED_TITLE, { exact: true })).toHaveCount(0);
});

// ── helpers ──

const CONVERGENCE_TIMEOUT_MS = 15_000;
const CONVERGENCE_POLL_MS = 250;
const CONVERGENCE_PROBE_TIMEOUT_MS = 5_000;

/** Bounded API convergence: the server commits request transactions in
 * dependency teardown after responding, so a follow-up request may briefly
 * see the prior state. Poll with a short interval up to a hard overall
 * deadline; each probe is additionally raced against the smaller of the
 * per-probe cap and the remaining deadline, so one hung request cannot
 * exceed the bound. Probes MUST be read-only/idempotent. Ported from this
 * file's gen-1 predecessor unchanged — the convergence hazard is a server
 * property, not a gen-1/gen-2 one. */
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

/** Poll the read-only GET /setup signal until it reports the claim
 * (`ensureInstanceClaimed`, imported from stack/seed.ts) as committed: a
 * clean first-run claim commits its transaction in dependency teardown after
 * the /setup response, so the admin account may briefly be invisible to
 * other requests. This file's gen-1 predecessor guards the equivalent race by
 * routing its first admin API call through a `convergedAdminLogin` helper
 * that polls this same signal before a single credentialed login POST
 * (never retried, to avoid tripping the 5-failures-per-15-minutes auth
 * throttle); this spec signs in through the UI instead of the API, so there
 * is no login POST to protect from a retry loop — only the wait for
 * visibility before that one UI-driven attempt. */
async function awaitInstanceClaimVisible(): Promise<void> {
  let lastStatus = "never probed";
  await pollUntil(
    () => `GET /setup to report the committed claim as 404 (last seen: ${lastStatus})`,
    async () => {
      const status = (await fetch(`${apiBaseUrl()}/setup`)).status;
      lastStatus = `status ${status}`;
      return status === 404;
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
  definitionId: string,
): Promise<{ status: number; body: WorkflowDefinitionRecordV2Response }> {
  const token = await pageAccessToken(page);
  const response = await page.request.get(`${apiBaseUrl()}/v1/workflows/${definitionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status(),
    body: await response.json() as WorkflowDefinitionRecordV2Response,
  };
}

async function awaitWorkflowRevision(
  page: Page,
  definitionId: string,
  expectedRevision: number,
): Promise<void> {
  let last: { status: number; revision?: number } = { status: -1 };
  await pollUntil(
    () => `workflow ${definitionId} at revision ${expectedRevision} (last seen: ${JSON.stringify(last)})`,
    async () => {
      const result = await authenticatedWorkflowGet(page, definitionId);
      last = { status: result.status, revision: result.body?.revision };
      return result.status === 200 && result.body.revision === expectedRevision;
    },
  );
}

async function awaitWorkflowDeleted(page: Page, definitionId: string): Promise<void> {
  let lastSeen = "never probed";
  await pollUntil(
    () => `workflow ${definitionId} deleted (detail 404 + absent from list; last seen: ${lastSeen})`,
    async () => {
      const detail = await authenticatedWorkflowGet(page, definitionId);
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
        && !body.workflows.some((candidate) => candidate.id === definitionId);
    },
  );
}

/** Assert the full builder state: title/description plus every ordered node's
 * id/type/title/prompt, the inputs, and the doc template — so reload/reopen
 * cannot pass on a subset. */
async function expectBuilderState(
  page: Page,
  expected: { title: string; description: string; nodes: ComparableNode[] },
): Promise<void> {
  await expect(page.locator("#workflow-builder-title")).toHaveValue(expected.title);
  await expect(page.locator("#workflow-builder-description")).toHaveValue(expected.description);

  for (const [index, node] of expected.nodes.entries()) {
    await expect(page.locator(`#workflow-builder-node-${node.id}-title`)).toHaveValue(node.title);
    await expect(page.locator(`#workflow-builder-node-${node.id}-prompt`)).toHaveValue(node.prompt);
    // The "Requires approval" Switch (role="switch") replaced the old
    // Agent/Human SegmentedControl; human_in_loop is now "approval on".
    // Asserting both states (not just the checked one) keeps this
    // non-vacuous for agent nodes.
    await expect(page.locator(`#workflow-builder-node-${node.id}-approval`)).toHaveAttribute(
      "aria-checked",
      node.type === "human_in_loop" ? "true" : "false",
    );
  }
  await expect(page.locator(`#workflow-builder-node-step-${expected.nodes.length + 1}-title`)).toHaveCount(0);

  await expect(page.locator("#workflow-builder-input-0-name")).toHaveValue("ticket");
  await expect(page.locator("#workflow-builder-input-0-required")).toBeChecked();
  await expect(page.locator("#workflow-builder-input-1-name")).toHaveValue("severity");
  await expect(page.locator("#workflow-builder-input-1-required")).not.toBeChecked();

  await expect(page.locator("#workflow-builder-doc-0-slug")).toHaveValue("findings");
  await expect(page.locator("#workflow-builder-doc-0-producing-node")).toHaveValue("step-1");
  await expect(page.locator("#workflow-builder-doc-0-body")).toHaveValue(DOC_BODY);
}

/** Project the response nodes onto the exact comparable shape: `model` is
 * optional/omittable on the wire, so normalize it before deep equality —
 * same rationale as gen-1's `normalizedStages` in this file's predecessor. */
function normalizedNodes(nodes: WorkflowNodeV2Response[]): ComparableNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    title: node.title,
    prompt: node.prompt,
    model: node.model
      ? {
        agentKind: node.model.agentKind,
        modelId: node.model.modelId ?? null,
        modeId: node.model.modeId ?? null,
      }
      : null,
  }));
}

interface WorkflowNodeV2Response {
  id: string;
  type: "agent" | "human_in_loop";
  title: string;
  prompt: string;
  model?: { agentKind: string; modelId?: string | null; modeId?: string | null } | null;
}

interface WorkflowDefinitionV2Response {
  schemaVersion: 2;
  nodes: WorkflowNodeV2Response[];
  edges: Array<{ from: string; to: string }>;
  inputs: Array<{ name: string; description: string; required: boolean }>;
  docTemplates: Array<{ slug: string; producingNodeId: string; body: string }>;
}

interface WorkflowDefinitionRecordV2Response {
  id: string;
  title: string;
  description: string;
  schemaVersion: 2;
  revision: number;
  defaultRepoConfigId: string | null;
  definition: WorkflowDefinitionV2Response;
}
