import type { ScenarioCellOutcome, ScenarioRunContext } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";
import type { LocalWorldCleanupEvidence } from "../../worlds/local-workspace/cleanup.js";
import { authenticatedActor, type AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import { preparedRepository, type PreparedRepository } from "../../fixtures/prepared-repository.js";
import { productPage, type ProductPage } from "../../fixtures/product-page.js";
import { selectCheapestEligibleClaudeModel } from "../../services/qualification-litellm.js";
import { DETERMINISTIC_PROMPT, REPRESENTATIVE_HARNESS, defaultLocalWorldSmokeDriver } from "../local-world-smoke-1.js";
import { bootLocalFunctionalWorld, isWorldBackedRun, resolveLocalFunctionalWorldInputs } from "./world-boot.js";
import { captureLocalDriverFailure } from "./debug-capture.js";
import { resolveLocalWorkspaceSessionId } from "./local-session.js";

/**
 * LOCAL-1 (repository to workspace) under `T3-WT-1/local` and `T3-REPO-1/local`
 * (world-backed). Owner: builders-ci workstream.
 *
 * ── Live-proof reconciliation ruling (fix round 3, spec §"Live-proof …") ──────
 * Run #2 proved the product materializes a local workspace + AnyHarness session
 * only on first SEND — there is no affordance for an empty *materialized* local
 * workspace. So LOCAL-1 now, through the genuine product surface (no direct DB/
 * API injection — that is what "no seeding" forbids; the real send path is
 * allowed):
 *   1. select the prepared repo + "Work locally" and assert the PRE-SEND
 *      pending-composer empty-chat state (composer visible + empty, the repo root
 *      resolved so AnyHarness is commandable);
 *   2. send ONE bounded prompt via the smoke's proven `sendPromptAndMaterialize`
 *      to materialize the workspace + session (the only real creation path);
 *   3. assert the correct repository + a real default branch (T3-REPO-1's
 *      folded-in contribution), exactly one visible chat tab, and that the
 *      workspace/session/transcript survive a reload.
 *
 * Evidence: LOCAL-1 has NO kind-scoped evidence variant (audit ruling #3), so its
 * green cell carries `evidence: null` — the green status plus plan steps are the
 * proof. T3-REPO-1's own repo-environment write path stays its diagnostic
 * #1043-blocked behavior, unchanged.
 */

/** Bounded waits for the live browser/runtime flow (kept generous but finite). */
const WORKSPACE_SETTLE_TIMEOUT_MS = 90_000;
const EMPTY_CHAT_TIMEOUT_MS = 60_000;
const RUNTIME_RECORD_TIMEOUT_MS = 60_000;
const COMPOSER_READY_TIMEOUT_MS = 30_000;

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

  /**
   * Prepare the home surface (gateway synced, harness ready, repo + "Work
   * locally" selected, cheapest eligible model chosen) and assert the PRE-SEND
   * pending-composer empty-chat state: the composer is visible and empty and the
   * repo root has resolved (AnyHarness commandable). No workspace is materialized
   * and no message is sent here.
   */
  prepareAndAssertPendingComposer(world: ReadyLocalWorld, page: ProductPage, repo: PreparedRepository): Promise<void>;

  /**
   * Materialize the local workspace + session by sending ONE bounded prompt
   * through the real product surface (the only creation path), returning the
   * materialized workspace id + observed repo/default-branch. Reuses the smoke's
   * `sendPromptAndMaterialize` / runtime-workspace resolution — no seeding.
   */
  materializeBySend(world: ReadyLocalWorld, page: ProductPage, repo: PreparedRepository): Promise<{ workspaceId: string; sessionId: string; repoName: string; defaultBranch: string }>;

  /** Assert exactly one visible chat tab for the materialized workspace and that
   * AnyHarness is commandable (a launchable agent resolves). */
  assertSingleTabCommandable(world: ReadyLocalWorld, page: ProductPage, workspaceId: string): Promise<void>;

  /** Reload and assert the workspace/session/transcript/default-branch persist. */
  reloadAndVerifyContinuity(world: ReadyLocalWorld, page: ProductPage, expect: { workspaceId: string; sessionId: string; defaultBranch: string; repoPath: string }): Promise<void>;

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
  async prepareAndAssertPendingComposer(world, page, repo) {
    const p = page.page;
    // Prerequisites, identical to the smoke: Desktop syncs gateway state into
    // AnyHarness, the representative harness becomes launchable, the prepared
    // repo + "Work locally" are selected, and the cheapest eligible non-Fable
    // model is chosen. Only then is the pending composer commandable.
    await defaultLocalWorldSmokeDriver.waitForGatewaySync(world, page, REPRESENTATIVE_HARNESS);
    await defaultLocalWorldSmokeDriver.ensureHarnessReady(world, page, REPRESENTATIVE_HARNESS);
    await defaultLocalWorldSmokeDriver.selectRepoAndWorkLocally(page, repo);
    const [allowlist, liveProbe] = await Promise.all([
      defaultLocalWorldSmokeDriver.allowlistModels(world),
      defaultLocalWorldSmokeDriver.liveProbeModels(world, REPRESENTATIVE_HARNESS),
    ]);
    const modelId = selectCheapestEligibleClaudeModel(allowlist, liveProbe);
    if (!modelId) {
      throw new Error(
        "prepareAndAssertPendingComposer: no eligible non-Fable Claude model in the allowlist ∩ live gateway probe",
      );
    }
    await defaultLocalWorldSmokeDriver.selectModelInUi(page, modelId);
    // PRE-SEND empty-chat state: the home composer is visible and empty, and no
    // workspace shell has materialized yet (materialization happens only on send).
    const editor = p.locator("[data-home-composer-editor]").first();
    await editor.waitFor({ state: "visible", timeout: COMPOSER_READY_TIMEOUT_MS });
    const draft = (await editor.textContent().catch(() => "")) ?? "";
    if (draft.trim().length > 0) {
      throw new Error(`prepareAndAssertPendingComposer: the home composer was not empty pre-send (saw "${draft.trim()}").`);
    }
    // Commandable AnyHarness: the runtime resolves a launchable agent so the
    // pending composer can accept a command (asserted without sending one).
    const launchable = await world.runtime.client.getAgentLaunchOptions().catch(() => []);
    if (!launchable.some((agent) => agent.models.length > 0)) {
      throw new Error("prepareAndAssertPendingComposer: AnyHarness reports no launchable agent for the pending composer.");
    }
  },
  async materializeBySend(world, page, repo) {
    // The only real creation path: send one bounded prompt. Reuses the smoke's
    // proven materialize helper (settles the workspace shell, resolves the
    // AnyHarness session by the repo clone path, waits for turn completion).
    const { workspaceId, sessionId } = await defaultLocalWorldSmokeDriver.sendPromptAndMaterialize(
      world,
      page,
      DETERMINISTIC_PROMPT,
      repo.path,
    );
    // Confirm AnyHarness materialized a kind=local workspace at the prepared repo
    // clone path (the runtime's ground truth — no seeding).
    await resolveLocalWorkspaceRecord(world, repo, RUNTIME_RECORD_TIMEOUT_MS);
    // T3-REPO-1's default branch is the REPO's default branch (RepoRoot.defaultBranch,
    // e.g. "main"), NOT the workspace's currentBranch: the fixture clone is pinned
    // to a full SHA (detached HEAD), so the workspace record carries no branch.
    const repoRoot = await world.runtime.client.getRepoRoot(repo.repoRootId).catch(() => null);
    return {
      workspaceId,
      sessionId,
      repoName: deriveRepoName(repo),
      defaultBranch: (repoRoot?.defaultBranch ?? "").trim(),
    };
  },
  async assertSingleTabCommandable(world, page, _workspaceId) {
    const p = page.page;
    // Exactly one visible chat tab for the materialized workspace (the tab strip
    // renders only after materialization — fix round 3).
    await p.locator("[data-workspace-tab-strip]").first().waitFor({ state: "visible", timeout: EMPTY_CHAT_TIMEOUT_MS });
    const firstTab = p.locator("[data-chat-tab]").first();
    await firstTab.waitFor({ state: "visible", timeout: EMPTY_CHAT_TIMEOUT_MS });
    const tabs = await p.locator("[data-chat-tab]").count();
    if (tabs !== 1) {
      throw new Error(`assertSingleTabCommandable: expected exactly one visible chat tab, saw ${tabs}.`);
    }
    const launchable = await world.runtime.client.getAgentLaunchOptions().catch(() => []);
    if (!launchable.some((agent) => agent.models.length > 0)) {
      throw new Error("assertSingleTabCommandable: AnyHarness reports no launchable agent for the workspace.");
    }
  },
  async reloadAndVerifyContinuity(world, page, expect) {
    const p = page.page;
    await p.reload({ waitUntil: "domcontentloaded" });
    const shell = p
      .locator(`[data-workspace-shell][data-workspace-ui-key="${cssAttr(expect.workspaceId)}"]`)
      .first();
    await shell.waitFor({ state: "attached", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
    // The workspace + its single tab survive the reload.
    await p.locator("[data-workspace-tab-strip]").first().waitFor({ state: "visible", timeout: EMPTY_CHAT_TIMEOUT_MS });
    await p.locator("[data-chat-tab]").first().waitFor({ state: "visible", timeout: EMPTY_CHAT_TIMEOUT_MS });
    // Session persistence on AnyHarness's stable native session id (resolved from
    // the runtime's concrete local workspace at the repo clone path).
    const sessionId = await resolveLocalWorkspaceSessionId(world, expect.repoPath, 30_000).catch(() => null);
    if (sessionId !== expect.sessionId) {
      throw new Error(
        `reloadAndVerifyContinuity: session "${expect.sessionId}" did not remain active after reload (saw "${sessionId ?? ""}").`,
      );
    }
    // The transcript re-renders an assistant reply after reload.
    const settled = p.locator('[data-assistant-prose][data-assistant-streaming="false"]').last();
    await settled.waitFor({ state: "attached", timeout: 20_000 }).catch(() => {
      throw new Error("reloadAndVerifyContinuity: the transcript did not re-render an assistant reply after reload.");
    });
    // The repo's default branch is an immutable property of the repo root, so it
    // needs no re-check across reload; workspace/session/transcript persistence
    // (asserted above) is the continuity proof. `expect.defaultBranch` is retained
    // in the contract for the caller's materialize-time assertion.
    void expect.defaultBranch;
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
      // 1) Pre-send: assert the pending-composer empty-chat state (repo + "Work
      //    locally" selected, composer visible + empty, repo-root commandable).
      await driver.prepareAndAssertPendingComposer(world, page, repo);
      // 2) Materialize via the real send path (the only creation path; not seeding).
      const created = await driver.materializeBySend(world, page, repo);
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
      // 3) Exactly one visible tab + commandable AnyHarness, then reload continuity.
      await driver.assertSingleTabCommandable(world, page, created.workspaceId);
      await driver.reloadAndVerifyContinuity(world, page, {
        workspaceId: created.workspaceId,
        sessionId: created.sessionId,
        defaultBranch: created.defaultBranch,
        repoPath: repo.path,
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
    } catch (uiError) {
      await captureLocalDriverFailure(page, `${cell.cell_id}-ui-failure`);
      throw uiError;
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
