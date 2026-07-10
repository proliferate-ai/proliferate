// T2-WF-2, T2-WF-6, T2-WF-7 (specs/developing/testing/scenarios.md): the poll
// trigger against the intent stub feed (replay-safe seen-set + last_poll_error),
// both /init setup flows, and schedule + poll trigger CRUD incl. missedRunPolicy.
//
// Poll (and cloud-target schedule) triggers derive a server-owned cloud workspace
// from their repo pin (D16), which needs a cloud repo environment — the product's
// cloud repo-add path is GitHub-App-gated and unreachable in tier-2, so
// seedCloudRepoEnvironment inserts the repo environment + a materialized cloud
// workspace directly (the documented direct-DB exception; see seed-workflows.ts).
//
// The poll is driven by invoking the REAL poller tick in a server-venv process
// (runPollerTick) against the profile DB: the automations worker that runs the
// poll loop is not booted by the tier-2 stack and there is no HTTP endpoint for a
// single tick, so this is the honest driving seam (README). It does the real GET
// to the stub feed + real seen-set/cursor/run writes — it fakes nothing.
//
// Free-plan cap (1 active workflow/user) → every workflow-creating test calls
// resetActiveWorkflows first (archive-all → clean slate), rerun-safe.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ensureInstanceClaimed,
  passwordLogin,
} from "../stack/seed.ts";
import {
  createTrigger,
  createWorkflowOrThrow,
  getTrigger,
  inspectPoll,
  listTriggerItems,
  makePollTriggerDue,
  pollFeedUrl,
  readTriggerPollCursor,
  readUserIdForEmail,
  resetActiveWorkflows,
  runPollerTick,
  seedCloudRepoEnvironment,
  setPollFeedFailing,
  singlePromptDefinition,
  updateTrigger,
  type SeededCloudRepo,
} from "../stack/seed-workflows.ts";

test.describe.configure({ mode: "serial" });

const DAILY_RRULE = "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0";

let ownerToken: string;
let ownerUserId: string;
let repo: SeededCloudRepo;

// Inputs matching the stub poll feed's item.data (issue_id: text, count: number).
const POLL_INPUTS = [
  { name: "issue_id", type: "text", required: true },
  { name: "count", type: "number", required: true },
];

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  ownerUserId = await readUserIdForEmail(ADMIN_EMAIL);
  // Fresh repo per run so no cross-run coupling on the derived workspace.
  repo = await seedCloudRepoEnvironment(ownerUserId, "wf-triggers", `feed-${Date.now()}`);
  await setPollFeedFailing(false);
});

test.afterAll(async () => {
  // Leave the shared stub feed healthy for any later run.
  await setPollFeedFailing(false);
});

