import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError } from "../types.js";
import {
  archiveWorkflow,
  createTrigger,
  createWorkflow,
  listRuns,
  openDurableWorkflowClient,
  readWorkflowFixture,
  sleep,
  type WorkflowRunResponse,
} from "../../fixtures/workflows.js";

/**
 * T3-WF-7 — automations (desktop) (`wf-schedule-cloud`, target_mode local).
 * specs/developing/testing/scenarios.md#T3-WF-7
 *
 * Contract: desktop claim → execute → relay → terminal. A `local`-target schedule
 * trigger fires a `claimable` scheduled run (nothing on the server delivers it); a
 * running desktop executor claims it (10s poll), mints a fresh worktree, delivers
 * the resolved plan to its own local AnyHarness runtime, and relays observed state
 * (`/status`) back to the server until the run reaches a terminal status. This
 * asserts that whole chain FOR REAL from the server run rows — never transcript
 * text.
 *
 * LOCAL lane only, and NOT a CI gate (guarded to blocked under CI / the sandbox
 * runtime lane): there is no headless desktop lane in CI. On a dev machine it runs
 * for real and drives every hop itself.
 *
 * ── Runbook (dev machine) ────────────────────────────────────────────────────
 * 1. Boot the stack:  `SINGLE_ORG_MODE=true make run PROFILE=<profile>`
 *    (SINGLE_ORG_MODE lets the durable password user reach cloud product surfaces
 *    without a GitHub link — the local_dev posture; without it every workflow call
 *    403s `github_link_required`). The runtime must resolve an `anthropic-oauth`
 *    or `anthropic-api` context for the claude/haiku fixture — i.e. a logged-in
 *    `claude` CLI, and NO `CLAUDE_CODE_USE_BEDROCK=1` in the runtime's env (a
 *    Bedrock context gates the anthropic-oauth-only haiku model → the run would
 *    fail `session_start_failed: ModelGated`).
 * 2. Export the durable identity + local seams:
 *      RELEASE_E2E_SERVER_URL=http://127.0.0.1:<API_PORT>
 *      RELEASE_E2E_DURABLE_USER_EMAIL / _PASSWORD / _ORG_ID   (the claimed owner)
 *      RELEASE_E2E_LOCAL_DATABASE_URL=postgresql+asyncpg://…/proliferate_dev_<profile>
 *      RELEASE_E2E_LOCAL_RUNTIME_URL=http://127.0.0.1:<ANYHARNESS_PORT>
 *      RELEASE_E2E_DESKTOP_WEB_URL=http://127.0.0.1:<PROLIFERATE_WEB_PORT>  (default 1604)
 * 3. Run it:  `pnpm -C tests/release exec tsx src/cli/run.ts --lane local --scenarios T3-WF-7`
 *
 * The scenario stands up the two prerequisites `make run` does not:
 *   - the workflow schedule beat (`scripts/workflow_scheduler_beat.py`, via the
 *     server venv) — `make run` starts no automation/workflow worker, and the full
 *     worker entrypoint is currently import-broken;
 *   - the desktop executor itself (`scripts/desktop-executor-driver.mjs`), a
 *     headless Chromium signed in to the desktop WEB build — the claim poller that
 *     IS the desktop executor.
 * It then registers a local repo clone matching the trigger's repo pin (so the
 * claim's D16 repo resolution finds a worktree), creates the workflow + a 1-per-
 * hour `local` schedule trigger (v1 rejects minutely), backdates the trigger's
 * cursor in the DB so the very next beat fires a run (the honest time-shift seam,
 * `workflow_probe.py backdate-schedule-cursor`), then waits for the run to be
 * claimed and reach terminal, asserting from the run rows.
 */

