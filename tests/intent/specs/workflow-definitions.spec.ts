// T2-WFDEF-1 (specs/developing/testing/scenarios.md): workflow definition
// authoring lifecycle. This is the PR1 seam: real Desktop web UI, real server,
// and real Postgres, with AnyHarness deliberately skipped because definitions
// do not execute yet.

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
const ORIGINAL_TITLE = `T2 workflow ${RUN_ID}`;
const UPDATED_TITLE = `${ORIGINAL_TITLE} revised`;
const ORIGINAL_DESCRIPTION = "Definition lifecycle acceptance coverage.";
const UPDATED_DESCRIPTION = "Definition lifecycle acceptance coverage, revised.";
const ORIGINAL_PROMPT = "Investigate {{inputs.ticket}} and report the root cause.";
const UPDATED_PROMPT = "Investigate {{inputs.ticket}}, report the root cause, and propose a fix.";
const GOAL = "Produce an evidence-backed diagnosis.";

test.beforeAll(async () => {
  await ensureInstanceClaimed();
});

test("creates, reloads, reopens, edits, and deletes a durable definition", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto(`${webBaseUrl()}/workflows`);

  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "New workflow", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "New workflow", exact: true, level: 1 })).toBeVisible();

  await page.getByLabel("Title").fill(ORIGINAL_TITLE);
  await page.getByLabel("Description").fill(ORIGINAL_DESCRIPTION);
  await expect(page.getByLabel("Default repository")).toHaveValue("");

  await page.getByRole("button", { name: "Add input", exact: true }).click();
  await page.getByLabel("Name").fill("ticket");
  await expect(page.getByLabel("Type")).toHaveValue("string");
  await expect(page.getByLabel("Required")).toBeChecked();

  await page.getByLabel("Harness", { exact: true }).selectOption("claude");
  await page.getByLabel("Model", { exact: true }).selectOption("sonnet");
  await page.getByLabel("Effort", { exact: true }).selectOption("high");
  await page.getByLabel("Prompt", { exact: true }).fill(ORIGINAL_PROMPT);
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await page.getByLabel("Goal objective").fill(GOAL);

  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && response.url() === `${apiBaseUrl()}/v1/workflows`
  );
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json() as WorkflowDefinitionResponse;
  expect(created.revision).toBe(1);
  expect(created.defaultRepoConfigId).toBeNull();
  expect(created.inputs).toEqual([{ name: "ticket", type: "string", required: true }]);
  expect(created.stages[0]?.harnessConfig).toMatchObject({
    agentKind: "claude",
    modelId: "sonnet",
    effort: "high",
  });
  expect(created.stages[0]?.steps[0]).toMatchObject({
    kind: "agent.prompt",
    prompt: ORIGINAL_PROMPT,
    goal: { objective: GOAL },
  });

  const workflowId = created.id;
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows/${workflowId}`);

  // A hard browser reload forces a fresh authenticated GET from the server;
  // this proves the editor is reopening durable Postgres state rather than a
  // mutation-cache projection.
  await page.reload();
  await expectEditorValues(page, {
    title: ORIGINAL_TITLE,
    description: ORIGINAL_DESCRIPTION,
    prompt: ORIGINAL_PROMPT,
  });

  // Return to the list and reopen through the product surface as well. This
  // covers list discovery/navigation independently of the durable route
  // reload above.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows`);
  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();
  await page.getByRole("button").filter({ hasText: ORIGINAL_TITLE }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows/${workflowId}`);
  await expectEditorValues(page, {
    title: ORIGINAL_TITLE,
    description: ORIGINAL_DESCRIPTION,
    prompt: ORIGINAL_PROMPT,
  });

  const persisted = await authenticatedWorkflowGet(page, workflowId);
  expect(persisted.status).toBe(200);
  expect(persisted.body.revision).toBe(1);
  expect(persisted.body.title).toBe(ORIGINAL_TITLE);

  await page.getByLabel("Title").fill(UPDATED_TITLE);
  await page.getByLabel("Description").fill(UPDATED_DESCRIPTION);
  await page.getByLabel("Prompt", { exact: true }).fill(UPDATED_PROMPT);

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

  await page.reload();
  await expectEditorValues(page, {
    title: UPDATED_TITLE,
    description: UPDATED_DESCRIPTION,
    prompt: UPDATED_PROMPT,
  });

  await page.getByRole("button", { name: "Delete workflow", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delete workflow?", exact: true })).toBeVisible();
  const deleteResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "DELETE"
      && response.url().startsWith(`${apiBaseUrl()}/v1/workflows/${workflowId}`)
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(204);

  await expect(page).toHaveURL(`${webBaseUrl()}/workflows`);
  await expect(page.getByRole("heading", { name: "Workflows", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText(UPDATED_TITLE, { exact: true })).toHaveCount(0);

  const deleted = await authenticatedWorkflowGet(page, workflowId);
  expect(deleted.status).toBe(404);
});

async function signInThroughUi(page: Page): Promise<void> {
  await page.goto(webBaseUrl());
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
}

async function expectEditorValues(
  page: Page,
  expected: { title: string; description: string; prompt: string },
): Promise<void> {
  await expect(page.getByLabel("Title")).toHaveValue(expected.title);
  await expect(page.getByLabel("Description")).toHaveValue(expected.description);
  await expect(page.getByLabel("Default repository")).toHaveValue("");
  await expect(page.getByLabel("Name")).toHaveValue("ticket");
  await expect(page.getByLabel("Type")).toHaveValue("string");
  await expect(page.getByLabel("Required")).toBeChecked();
  await expect(page.getByLabel("Harness", { exact: true })).toHaveValue("claude");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("sonnet");
  await expect(page.getByLabel("Effort", { exact: true })).toHaveValue("high");
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue(expected.prompt);
  await expect(page.getByLabel("Goal objective")).toHaveValue(GOAL);
}

async function authenticatedWorkflowGet(
  page: Page,
  workflowId: string,
): Promise<{ status: number; body: WorkflowDefinitionResponse }> {
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem("proliferate.auth.session");
    return raw ? (JSON.parse(raw) as { access_token?: string }).access_token ?? null : null;
  });
  expect(token).toBeTruthy();
  const response = await page.request.get(`${apiBaseUrl()}/v1/workflows/${workflowId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status(),
    body: await response.json() as WorkflowDefinitionResponse,
  };
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