test.describe("T2-WF-2: poll trigger against the stub feed", () => {
  test("one item row per unique id, invalid item surfaced, cursor advances once, replay-safe, dead endpoint → last_poll_error", async () => {
    await setPollFeedFailing(false);
    await resetActiveWorkflows(ownerToken);
    const workflow = await createWorkflowOrThrow(ownerToken, {
      name: "WF-2 poll",
      definition: singlePromptDefinition("Handle {{inputs.issue_id}} (#{{inputs.count}}).", POLL_INPUTS),
    });

    // Create the poll trigger — the create-time signature probe GETs the reserved
    // /poll-feed/init and passes (the sample matches the derived item schema).
    const created = await createTrigger(ownerToken, workflow.workflow.id, {
      kind: "poll",
      targetMode: "personal_cloud",
      concurrencyPolicy: "skip",
      repoFullName: repo.repoFullName,
      poll: { url: pollFeedUrl(), intervalSecs: 60 },
    });
    expect(created.status).toBe(200);
    expect(created.body.kind).toBe("poll");
    expect(created.body.enabled).toBe(true);
    const triggerId = created.body.id;

    // First real poll pass: the feed serves two valid items + one schema-invalid.
    const tick1 = runPollerTick();
    expect(tick1.ok, `poller tick stderr: ${tick1.stderr}`).toBe(true);
    expect(tick1.spawned).toBe(2);

    // Exactly one seen-set row per unique item id (spawned/spawned/invalid).
    const items1 = await listTriggerItems(ownerToken, workflow.workflow.id, triggerId);
    expect(items1.status).toBe(200);
    expect(items1.body.items).toHaveLength(3);
    const byId = Object.fromEntries(items1.body.items.map((item) => [item.itemId, item]));
    expect(byId["issue-1"].status).toBe("spawned");
    expect(byId["issue-1"].runId).not.toBeNull();
    expect(byId["issue-2"].status).toBe("spawned");
    expect(byId["issue-2"].runId).not.toBeNull();
    // The schema-invalid item (count: "twelve") is recorded invalid + never spawned.
    expect(byId["issue-bad"].status).toBe("invalid");
    expect(byId["issue-bad"].runId).toBeNull();
    expect(byId["issue-bad"].errorMessage).toContain("count");

    // Cursor persisted (advanced NULL → the feed's cursor), no poll error.
    expect(await readTriggerPollCursor(triggerId)).toBe("cursor-1");
    const afterTick1 = await getTrigger(ownerToken, workflow.workflow.id, triggerId);
    expect(afterTick1.body.poll?.lastPollError).toBeNull();
    expect(afterTick1.body.poll?.lastPollAt).not.toBeNull();
    expect(afterTick1.body.enabled).toBe(true);

    // Replay: make the trigger due again (time-shift only) and re-poll the SAME
    // three items. The seen-set PK dedupes them — no new rows, no new runs, and the
    // cursor stays put (it advanced exactly once).
    await makePollTriggerDue(triggerId);
    const tick2 = runPollerTick();
    expect(tick2.ok, `poller tick stderr: ${tick2.stderr}`).toBe(true);
    expect(tick2.spawned).toBe(0);
    const items2 = await listTriggerItems(ownerToken, workflow.workflow.id, triggerId);
    expect(items2.body.items).toHaveLength(3);
    const byId2 = Object.fromEntries(items2.body.items.map((item) => [item.itemId, item]));
    expect(byId2["issue-1"].runId).toBe(byId["issue-1"].runId);
    expect(byId2["issue-2"].runId).toBe(byId["issue-2"].runId);
    expect(await readTriggerPollCursor(triggerId)).toBe("cursor-1");

    // Endpoint down: the feed 503s. The tick records last_poll_error, keeps the
    // cursor, and the trigger STAYS ENABLED (never advances past unread items).
    await setPollFeedFailing(true);
    await makePollTriggerDue(triggerId);
    const tick3 = runPollerTick();
    expect(tick3.ok, `poller tick stderr: ${tick3.stderr}`).toBe(true);
    expect(tick3.spawned).toBe(0);
    const afterDown = await getTrigger(ownerToken, workflow.workflow.id, triggerId);
    expect(afterDown.body.poll?.lastPollError).not.toBeNull();
    expect(afterDown.body.enabled).toBe(true);
    expect(await readTriggerPollCursor(triggerId)).toBe("cursor-1");
    // No new rows spawned by the failed poll.
    const items3 = await listTriggerItems(ownerToken, workflow.workflow.id, triggerId);
    expect(items3.body.items).toHaveLength(3);

    await setPollFeedFailing(false);
  });
});

