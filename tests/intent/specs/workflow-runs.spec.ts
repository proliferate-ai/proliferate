// T2-WF-RUN: real ProductClient renderer + real Server/Postgres. The shared
// intent stack enables managed Workflow admission but disables background
// workers, so delivery remains durably queued before any sandbox/E2B effect.

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

const RUN_MARKER = Date.now();
const TITLE = `T2 managed workflow ${RUN_MARKER}`;
const TICKET = `PROL-${RUN_MARKER}`;
let workflowId: string;
let ownerToken: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = await waitForOwnerToken();
  const created = await apiRequest<{ id: string }>("/v1/workflows", {
    method: "POST",
    token: ownerToken,
    body: {
      title: TITLE,
      description: "Managed Workflow product acceptance.",
      defaultRepoConfigId: null,
      inputs: [{ name: "ticket", type: "string", required: true }],
      stages: [{
        harnessConfig: { agentKind: "claude", modelId: null, effort: null },
        steps: [{ kind: "agent.prompt", prompt: "Return {{inputs.ticket}}", goal: null }],
      }],
    },
  });
  expect(created.status).toBe(201);
  workflowId = created.body.id;
  await waitForDefinition(ownerToken, workflowId);
});

test("launches once, reloads durable history, and cancels before sandbox execution", async ({ page }) => {
  await signIn(page);
  await page.goto(`${webBaseUrl()}/workflows/${workflowId}`);

  await expect(page.getByRole("heading", { name: TITLE, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run in Cloud" })).toBeEnabled();
  await page.getByRole("textbox", { name: "ticket", exact: true }).fill(TICKET);

  let invocationPutCount = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/v1/workflow-invocations/")) {
      invocationPutCount += 1;
    }
  });

  await page.getByRole("button", { name: "Run in Cloud" }).dblclick();
  await expect(page).toHaveURL(new RegExp(`/workflows/${workflowId}/runs/[0-9a-f-]+$`, "u"));
  expect(invocationPutCount).toBe(1);

  const runId = page.url().split("/").at(-1)!;
  await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Scratch workspace", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: TITLE, level: 1 })).toBeVisible();
  await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();

  const cancelResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && response.url() === `${apiBaseUrl()}/v1/workflow-invocations/${runId}/cancel`
  );
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  expect((await cancelResponsePromise).status()).toBe(200);
  await expect(page.getByText("Delivery cancelled", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(`${webBaseUrl()}/workflows/${workflowId}`);
  await expect(page.getByRole("heading", { name: "Recent runs", exact: true })).toBeVisible();
  await expect(page.getByText("Delivery cancelled", { exact: true })).toBeVisible();

  const history = await apiRequest<{
    items: Array<{ id: string; deliveryStatus: string }>;
  }>(`/v1/workflow-invocations?workflowDefinitionId=${workflowId}`, {
    token: ownerToken,
  });
  expect(history.status).toBe(200);
  expect(history.body.items.filter((item) => item.id === runId)).toEqual([
    expect.objectContaining({ id: runId, deliveryStatus: "delivery_cancelled" }),
  ]);
});

async function signIn(page: Page): Promise<void> {
  await page.goto(webBaseUrl());
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
}

async function waitForDefinition(token: string, definitionId: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await apiRequest(`/v1/workflows/${definitionId}`, { token });
    if (result.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Workflow ${definitionId} was not durably readable within 15 seconds.`);
}

async function waitForOwnerToken(): Promise<string> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      return (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError ?? new Error("Owner login did not become ready after instance claim.");
}