const DEFAULT_DESKTOP_WEB_URL = "http://127.0.0.1:1604";
const DEFAULT_LOCAL_RUNTIME_URL = "http://127.0.0.1:8542";
const RUN_TERMINAL = new Set(["completed", "failed", "cancelled"]);
// Statuses only reachable AFTER a desktop executor claimed the run (a scheduled
// local run leaves `claimable` only by being claimed + delivered + relayed).
const POST_CLAIM_STATUSES = new Set([
  "claimed",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

export const t3Wf7: ScenarioDefinition = {
  id: "T3-WF-7",
  title: "automations (desktop) — local schedule trigger",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WF-7",
  lanes: ["local"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
    // The desktop lane needs the DB seam (time-shift the scheduler cursor) and the
    // local runtime (register the repo clone the claim resolves) — both local-only.
    "RELEASE_E2E_LOCAL_DATABASE_URL",
    "RELEASE_E2E_LOCAL_RUNTIME_URL",
    "RELEASE_E2E_DESKTOP_WEB_URL",
  ],
  plan: () => [
    { description: "[local dev-profile only] register a local repo clone matching the trigger repo pin" },
    { description: "create wf-schedule-cloud + a 1-per-hour `local` schedule trigger; assert next_run_at" },
    { description: "spawn the workflow schedule beat + the headless desktop executor (claim poller)" },
    { description: "backdate the trigger cursor so the beat fires a claimable run this tick" },
    { description: "assert the desktop executor claims → delivers → relays → the run reaches terminal (prefer completed)" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane === "staging") {
      throw new ScenarioBlockedError(
        "T3-WF-7/staging: the desktop executor lane is local dev-profile only — there is no staging desktop.",
      );
    }
    if (ctx.runtimeLane === "sandbox" || isCi()) {
      throw new ScenarioBlockedError(
        "T3-WF-7: no headless desktop lane exists in CI. The desktop-executor claim→execute→relay path needs the " +
          "dev stack + a signed-in desktop web session; it is not a CI gate. Run it locally with the stack up " +
          "(see the scenario docstring runbook).",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const databaseUrl = ctx.env.require("RELEASE_E2E_LOCAL_DATABASE_URL");
    const runtimeUrl = (ctx.env.get("RELEASE_E2E_LOCAL_RUNTIME_URL") ?? DEFAULT_LOCAL_RUNTIME_URL).replace(/\/$/, "");
    const desktopWebUrl = (process.env.RELEASE_E2E_DESKTOP_WEB_URL ?? DEFAULT_DESKTOP_WEB_URL).replace(/\/$/, "");
    const repoFullName = process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? "proliferate-e2e/e2e-fixture";
    const repoRoot = repoRootDir();

    await assertReachable(`${serverUrl}/health`, "the API server");
    await assertReachable(`${runtimeUrl}/health`, "the local AnyHarness runtime");
    await assertReachable(desktopWebUrl, "the desktop web build");

    // (1) Register a local clone of the pinned repo so the claim's D16 repo
    //     resolution finds a worktree to mint. Idempotent: a re-run reuses the row.
    await registerLocalRepo(runtimeUrl, repoFullName, repoRoot);

    const client = await openDurableWorkflowClient(serverUrl);
    const definition = await readWorkflowFixture("wf-schedule-cloud");
    const created = await createWorkflow(client, definition, { nameSuffix: "wf7" });
    const children: ChildProcess[] = [];

    try {
      // (2) A `local` schedule trigger — 1 per hour (v1 rejects minutely). The pin
      //     is authored, no cloud workspace provisioned (local target).
      const trigger = await createTrigger(client, created.workflow.id, {
        kind: "schedule",
        concurrencyPolicy: "queue",
        missedRunPolicy: "run_latest",
        targetMode: "local",
        repoFullName,
        schedule: { rrule: "FREQ=HOURLY;INTERVAL=1", timezone: "UTC" },
      });
      assert.equal(trigger.targetMode, "local", "T3-WF-7: trigger target_mode must be local (desktop)");
      assert.ok(trigger.nextRunAt, "T3-WF-7: schedule trigger must stamp next_run_at");
      console.log(`[T3-WF-7] local schedule trigger ${trigger.id} created; next_run_at=${trigger.nextRunAt}.`);

      // (3) Stand up the beat + the desktop executor. `make run` starts neither.
      children.push(spawnSchedulerBeat(databaseUrl, serverUrl));
      const driver = spawnDesktopExecutor({ serverUrl, desktopWebUrl });
      children.push(driver);
      await waitForExecutorWarmup(driver);

      // (4) Time-shift the cursor so the next beat tick fires a run now.
      const backdate = runBackdate(databaseUrl, trigger.id);
      assert.equal(backdate.updated, 1, "T3-WF-7: backdate must move exactly this trigger's cursor");
      console.log(`[T3-WF-7] cursor backdated to ${backdate.nextRunAt}; awaiting the beat + desktop claim.`);

      // (5) Wait for the scheduled run to be claimed by the desktop executor and
      //     driven to terminal. Assert purely from the run rows.
      const observed = await awaitScheduledRunTerminal(client, created.workflow.id, {
        timeoutMs: 240_000,
      });
      assert.ok(
        observed.run,
        "T3-WF-7: no scheduled run appeared — is the schedule beat firing? (check backdate + beat child)",
      );
      const statuses = [...observed.statusesSeen].join(",");
      assert.ok(
        [...observed.statusesSeen].some((s) => POST_CLAIM_STATUSES.has(s)),
        `T3-WF-7: the run never left claimable — the desktop executor did not claim it (statuses seen: ${statuses}).`,
      );
      assert.ok(
        RUN_TERMINAL.has(observed.run.status),
        `T3-WF-7: run did not reach a terminal status in budget (last=${observed.run.status}, seen: ${statuses}).`,
      );
      // The claim → deliver → relay → terminal chain executed. `failed` with a real
      // agent error still proves the mechanical chain, but the trivial fixture
      // should reliably complete — surface which happened.
      if (observed.run.status === "completed") {
        console.log(
          `[T3-WF-7] PASS: scheduled local run ${observed.run.id} was claimed by the desktop executor, ` +
            `delivered to the local runtime, relayed, and COMPLETED (statuses: ${statuses}).`,
        );
      } else {
        console.log(
          `[T3-WF-7] PASS (mechanical): run ${observed.run.id} completed the claim→deliver→relay→terminal chain ` +
            `but ended ${observed.run.status} (${observed.run.errorCode ?? "no code"}). Statuses: ${statuses}.`,
        );
      }
    } finally {
      for (const child of children) {
        killChild(child);
      }
      await archiveWorkflow(client, created.workflow.id);
    }
  },
};

// ── run polling ────────────────────────────────────────────────────────────

interface ScheduledRunObservation {
  run: WorkflowRunResponse | null;
  statusesSeen: Set<string>;
}

/**
 * Poll the workflow's runs until the scheduled (non-`missed`) run reaches a
 * terminal status or the budget elapses. `run_latest` records older slots as
 * `missed` history rows; the ONE fired slot is the run the desktop executor
 * claims — track it and record every status it passes through.
 */
async function awaitScheduledRunTerminal(
  client: Parameters<typeof listRuns>[0],
  workflowId: string,
  options: { timeoutMs: number },
): Promise<ScheduledRunObservation> {
  const statusesSeen = new Set<string>();
  const deadline = Date.now() + options.timeoutMs;
  let tracked: WorkflowRunResponse | null = null;
  while (Date.now() < deadline) {
    const { runs } = await listRuns(client, workflowId);
    // The fired slot: the newest run that is not a `missed` history row.
    const active = runs
      .filter((r) => r.status !== "missed")
      .sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""))
      .pop();
    if (active) {
      tracked = active;
      statusesSeen.add(active.status);
      if (RUN_TERMINAL.has(active.status)) {
        return { run: active, statusesSeen };
      }
    }
    await sleep(4000);
  }
  return { run: tracked, statusesSeen };
}

// ── child processes ──────────────────────────────────────────────────────────

function repoRootDir(): string {
  return path.resolve(import.meta.dirname, "../../../../..");
}

function serverVenvPython(): string {
  return path.join(repoRootDir(), "server", ".venv", "bin", "python");
}

function spawnSchedulerBeat(databaseUrl: string, serverUrl: string): ChildProcess {
  const script = path.join(repoRootDir(), "tests", "release", "scripts", "workflow_scheduler_beat.py");
  const child = spawn(serverVenvPython(), [script, "--interval-seconds", "5"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      // The run's per-run gateway grant needs a reachable cloud base URL at fire
      // time, else the fire raises `cloud_worker_misconfigured` and no run is made.
      API_BASE_URL: serverUrl,
      CLOUD_WORKER_BASE_URL: serverUrl,
      DEBUG: "true",
      SINGLE_ORG_MODE: "true",
      PROLIFERATE_DEV: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeChild(child, "beat");
  return child;
}

function spawnDesktopExecutor(args: { serverUrl: string; desktopWebUrl: string }): ChildProcess {
  const script = path.join(repoRootDir(), "tests", "release", "scripts", "desktop-executor-driver.mjs");
  const child = spawn("node", [script, "--max-seconds=300"], {
    env: {
      ...process.env,
      RELEASE_E2E_SERVER_URL: args.serverUrl,
      RELEASE_E2E_DESKTOP_WEB_URL: args.desktopWebUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeChild(child, "driver");
  return child;
}

/** Resolve once the executor's page has mounted and issued its first claim poll
 * (so a backdated run is claimed promptly), or after a bounded warmup fallback. */
async function waitForExecutorWarmup(driver: ChildProcess): Promise<void> {
  const seen = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 60_000);
    const onData = (chunk: Buffer) => {
      if (/claim poll #1/.test(String(chunk))) {
        clearTimeout(timer);
        driver.stdout?.off("data", onData);
        resolve(true);
      }
    };
    driver.stdout?.on("data", onData);
  });
  // A short settle so the poller is firmly in its interval before the run appears.
  await sleep(seen ? 2000 : 5000);
}

function runBackdate(databaseUrl: string, triggerId: string): { updated: number; nextRunAt: string } {
  const script = path.join(repoRootDir(), "tests", "release", "scripts", "workflow_probe.py");
  const result = spawnSync(serverVenvPython(), [script, "backdate-schedule-cursor", triggerId, "2"], {
    cwd: path.join(repoRootDir(), "server"),
    // DEBUG so Settings() does not demand a production jwt_secret; the probe only
    // reads DATABASE_URL for the DB session.
    env: { ...process.env, DATABASE_URL: databaseUrl, DEBUG: "true" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`backdate-schedule-cursor failed: ${result.stderr || result.stdout}`);
  }
  const line = result.stdout.trim().split("\n").pop() ?? "{}";
  return JSON.parse(line) as { updated: number; nextRunAt: string };
}

function pipeChild(child: ChildProcess, tag: string): void {
  const emit = (chunk: Buffer) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim()) {
        console.log(`[T3-WF-7:${tag}] ${line}`.slice(0, 400));
      }
    }
  };
  child.stdout?.on("data", emit);
  child.stderr?.on("data", emit);
}

function killChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // already gone
  }
}

