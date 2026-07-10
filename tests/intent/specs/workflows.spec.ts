// T2-WF-1, T2-WF-5 (specs/developing/testing/scenarios.md): workflow definition
// lifecycle + run-to-the-delivery-seam, and StartRun session-binding validation
// + the all-mutations lockout / take-over release.
//
// Tier-2 law: the run path stops AT THE SEAM. No Rust runtime executes
// (TIER2_INTENT_SKIP_RUNTIME=1); a run's honest tier-2 outcome is "row created,
// plan resolved with interpolated args, delivery state recorded" — never sandbox
// readiness or run completion (those are tier-3). For a LOCAL manual run the
// server records `pending_delivery` (the desktop relay delivers), so the local
// delivery seam this spec exercises is: StartRun -> pending_delivery, then the
// owner-authed relay call `POST /runs/{id}/delivered` -> `delivered`
// (delivery.py never wakes a sandbox for a local run). Cloud-lane delivery
// (server wakes the sandbox + POSTs the plan) is a GitHub-fixture + sandbox path,
// so it is tier-3, not asserted here.
//
// The editor (T2-WF-1) is the one place the UI is the surface: live reference
// validation is client-side (@proliferate/product-domain/workflows/validation
// reproduces the server's strict parse), so it is fully assertable in the
// desktop web build without a save round-trip — the Save button is gated on zero
// issues, which is exactly the guarantee the scenario names.
//
// Free-plan cap: FREE_PLAN_MAX_WORKFLOWS_PER_USER = 1 non-archived workflow per
// user, and these specs share the single owner against a persisted profile DB —
// so every test that creates a workflow calls resetActiveWorkflows first
// (archive-all → clean 0-count slate), which is rerun-safe.

import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ensureInstanceClaimed,
  passwordLogin,
  webBaseUrl,
} from "../stack/seed.ts";
import {
  cancelRun,
  createWorkflowOrThrow,
  getRun,
  getWorkflow,
  markRunDelivered,
  resetActiveWorkflows,
  singlePromptDefinition,
  startRun,
  updateWorkflow,
} from "../stack/seed-workflows.ts";

test.describe.configure({ mode: "serial" });

let ownerToken: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
});

async function signIn(page: Page): Promise<void> {
  await page.goto(webBaseUrl());
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Past the auth gate: the password field is gone.
  await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
}