test.describe("T2-WF-6: both /init setup flows", () => {
  test("flow 1 (workflow-from-poll): /init sample derives scalar inputs, reports non-scalar skipped fields", async () => {
    const result = await inspectPoll(ownerToken, { url: pollFeedUrl() });
    expect(result.status).toBe(200);
    expect(result.body.sampleItemId).toBe("poll-init-sample");
    const derived = Object.fromEntries(result.body.derivedInputs.map((input) => [input.name, input]));
    expect(derived.issue_id.type).toBe("text");
    expect(derived.count.type).toBe("number");
    // The non-scalar sample field (labels: array) can't become an input → surfaced.
    const skipped = result.body.skippedFields.map((field) => field.name);
    expect(skipped).toContain("labels");
    // labels is a non-scalar, so it is NOT among the derived inputs.
    expect(derived).not.toHaveProperty("labels");
  });

  test("flow 1: a dead endpoint at inspect time returns the enumerated poll_probe_failed", async () => {
    // Port 1 refuses connections; the SSRF guard is bypassed under DEBUG so the
    // request is actually attempted and fails at transport.
    const result = await inspectPoll(ownerToken, { url: "http://127.0.0.1:1/poll-feed" });
    expect(result.status).toBe(400);
    expect((result.body as { detail?: { code?: string } }).detail?.code).toBe("poll_probe_failed");
  });

  test("flow 2 (poll-trigger-from-workflow): a mismatched workflow surfaces the field-by-field diff", async () => {
    await resetActiveWorkflows(ownerToken);
    // This workflow declares an input the /init sample does NOT carry, so the
    // create-time signature probe's field-diff must reject it.
    const workflow = await createWorkflowOrThrow(ownerToken, {
      name: "WF-6 mismatch",
      definition: singlePromptDefinition("Need {{inputs.missing_field}}.", [
        { name: "missing_field", type: "text", required: true },
      ]),
    });
    const result = await createTrigger(ownerToken, workflow.workflow.id, {
      kind: "poll",
      targetMode: "personal_cloud",
      concurrencyPolicy: "skip",
      repoFullName: repo.repoFullName,
      poll: { url: pollFeedUrl(), intervalSecs: 60 },
    });
    expect(result.status).toBe(400);
    const detail = (result.body as { detail?: { code?: string; mismatches?: string[] } }).detail;
    expect(detail?.code).toBe("poll_signature_mismatch");
    // The full field-by-field diff rides the wire (mental-model §5 flow 2).
    expect(Array.isArray(detail?.mismatches)).toBe(true);
    expect(detail?.mismatches?.join(" ")).toContain("missing_field");
  });

  test("trigger save's first network call: a dead endpoint at create time is the enumerated poll_probe_failed", async () => {
    await resetActiveWorkflows(ownerToken);
    const workflow = await createWorkflowOrThrow(ownerToken, {
      name: "WF-6 dead endpoint",
      definition: singlePromptDefinition("Handle {{inputs.issue_id}}.", POLL_INPUTS),
    });
    const result = await createTrigger(ownerToken, workflow.workflow.id, {
      kind: "poll",
      targetMode: "personal_cloud",
      concurrencyPolicy: "skip",
      repoFullName: repo.repoFullName,
      poll: { url: "http://127.0.0.1:1/poll-feed", intervalSecs: 60 },
    });
    expect(result.status).toBe(400);
    expect((result.body as { detail?: { code?: string } }).detail?.code).toBe("poll_probe_failed");
  });

  test("fragment and userinfo poll URLs are rejected at save (invalid_poll_config)", async () => {
    await resetActiveWorkflows(ownerToken);
    const workflow = await createWorkflowOrThrow(ownerToken, {
      name: "WF-6 bad url",
      definition: singlePromptDefinition("Handle {{inputs.issue_id}}.", POLL_INPUTS),
    });
    const fragment = await createTrigger(ownerToken, workflow.workflow.id, {
      kind: "poll",
      targetMode: "personal_cloud",
      concurrencyPolicy: "skip",
      repoFullName: repo.repoFullName,
      poll: { url: `${pollFeedUrl()}#frag`, intervalSecs: 60 },
    });
    expect(fragment.status).toBe(400);
    expect((fragment.body as { detail?: { code?: string } }).detail?.code).toBe("invalid_poll_config");

    const userinfo = await createTrigger(ownerToken, workflow.workflow.id, {
      kind: "poll",
      targetMode: "personal_cloud",
      concurrencyPolicy: "skip",
      repoFullName: repo.repoFullName,
      poll: { url: "http://user:pass@127.0.0.1:65500/poll-feed", intervalSecs: 60 },
    });
    expect(userinfo.status).toBe(400);
    expect((userinfo.body as { detail?: { code?: string } }).detail?.code).toBe("invalid_poll_config");
  });
});