// ── local repo registration ────────────────────────────────────────────────

let cachedRepoDir: string | null = null;

/**
 * Create a throwaway local git repo whose `origin` remote matches `repoFullName`
 * and register it with the local runtime (`POST /v1/workspaces`), which derives a
 * repo root (provider/owner/name) the desktop claim poller lists as a candidate.
 * The claim's repo pin resolves to this clone, so a worktree can be minted.
 */
async function registerLocalRepo(runtimeUrl: string, repoFullName: string, _repoRoot: string): Promise<void> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) {
    throw new Error(`RELEASE_E2E_GITHUB_TEST_REPO must be owner/repo, got ${repoFullName}`);
  }
  const dir = cachedRepoDir ?? mkdtempSync(path.join(tmpdir(), "wf7-fixture-"));
  cachedRepoDir = dir;
  const git = (...gitArgs: string[]) => {
    const r = spawnSync("git", gitArgs, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0 && !/already exists|reinitialized/i.test(r.stderr)) {
      // Non-fatal for idempotent re-inits; surface only genuine failures below.
      return r;
    }
    return r;
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "e2e@proliferate.dev");
  git("config", "user.name", "release-e2e");
  spawnSync("bash", ["-c", "echo fixture > README.md"], { cwd: dir });
  git("add", "-A");
  git("commit", "-qm", "wf7 fixture");
  // Point origin at the pinned GitHub repo so the runtime classifies the remote as
  // github owner/name. Reset if it already exists (idempotent re-run).
  git("remote", "remove", "origin");
  git("remote", "add", "origin", `git@github.com:${owner}/${name}.git`);

  const res = await fetch(`${runtimeUrl}/v1/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: dir }),
  });
  if (!res.ok) {
    throw new Error(`registering local repo with the runtime failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { repoRoot?: { remoteOwner?: string; remoteRepoName?: string } };
  console.log(
    `[T3-WF-7] local repo registered: ${body.repoRoot?.remoteOwner}/${body.repoRoot?.remoteRepoName} (${dir}).`,
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function assertReachable(url: string, what: string): Promise<void> {
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok && res.status !== 404) {
      throw new Error(`status ${res.status}`);
    }
  } catch (error) {
    throw new ScenarioBlockedError(
      `T3-WF-7: ${what} is not reachable at ${url} (${error instanceof Error ? error.message : String(error)}). ` +
        "Boot the stack per the scenario docstring runbook before running the local desktop lane.",
    );
  }
}

function isCi(): boolean {
  return process.env.CI === "true" || process.env.CI === "1";
}
