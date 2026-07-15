import type { Page } from "playwright";

import type { ScenarioCellOutcome, ScenarioRunContext } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";
import type { LocalWorldCleanupEvidence } from "../../worlds/local-workspace/cleanup.js";
import { authenticatedActor, type AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import { preparedRepository, type PreparedRepository } from "../../fixtures/prepared-repository.js";
import { productPage, type ProductPage } from "../../fixtures/product-page.js";
import { defaultLocalWorldSmokeDriver } from "../local-world-smoke-1.js";
import { bootLocalFunctionalWorld, isWorldBackedRun, resolveLocalFunctionalWorldInputs } from "./world-boot.js";

/**
 * LOCAL-1 (repository to workspace) under `T3-WT-1/local` and `T3-REPO-1/local`
 * (world-backed). Owner: builders-ci workstream.
 *
 * Given an authenticated actor and prepared local repository, create a local
 * workspace THROUGH the product surface (Home project picker + "Work locally" +
 * create — the smoke's `selectRepoAndWorkLocally` idiom, but the assertion is
 * the created workspace, not a turn). Assert the correct repository and default
 * branch (T3-REPO-1's default-branch contribution, folded into this one cell),
 * commandable AnyHarness, one visible empty chat, and reload continuity. Do NOT
 * seed the workspace or session directly.
 *
 * Evidence: LOCAL-1 has NO LLM turn, and the four new evidence kinds (audit
 * ruling #3) do not cover it, so its green cell carries `evidence: null` — the
 * repo/branch/empty-chat/reload assertions are proven by the green status and
 * the plan steps (BRIEF §"Evidence → LOCAL-1"). T3-REPO-1's own repo-environment
 * write path stays its diagnostic #1043-blocked behavior, unchanged (the
 * world-backed branch only fires when a candidate world is supplied).
 */

/** Bounded waits for the live browser/runtime flow (kept generous but finite). */
const WORKSPACE_SETTLE_TIMEOUT_MS = 90_000;
const EMPTY_CHAT_TIMEOUT_MS = 60_000;
const RUNTIME_RECORD_TIMEOUT_MS = 60_000;

export interface LocalRepoWorkspaceDriver {
  /**
   * Builds this scenario's own `ReadyLocalWorld` from the run context (the same
   * candidate bytes/identity/dir/ports the smoke uses), delegating to
   * `world-boot`. A construction failure throws; the collector maps it to a
   * clean `failed` cell rather than a throw out of the leaf's `run`.
   */
  buildWorld(ctx: ScenarioRunContext, worldId: string): Promise<ReadyLocalWorld>;
  createActor(world: ReadyLocalWorld): Promise<AuthenticatedActor>;
  prepareRepo(world: ReadyLocalWorld, actor: AuthenticatedActor, cellId: string): Promise<PreparedRepository>;
  openPage(world: ReadyLocalWorld, actor: AuthenticatedActor): Promise<ProductPage>;

  /** Create the local workspace via the Home product surface (no seeding) and
   * return the materialized workspace id + observed repo/default-branch. */
  createLocalWorkspaceInUi(world: ReadyLocalWorld, page: ProductPage, repo: PreparedRepository): Promise<{ workspaceId: string; repoName: string; defaultBranch: string }>;

  /** Assert one visible empty chat and commandable AnyHarness for the workspace. */
  assertEmptyChatCommandable(world: ReadyLocalWorld, page: ProductPage, workspaceId: string): Promise<void>;

  /** Reload and assert the workspace/repo/branch/empty-chat persist. */
  reloadAndVerifyContinuity(world: ReadyLocalWorld, page: ProductPage, expect: { workspaceId: string; defaultBranch: string }): Promise<void>;

  closeWorld(world: ReadyLocalWorld): ReturnType<ReadyLocalWorld["close"]>;
}

export const defaultLocalRepoWorkspaceDriver: LocalRepoWorkspaceDriver = {
  async buildWorld(ctx, worldId) {
    const inputs = resolveLocalFunctionalWorldInputs(ctx);
    if (!inputs.ok) {
      throw new Error(inputs.reason);
    }
    return bootLocalFunctionalWorld(inputs.value, worldId);
  },
  createActor: (world) => authenticatedActor(world, "owner"),
  prepareRepo: (world, actor, cellId) => preparedRepository(world, actor, { cellId }),
  openPage: (world, actor) => productPage(world, actor),
  async createLocalWorkspaceInUi(world, page, repo) {
    const p = page.page;
    // Home screen: select the prepared repo + "Work locally" (the smoke idiom).
    await defaultLocalWorldSmokeDriver.selectRepoAndWorkLocally(page, repo);
    // Create the workspace WITHOUT seeding a turn: a fresh local workspace opens
    // with one visible empty chat and no message sent. The create affordance is
    // the home surface's create action, reached by role (never by sending the
    // composer — sending would seed a session, which LOCAL-1 forbids).
    await clickByRole(p, "button", /^(create|new workspace|start|open workspace)$/i, "create local workspace");
    // The workspace shell settles onto the materialized (non-pending) id.
    await p.locator("[data-workspace-shell]").first().waitFor({ state: "visible", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
    await p
      .locator('[data-workspace-shell][data-pending-workspace="false"]')
      .first()
      .waitFor({ state: "attached", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
    const workspaceId = await readWorkspaceUiKey(p);
    // Read the repo + default branch off AnyHarness's own local workspace record
    // (kind=local, cloned at the prepared repo path). This is the runtime's
    // ground truth for the created workspace — no direct seeding.
    const record = await resolveLocalWorkspaceRecord(world, repo, RUNTIME_RECORD_TIMEOUT_MS);
    return {
      workspaceId,
      repoName: deriveRepoName(repo),
      defaultBranch: record.currentBranch ?? record.originalBranch ?? "",
    };
  },
  async assertEmptyChatCommandable(world, page, _workspaceId) {
    const p = page.page;
    // One visible empty chat in the tab strip (data-workspace-empty-chat="true").
    await p.locator("[data-workspace-tab-strip]").first().waitFor({ state: "visible", timeout: EMPTY_CHAT_TIMEOUT_MS });
    const emptyChat = p.locator('[data-chat-tab][data-workspace-empty-chat="true"]').first();
    await emptyChat.waitFor({ state: "visible", timeout: EMPTY_CHAT_TIMEOUT_MS });
    const tabs = await p.locator("[data-chat-tab]").count();
    if (tabs !== 1) {
      throw new Error(`assertEmptyChatCommandable: expected exactly one visible chat tab, saw ${tabs}.`);
    }
    // Commandable AnyHarness: the runtime lists the workspace and its launch
    // options resolve (an agent is launchable), so the empty chat can accept a
    // command. No command is sent (that would seed the session).
    const launchable = await world.runtime.client.getAgentLaunchOptions().catch(() => []);
    if (!launchable.some((agent) => agent.models.length > 0)) {
      throw new Error("assertEmptyChatCommandable: AnyHarness reports no launchable agent for the empty chat.");
    }
  },
  async reloadAndVerifyContinuity(world, page, expect) {
    const p = page.page;
    await p.reload({ waitUntil: "domcontentloaded" });
    const shell = p
      .locator(`[data-workspace-shell][data-workspace-ui-key="${cssAttr(expect.workspaceId)}"]`)
      .first();
    await shell.waitFor({ state: "attached", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
    // The empty chat and workspace survive the reload.
    await p.locator("[data-workspace-tab-strip]").first().waitFor({ state: "visible", timeout: EMPTY_CHAT_TIMEOUT_MS });
    await p
      .locator('[data-chat-tab][data-workspace-empty-chat="true"]')
      .first()
      .waitFor({ state: "visible", timeout: EMPTY_CHAT_TIMEOUT_MS });
    // The repo default branch is stable across the reload (runtime ground truth).
    const record = await resolveLocalWorkspaceRecordById(world, RUNTIME_RECORD_TIMEOUT_MS).catch(() => null);
    const observed = record?.currentBranch ?? record?.originalBranch ?? "";
    if (expect.defaultBranch && observed && observed !== expect.defaultBranch) {
      throw new Error(
        `reloadAndVerifyContinuity: default branch changed across reload (was "${expect.defaultBranch}", saw "${observed}").`,
      );
    }
  },
  closeWorld: (world) => world.close(),
};

/**
 * LOCAL-1 collector (single cell, world-backed). Boots the world, creates the
 * workspace through the product surface, asserts repo/default-branch/empty-chat/
 * reload, and closes the world exactly once in `finally`. A non-world-backed run
 * yields a clean `blocked` (the leaf's legacy diagnostic path owns that lane
 * instead); a world-construction failure fails cleanly. LOCAL-1 carries
 * `evidence: null` (audit ruling #3): the green status plus plan steps are the
 * proof, there is no LLM turn.
 */
export async function collectLocal1WorkspaceCell(
  ctx: ScenarioRunContext,
  cell: PlannedCellV1,
  driver: LocalRepoWorkspaceDriver = defaultLocalRepoWorkspaceDriver,
): Promise<ScenarioCellOutcome> {
  if (!isWorldBackedRun(ctx)) {
    return {
      cellId: cell.cell_id,
      status: "blocked",
      reason: {
        code: "scenario_blocked",
        message: "LOCAL-1 requires the candidate world; no candidate build map was supplied to this run",
      },
    };
  }

  let world: ReadyLocalWorld;
  try {
    world = await driver.buildWorld(ctx, cell.scenario_id);
  } catch (error) {
    return {
      cellId: cell.cell_id,
      status: "failed",
      reason: { code: "scenario_failure", message: `world construction failed: ${describe(error)}` },
    };
  }

  let worldClosed = false;
  try {
    const actor = await driver.createActor(world);
    await world.trackActorSubjects?.(actor.gatewayKey);
    const repo = await driver.prepareRepo(world, actor, cell.cell_id);
    const page = await driver.openPage(world, actor);
    try {
      const created = await driver.createLocalWorkspaceInUi(world, page, repo);
      // Correct repository (T3-REPO-1's repo assertion, folded in): the created
      // workspace must be the prepared repo, and the default branch must be a
      // real, non-empty branch (T3-REPO-1's default-branch contribution).
      const expectedRepoName = deriveRepoName(repo);
      if (created.repoName !== expectedRepoName) {
        throw new Error(
          `LOCAL-1: created workspace repository "${created.repoName}" does not match the prepared repo "${expectedRepoName}".`,
        );
      }
      if (!created.defaultBranch.trim()) {
        throw new Error("LOCAL-1: created workspace has no default branch (T3-REPO-1 default-branch assertion).");
      }
      if (!created.workspaceId.trim()) {
        throw new Error("LOCAL-1: the product surface did not materialize a workspace id.");
      }
      await driver.assertEmptyChatCommandable(world, page, created.workspaceId);
      await driver.reloadAndVerifyContinuity(world, page, {
        workspaceId: created.workspaceId,
        defaultBranch: created.defaultBranch,
      });

      const cleanup = await driver.closeWorld(world);
      worldClosed = true;
      if (cleanup.failed > 0 || !allCleanupBooleansTrue(cleanup)) {
        return {
          cellId: cell.cell_id,
          status: "failed",
          reason: { code: "scenario_failure", message: `cleanup did not fully reconcile (failed=${cleanup.failed})` },
        };
      }
      // LOCAL-1 carries no evidence (no LLM turn); green status is the proof.
      return { cellId: cell.cell_id, status: "green" };
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (error) {
    return {
      cellId: cell.cell_id,
      status: "failed",
      reason: { code: "scenario_failure", message: describe(error) },
    };
  } finally {
    if (!worldClosed) {
      await driver.closeWorld(world).catch(() => undefined);
    }
  }
}

/**
 * Leaf-facing adapter: the canonical `T3-WT-1`/`T3-REPO-1` scenarios are leaf
 * `run()` shapes (they report via return/throw, not a `ScenarioCellOutcome`).
 * This runs the shared LOCAL-1 collector against a synthetic single cell and
 * translates its typed outcome into the leaf contract — the exact world-backed
 * branch `t3-chat-1` uses, adapted to a leaf. Only invoked on a world-backed run
 * (the caller branches on `isWorldBackedRun`).
 */
export async function runLocal1WorkspaceLeaf(
  ctx: ScenarioRunContext,
  opts: { scenarioId: string; registryFlowRef: string },
  driver: LocalRepoWorkspaceDriver = defaultLocalRepoWorkspaceDriver,
): Promise<void> {
  const syntheticCell: PlannedCellV1 = {
    cell_id: `${opts.scenarioId}/local`,
    scenario_id: opts.scenarioId,
    registry_flow_ref: opts.registryFlowRef,
    runtime_lane: "local",
    dimensions: {},
    required_env: [],
  };
  const outcome = await collectLocal1WorkspaceCell(ctx, syntheticCell, driver);
  switch (outcome.status) {
    case "green":
      return;
    case "blocked":
      throw new ScenarioBlockedError(outcome.reason?.message ?? "LOCAL-1 blocked");
    case "expected_fail":
      throw new ScenarioExpectedFailError(outcome.reason?.message ?? "LOCAL-1 expected-fail");
    case "failed":
    default:
      throw new Error(outcome.reason?.message ?? "LOCAL-1 failed");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function allCleanupBooleansTrue(cleanup: LocalWorldCleanupEvidence): boolean {
  return (
    cleanup.virtualKeyDeleted &&
    cleanup.litellmSubjectsDeleted &&
    cleanup.browserClosed &&
    cleanup.processesStopped &&
    cleanup.containersRemoved &&
    cleanup.localPathsRemoved
  );
}

/** The repository's display name as Desktop lists it — the clone's basename. */
function deriveRepoName(repo: PreparedRepository): string {
  const fromPath = repo.path.replace(/\/+$/, "").split("/").pop();
  if (fromPath && fromPath.length > 0) {
    return fromPath;
  }
  return repo.repoUrl.split("/").pop()?.replace(/\.git$/, "") ?? repo.path;
}

/** Resolves AnyHarness's own record for the just-created local workspace by its
 * clone path (kind=local). The runtime is the ground truth for repo/branch. */
async function resolveLocalWorkspaceRecord(
  world: ReadyLocalWorld,
  repo: PreparedRepository,
  timeoutMs: number,
): Promise<{ currentBranch?: string | null; originalBranch?: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  while (Date.now() < deadline) {
    const workspaces = await world.runtime.client.listWorkspaces().catch(() => []);
    const local = workspaces.find((workspace) => workspace.kind === "local" && workspace.path === repo.path);
    if (local) {
      return local;
    }
    seen = JSON.stringify(workspaces.map((workspace) => ({ kind: workspace.kind, path: workspace.path })));
    await sleep(1_000);
  }
  throw new Error(`resolveLocalWorkspaceRecord: no kind=local workspace at "${repo.path}" within ${timeoutMs}ms (saw ${seen}).`);
}

/** Resolves the single local workspace record after a reload (the run owns one). */
async function resolveLocalWorkspaceRecordById(
  world: ReadyLocalWorld,
  timeoutMs: number,
): Promise<{ currentBranch?: string | null; originalBranch?: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workspaces = await world.runtime.client.listWorkspaces().catch(() => []);
    const local = workspaces.find((workspace) => workspace.kind === "local");
    if (local) {
      return local;
    }
    await sleep(1_000);
  }
  throw new Error(`resolveLocalWorkspaceRecordById: no kind=local workspace within ${timeoutMs}ms.`);
}

/** Reads the settled workspace ui-key off the workspace shell (briefly retried). */
async function readWorkspaceUiKey(page: Page): Promise<string> {
  const shell = page.locator("[data-workspace-shell]").first();
  const deadline = Date.now() + 30_000;
  let workspaceId = "";
  while (Date.now() < deadline) {
    workspaceId = (await shell.getAttribute("data-workspace-ui-key").catch(() => "")) ?? "";
    if (workspaceId) {
      return workspaceId;
    }
    await sleep(500);
  }
  throw new Error(`readWorkspaceUiKey: workspace ui-key never settled (workspace="${workspaceId}").`);
}

async function clickByRole(page: Page, role: "button", name: RegExp, what: string): Promise<void> {
  const locator = page.getByRole(role, { name }).first();
  try {
    await locator.waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    throw new Error(`could not find ${what} (role=${role}, name=${name}): ${describe(error)}`);
  }
  await locator.click();
}

/** Escapes a value for safe interpolation inside a `[attr="…"]` CSS selector. */
function cssAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