test.describe("T2-WF-7: schedule + poll trigger CRUD incl. missedRunPolicy", () => {
  test("schedule triggers accept each missedRunPolicy, default run_latest when omitted, and PATCH round-trips", async () => {
    await resetActiveWorkflows(ownerToken);
    // No declared inputs → the schedule enable-gate (preset every required input)
    // is trivially satisfied. Local target → no cloud workspace needed (2a).
    const workflow = await createWorkflowOrThrow(ownerToken, {
      name: "WF-7 schedule",
      definition: singlePromptDefinition("Run the daily digest."),
    });

    // Omitted → default run_latest.
    const def = await createTrigger(ownerToken, workflow.workflow.id, {
      kind: "schedule",
      targetMode: "local",
      concurrencyPolicy: "skip",
      repoFullName: "acme/repo",
      schedule: { rrule: DAILY_RRULE, timezone: "UTC" },
    });
    expect(def.status).toBe(200);
    expect(def.body.missedRunPolicy).toBe("run_latest");

    for (const policy of ["skip_all", "replay_all", "run_latest"] as const) {
      const created = await createTrigger(ownerToken, workflow.workflow.id, {
        kind: "schedule",
        targetMode: "local",
        concurrencyPolicy: "queue",
        missedRunPolicy: policy,
        repoFullName: "acme/repo",
        schedule: { rrule: DAILY_RRULE, timezone: "UTC" },
      });
      expect(created.status, `missedRunPolicy=${policy}`).toBe(200);
      expect(created.body.missedRunPolicy).toBe(policy);
    }

    // PATCH the first trigger's missedRunPolicy → round-trips.
    const patched = await updateTrigger(ownerToken, workflow.workflow.id, def.body.id, {
      missedRunPolicy: "skip_all",
    });
    expect(patched.status).toBe(200);
    expect(patched.body.missedRunPolicy).toBe("skip_all");
    const refetched = await getTrigger(ownerToken, workflow.workflow.id, def.body.id);
    expect(refetched.body.missedRunPolicy).toBe("skip_all");
  });

  test("an invalid missedRunPolicy value is rejected (422 at the request-model Literal)", async () => {
    await resetActiveWorkflows(ownerToken);
    const workflow = await createWorkflowOrThrow(ownerToken, {
      name: "WF-7 bad policy",
      definition: singlePromptDefinition("Run the daily digest."),
    });
    const result = await createTrigger(ownerToken, workflow.workflow.id, {
      kind: "schedule",
      targetMode: "local",
      concurrencyPolicy: "skip",
      missedRunPolicy: "nonsense" as unknown as "run_latest",
      repoFullName: "acme/repo",
      schedule: { rrule: DAILY_RRULE, timezone: "UTC" },
    });
    // The WorkflowMissedRunPolicy Literal on the request model (models.py) rejects a
    // non-member value with a 422 BEFORE the service's own
    // `invalid_missed_run_policy` (400) can fire — so the enumerated 400 is
    // effectively a defense-in-depth guard for non-HTTP callers, and 422 is the
    // real API rejection.
    expect(result.status).toBe(422);
  });

  test("poll trigger 1d fix: disabling works while the endpoint is down (enabled:false never reprobes)", async () => {
    await setPollFeedFailing(false);
    await resetActiveWorkflows(ownerToken);
    const workflow = await createWorkflowOrThrow(ownerToken, {
      name: "WF-7 poll disable",
      definition: singlePromptDefinition("Handle {{inputs.issue_id}}.", POLL_INPUTS),
    });
    const created = await createTrigger(ownerToken, workflow.workflow.id, {
      kind: "poll",
      targetMode: "personal_cloud",
      concurrencyPolicy: "skip",
      repoFullName: repo.repoFullName,
      poll: { url: pollFeedUrl(), intervalSecs: 60 },
    });
    expect(created.status).toBe(200);

    // Take the endpoint down, then disable the trigger. The 1d fix: PATCH
    // {enabled:false} must NOT reprobe the (now-dead) endpoint — disabling a broken
    // poll trigger is exactly when an operator most needs it to succeed.
    await setPollFeedFailing(true);
    const disabled = await updateTrigger(ownerToken, workflow.workflow.id, created.body.id, {
      enabled: false,
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);

    await setPollFeedFailing(false);
  });
});
