// T2-WFDEF-1 (specs/engineering/testing/scenarios.md): gen-2 workflow definition
// authoring lifecycle. This is the PR7 seam: real Desktop web UI, real
// server, and real Postgres, with AnyHarness deliberately skipped because
// definitions do not execute yet.
//
// The scenario proves the full acceptance surface: a two-step explicit graph
// with uniquely identifiable ordered nodes (agent, human_in_loop) whose prompts
// reference declared names via @input:/@doc: tokens, authored through the
// inputs panel and doc-templates panel rather than free-standing
// stages/steps; live validation blocks save while a prompt references an
// unresolved name and unblocks the moment the reference is declared; and
// detached-node and malformed-JSON negative controls; and exact ordered
// node/edge/input/docTemplate arrays after create, hard
// reload, list reopen, authenticated GET, and the revision-2 update (which
// reorders display order without rewriting the authored edge). Then delete
// and assert both the list and the authenticated API
// no longer expose it.
//
// The test stack exposes no connected runtime repository, so the builder's
// optional default-repository selection remains null throughout.
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

// Revision 2 edits content and moves step-2 to the front in authored display
// order. The explicit edge remains step-1 -> step-2: this is the negative
// control that would fail if moving cards silently rewired persisted topology.
const UPDATED_NODES: ComparableNode[] = [
  { id: "step-2", type: "human_in_loop", title: NODE2_TITLE, prompt: UPDATED_STAGE2_PROMPT, model: null },
  { id: "step-1", type: "agent", title: NODE1_TITLE, prompt: STAGE1_PROMPT, model: null },
];
const UPDATED_EDGES = ORIGINAL_EDGES;

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
  // This environment provisions no integrations, so the capability-liveness
  // toast ("Integrations unavailable") re-raises for the whole session and its
  // bottom-right card intercepts clicks aimed at the inspector's lower inputs.
  // Dismiss it whenever it surfaces instead of racing individual clicks.
  await page.addLocatorHandler(
    page.getByText("Integrations unavailable", { exact: true }),
    async () => {
      // ToastBody's close affordance is aria-labelled "Close"; scope to the
      // notifications region so no dialog close button can match instead.
      await page
        .getByRole("region", { name: /Notifications/ })
        .getByRole("button", { name: "Close", exact: true })
        .first()
        .click();
    },
  );
  await signInThroughUi(page);

  await page.goto(`${webBaseUrl()}/workflows`);
  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();

  // "New workflow options" is the trigger's accessible name (an explicit
  // aria-label on WorkflowMainNewMenu), distinct from its visible "New
  // workflow" text.
  await page.getByRole("button", { name: "New workflow options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Blank workflow", exact: true }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows/new`);
  // The three-pane builder has no page heading — the title lives in the top
  // bar beside Save, as an aria-labelled input rather than an id (there is no
  // `#workflow-builder-title` anymore).
  const titleField = page.getByRole("textbox", { name: "Workflow title", exact: true });
  await expect(titleField).toBeVisible();
  await titleField.fill(ORIGINAL_TITLE);

  // Description and inputs now live in the inspector behind the chain's
  // structural input card ("Inputs"), not a always-visible page section.
  await selectInputCard(page);
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

  // Node 1 (step-1, agent) is only selected by default while nothing else
  // has been selected — `selectInputCard` above moved selection onto the
  // input card, so it needs reselecting here before its fields exist in the
  // DOM. Both @input: refs are already resolved by the inputs above, so this
  // alone introduces no issue.
  await selectNodeCard(page, "Untitled step");
  await page.locator("#workflow-builder-node-step-1-title").fill(NODE1_TITLE);
  await page.locator("#workflow-builder-node-step-1-prompt").fill(STAGE1_PROMPT);

  // Node 2 (step-2, human_in_loop): the rail's step palette adds the type
  // directly (no separate approval toggle) and selects the new step in the
  // inspector. Its prompt references @doc:findings, which is not declared
  // yet — this is the negative control.
  await page.getByRole("button", { name: "Human in the loop", exact: true }).click();
  await page.locator("#workflow-builder-node-step-2-title").fill(NODE2_TITLE);
  await page.locator("#workflow-builder-node-step-2-prompt").fill(STAGE2_PROMPT);

  // A new card is intentionally detached. That invalid production topology
  // must block save until the author explicitly connects the real ports.
  const saveButton = page.getByRole("button", { name: "Save Workflow", exact: true });
  await expect(saveButton).toBeDisabled();
  await connectNodePorts(page, NODE1_TITLE, NODE2_TITLE);

  // JSON edits project through the same graph definition. Unknown fields are
  // retained as invalid source, block save, and do not replace the last graph.
  await page.getByRole("radio", { name: "JSON", exact: true }).click();
  const jsonEditor = page.getByRole("textbox", { name: "Workflow definition JSON", exact: true });
  await expect(jsonEditor).toHaveValue(new RegExp(NODE1_TITLE));
  const validJson = await jsonEditor.inputValue();
  // Add the unknown field to the decoded document rather than to its text: the
  // pane's formatting (trailing newline included) is not what is under test.
  await jsonEditor.fill(
    JSON.stringify({ ...JSON.parse(validJson) as object, unexpected: true }, null, 2),
  );
  await expect(page.getByText("The definition contains an unknown field.", { exact: true })).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await page.getByRole("button", { name: "Revert", exact: true }).click();
  // Revert drops the author's text for the graph's own document — which is not
  // itself valid yet (@doc:findings is still undeclared, the negative control
  // below), so the pane stops naming the unknown field and goes back to
  // showing exactly what the graph holds.
  await expect(page.getByText("The definition contains an unknown field.", { exact: true }))
    .toHaveCount(0);
  await expect(jsonEditor).toHaveValue(validJson);
  await page.getByRole("radio", { name: "Graph", exact: true }).click();
  await expect(page.getByRole("group", { name: "Workflow chain", exact: true })
    .getByRole("button")
    .filter({ hasText: NODE2_TITLE })).toBeVisible();

  // Negative control: an unresolved @doc: reference blocks save with an
  // exact, non-generic message, and the chip preview marks it unresolved.
  await expect(
    page.getByText(
      "Fix 1 issue before saving. Node “step-2” prompt references unknown doc template “@doc:findings”.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await expect(page.locator('span[data-resolved="false"]')).toHaveCount(1);
  await expect(page.locator('span[data-resolved="false"]')).toHaveText("@doc:findings");

  // Fix: declare the doc template the prompt already references (auto-selects
  // the new doc in the inspector, taking the focus off step-2). Save unblocks
  // the instant the reference resolves.
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  await page.locator("#workflow-builder-doc-0-slug").fill("findings");
  await page.locator("#workflow-builder-doc-0-producing-node").selectOption("step-1");
  await page.locator("#workflow-builder-doc-0-body").fill(DOC_BODY);
  await expect(saveButton).toBeEnabled();

  // Reselect step-2 on the canvas to confirm its own reference actually
  // resolved, rather than merely leaving the inspector that showed it. The
  // prompt also references @input:ticket (resolved from the start), so the
  // doc chip needs picking out by its own text rather than the bare
  // `data-resolved="true"` selector, which now matches both refs.
  await selectNodeCard(page, NODE2_TITLE);
  await expect(page.locator('span[data-resolved="false"]')).toHaveCount(0);
  await expect(
    page.locator('span[data-resolved="true"]').filter({ hasText: "@doc:findings" }),
  ).toHaveText("@doc:findings");

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

  // Edit: title/description, move step-2's display order up, and edit its
  // prompt. The explicit step-1 -> step-2 edge must remain unchanged.
  // `expectBuilderState`
  // above leaves step-2 selected (the last node in `ORIGINAL_NODES`), so its
  // move affordance is already visible without an extra canvas click.
  await titleField.fill(UPDATED_TITLE);
  await selectInputCard(page);
  await page.locator("#workflow-builder-description").fill(UPDATED_DESCRIPTION);
  await selectNodeCard(page, NODE2_TITLE);
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

/**
 * Select the chain's structural input card on the canvas (the workflow
 * details/inputs live in the inspector behind it, not an always-visible page
 * section).
 */
async function selectInputCard(page: Page): Promise<void> {
  await page.getByRole("group", { name: "Workflow chain", exact: true })
    .getByRole("button")
    .filter({ hasText: "Trigger payload entering the workflow" })
    .click();
}

/**
 * Select a chain step on the canvas by its (unique) title text — the three-
 * pane builder draws steps as canvas cards rather than an always-visible
 * stacked list, so only the selected step's fields exist in the DOM at a
 * time.
 */
async function selectNodeCard(page: Page, title: string): Promise<void> {
  await page.getByRole("group", { name: "Workflow chain", exact: true })
    .getByRole("button")
    .filter({ hasText: title })
    .click();
}

/** Exercise the production pointer-driven ports instead of mutating draft data. */
async function connectNodePorts(page: Page, fromTitle: string, toTitle: string): Promise<void> {
  const canvas = page.getByRole("group", { name: "Workflow chain", exact: true });
  await canvas.getByRole("button", { name: `Connect from ${fromTitle}`, exact: true })
    .dispatchEvent("pointerdown", { pointerId: 1, pointerType: "mouse", isPrimary: true });
  await canvas.getByRole("button", { name: `Connect into ${toTitle}`, exact: true })
    .dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse", isPrimary: true });
}

/** Assert the full builder state: title/description plus every ordered node's
 * id/type/title/prompt, the inputs, and the doc template — so reload/reopen
 * cannot pass on a subset. Each pane (input card / step / doc) is a separate
 * inspector selection in the three-pane builder, so this walks them in turn
 * rather than reading everything out of one static page. */
async function expectBuilderState(
  page: Page,
  expected: { title: string; description: string; nodes: ComparableNode[] },
): Promise<void> {
  await expect(page.getByRole("textbox", { name: "Workflow title", exact: true })).toHaveValue(expected.title);

  // The canvas's bottom-left readout names the step/node counts independently
  // of which pane is selected — the three-pane builder has no standing list
  // of node ids to assert an (N+1)th one is absent from.
  const stepWord = expected.nodes.length === 1 ? "step" : "steps";
  await expect(page.getByText(
    `${expected.nodes.length} ${stepWord} · ${expected.nodes.length + 1} nodes`,
    { exact: true },
  )).toBeVisible();

  await selectInputCard(page);
  await expect(page.locator("#workflow-builder-description")).toHaveValue(expected.description);
  await expect(page.locator("#workflow-builder-input-0-name")).toHaveValue("ticket");
  await expect(page.locator("#workflow-builder-input-0-required")).toBeChecked();
  await expect(page.locator("#workflow-builder-input-1-name")).toHaveValue("severity");
  await expect(page.locator("#workflow-builder-input-1-required")).not.toBeChecked();

  for (const node of expected.nodes) {
    await selectNodeCard(page, node.title);
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

  await page.getByRole("button", { name: "findings", exact: true }).click();
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