test.describe("T2-WF-1: definition lifecycle + run-to-delivery-seam", () => {
  test("create → GET round-trips the canonical definition and pins version 1", async () => {
    await resetActiveWorkflows(ownerToken);
    const created = await createWorkflowOrThrow(ownerToken, {
      name: "WF-1 lifecycle",
      description: "round-trip",
      definition: singlePromptDefinition("Investigate {{inputs.task}} thoroughly.", [
        { name: "task", type: "text", required: true },
      ]),
    });
    expect(created.workflow.name).toBe("WF-1 lifecycle");
    expect(created.workflow.currentVersionId).toBe(created.currentVersion?.id);
    expect(created.versions).toHaveLength(1);
    expect(created.currentVersion?.versionN).toBe(1);

    // GET returns exactly what was saved (canonical form): the step prompt and the
    // declared input survive the write→read round trip.
    const fetched = await getWorkflow(ownerToken, created.workflow.id);
    expect(fetched.status).toBe(200);
    const agents = fetched.body.currentVersion?.definition.agents as Array<Record<string, unknown>>;
    const steps = agents[0].steps as Array<Record<string, unknown>>;
    expect(steps[0].prompt).toBe("Investigate {{inputs.task}} thoroughly.");
    const inputs = fetched.body.currentVersion?.definition.inputs as Array<Record<string, unknown>>;
    expect(inputs).toEqual([{ name: "task", type: "text", required: true }]);
  });

  test("update appends a new immutable version; GET reflects the latest", async () => {
    await resetActiveWorkflows(ownerToken);
    const created = await createWorkflowOrThrow(ownerToken, {
      name: "WF-1 versioning",
      definition: singlePromptDefinition("First {{inputs.task}}.", [
        { name: "task", type: "text", required: true },
      ]),
    });
    const updated = await updateWorkflow(ownerToken, created.workflow.id, {
      definition: singlePromptDefinition("Second {{inputs.task}}.", [
        { name: "task", type: "text", required: true },
      ]),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.versions.length).toBe(2);
    expect(updated.body.currentVersion?.versionN).toBe(2);
    const steps = (updated.body.currentVersion?.definition.agents as Array<Record<string, unknown>>)[0]
      .steps as Array<Record<string, unknown>>;
    expect(steps[0].prompt).toBe("Second {{inputs.task}}.");
  });

  test("manual local StartRun with args: pending_delivery run, args interpolated into the resolved plan", async () => {
    await resetActiveWorkflows(ownerToken);
    const created = await createWorkflowOrThrow(ownerToken, {
      name: "WF-1 run",
      definition: singlePromptDefinition("Fix {{inputs.task}} now.", [
        { name: "task", type: "text", required: true },
      ]),
    });
    const run = await startRun(ownerToken, created.workflow.id, {
      targetMode: "local",
      inputs: { task: "the flaky test" },
      workspaceId: randomUUID(), // local target: workspace is the desktop's, not server-validated
    });
    expect(run.status).toBe(200);
    // The seam: a local run is born pending_delivery (the desktop relay delivers);
    // no sandbox is touched, no delivered_at yet.
    expect(run.body.status).toBe("pending_delivery");
    expect(run.body.targetMode).toBe("local");
    expect(run.body.deliveredAt).toBeNull();
    // Args coerced + interpolated into a self-contained resolved plan.
    expect(run.body.args).toEqual({ task: "the flaky test" });
    expect((run.body.resolvedPlan.inputs as Record<string, unknown>).task).toBe("the flaky test");
    const planSteps = run.body.resolvedPlan.steps as Array<Record<string, unknown>>;
    expect(planSteps[0].prompt).toBe("Fix the flaky test now.");

    // Local-lane delivery seam: the owner-authed relay marks the run delivered
    // (the transition the desktop performs after handing the plan to its runtime).
    const delivered = await markRunDelivered(ownerToken, run.body.id);
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe("delivered");
    expect(delivered.body.deliveredAt).not.toBeNull();

    // Idempotent: a second /delivered is a no-op (stays delivered).
    const again = await markRunDelivered(ownerToken, run.body.id);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("delivered");
  });

  test("StartRun rejects a missing required input at the coercion seam (no dangling run row)", async () => {
    await resetActiveWorkflows(ownerToken);
    const created = await createWorkflowOrThrow(ownerToken, {
      name: "WF-1 coercion",
      definition: singlePromptDefinition("Handle {{inputs.task}}.", [
        { name: "task", type: "text", required: true },
      ]),
    });
    const run = await startRun(ownerToken, created.workflow.id, {
      targetMode: "local",
      inputs: {},
      workspaceId: randomUUID(),
    });
    expect(run.status).toBe(400);
    expect((run.body as { detail?: { code?: string } }).detail?.code).toBe("missing_argument");
  });

  test("editor: an invalid step reference surfaces live, blocks Save; fixing it re-enables Save and persists", async ({ page }) => {
    await resetActiveWorkflows(ownerToken);
    const created = await createWorkflowOrThrow(ownerToken, {
      name: "WF-1 editor",
      definition: singlePromptDefinition("Investigate {{inputs.task}} thoroughly.", [
        { name: "task", type: "text", required: true },
      ]),
    });

    await signIn(page);
    await page.goto(`${webBaseUrl()}/workflows/${created.workflow.id}/edit`);

    // The editor loaded the definition: the name field carries the saved name, and
    // with a valid definition there are no issues (Save enabled). The step card is a
    // role=button whose accessible name includes the prompt excerpt — matched
    // precisely (not a bare "Investigate" substring, which also hits sidebar
    // workspace names).
    await expect(page.getByRole("textbox", { name: "Untitled workflow" })).toHaveValue("WF-1 editor", {
      timeout: 30_000,
    });
    const saveButton = page.getByRole("button", { name: "Save", exact: true });
    await expect(saveButton).toBeEnabled();
    const stepCard = page.getByRole("button", { name: /Investigate \{\{inputs\.task\}\} thoroughly/ });
    await expect(stepCard).toBeVisible();

    // Select the step to open its panel, then break the reference: {{inputs.nope}}
    // names an input that does not exist.
    await stepCard.click();
    const promptField = page.getByRole("textbox", { name: "Prompt" });
    await expect(promptField).toBeVisible();
    await promptField.fill("Investigate {{inputs.nope}} thoroughly.");

    // Live validation feedback (client-side, no round trip): the header issue
    // counter appears and Save is disabled.
    await expect(page.getByRole("button", { name: /\d+ issue/ })).toBeVisible();
    await expect(saveButton).toBeDisabled();

    // Fix the reference back to the declared input → issues clear, Save re-enables.
    await promptField.fill("Investigate {{inputs.task}} right now.");
    await expect(page.getByRole("button", { name: /\d+ issue/ })).toHaveCount(0);
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Persisted through the UI save: the API now returns the fixed prompt as the
    // current version.
    await expect(async () => {
      const fetched = await getWorkflow(ownerToken, created.workflow.id);
      const steps = (fetched.body.currentVersion?.definition.agents as Array<Record<string, unknown>>)[0]
        .steps as Array<Record<string, unknown>>;
      expect(steps[0].prompt).toBe("Investigate {{inputs.task}} right now.");
    }).toPass({ timeout: 15_000 });
  });
});

test.describe("T2-WF-5: StartRun binding validation + all-mutations lockout + take-over", () => {
  test("binding an unknown slot is rejected at the service seam", async () => {
    await resetActiveWorkflows(ownerToken);
    const created = await createWorkflowOrThrow(ownerToken, {
      name: "WF-5 unknown slot",
      definition: singlePromptDefinition("Do the work."),
    });
    const run = await startRun(ownerToken, created.workflow.id, {
      targetMode: "local",
      workspaceId: randomUUID(),
      sessionBindings: { ghost_slot: "session-does-not-matter" },
    });
    expect(run.status).toBe(400);
    expect((run.body as { detail?: { code?: string } }).detail?.code).toBe("unknown_session_binding_slot");
  });

  test("a held session locks out a second binding (409), and take-over/cancel releases it", async () => {
    await resetActiveWorkflows(ownerToken);
    const created = await createWorkflowOrThrow(ownerToken, {
      name: "WF-5 lockout",
      definition: singlePromptDefinition("Do the work."),
    });
    // Fresh session id per run so a leftover live run from a prior run on this
    // persisted profile DB can never pre-hold it.
    const sessionId = `wf5-session-${Date.now()}`;

    // Run A binds the session → born pending_delivery, which is a LIVE run that
    // holds the session (the run row is the durable lock, C13/E8).
    const runA = await startRun(ownerToken, created.workflow.id, {
      targetMode: "local",
      workspaceId: randomUUID(),
      sessionBindings: { main: sessionId },
    });
    expect(runA.status).toBe(200);
    expect(runA.body.status).toBe("pending_delivery");

    // A second StartRun binding the SAME session is locked out with the enumerated
    // held code — silently re-owning the session would leak the lockout.
    const blocked = await startRun(ownerToken, created.workflow.id, {
      targetMode: "local",
      workspaceId: randomUUID(),
      sessionBindings: { main: sessionId },
    });
    expect(blocked.status).toBe(409);
    expect((blocked.body as { detail?: { code?: string } }).detail?.code).toBe("session_binding_held");

    // Take over / cancel run A → terminal cancelled, stopped_by_user_id stamped.
    const cancelled = await cancelRun(ownerToken, runA.body.id);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect(cancelled.body.stoppedByUserId).not.toBeNull();
    expect(cancelled.body.finishedAt).not.toBeNull();

    // The terminal write IS the release: a new StartRun binding the same session
    // is now accepted (the hold is gone).
    const runC = await startRun(ownerToken, created.workflow.id, {
      targetMode: "local",
      workspaceId: randomUUID(),
      sessionBindings: { main: sessionId },
    });
    expect(runC.status).toBe(200);
    expect(runC.body.status).toBe("pending_delivery");

    // The cancelled run is genuinely terminal (re-fetch confirms the audit stamp).
    const refetched = await getRun(ownerToken, runA.body.id);
    expect(refetched.body.run.status).toBe("cancelled");
    expect(refetched.body.run.stoppedByUserId).not.toBeNull();

    // Clean up the two live runs this test left holding sessions so the next test's
    // resetActiveWorkflows archive doesn't leave dangling live runs on rerun.
    await cancelRun(ownerToken, runC.body.id);
  });
});

// NOT COVERED here, named so the gaps are loud rather than silent:
// - session_binding_wrong_workspace: fires only for a personal_cloud run whose
//   bound session has run history in a DIFFERENT materialized cloud workspace.
//   Reaching it needs a real materialized cloud workspace + prior session history,
//   both GitHub-fixture/sandbox territory (tier-3), so the foreign-session negative
//   is not asserted at the tier-2 seam.
// - harness mismatch: by design the slot→harness match is validated at the RUNTIME
//   bind boundary (service.py: "Harness-match stays at the runtime bind boundary —
//   a hard Malformed-plan error"), NOT the server service, so there is no tier-2
//   server seam to assert it against; it is a tier-3 runtime concern.
// - cloud-lane StartRun (server wakes the sandbox + POSTs the plan) and run
//   completion: tier-3, per the tier-2 no-sandbox/no-runtime rule.
