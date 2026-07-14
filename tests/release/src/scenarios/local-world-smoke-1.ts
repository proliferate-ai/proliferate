import { createHash } from "node:crypto";

import type {
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioDefinition,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { CellEvidenceV1, LocalWorkspaceTurnEvidenceV1 } from "../evidence/schema.js";
import { authenticatedActor, type AuthenticatedActor } from "../fixtures/authenticated-actor.js";
import { preparedRepository, type PreparedRepository } from "../fixtures/prepared-repository.js";
import { productPage, type ProductPage } from "../fixtures/product-page.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import type { PlannedCellV1 } from "../runner/result.js";
import { selectCheapestEligibleClaudeModel } from "../services/qualification-litellm.js";
import {
  constructLocalWorld,
  type LocalWorldPorts,
  type ReadyLocalWorld,
} from "../worlds/local-workspace/world.js";

/**
 * LOCAL-WORLD-SMOKE-1 (spec "The single test cell"). A provisional
 * infrastructure proof — NOT the canonical `LOCAL-2` guarantee. One matrix cell
 * on the local lane, dimension `harness=claude`, giving the canonical id
 * `LOCAL-WORLD-SMOKE-1/local/harness=claude`. Claude is the representative
 * harness; the exact model stays live-probed and cheapest-eligible non-Fable.
 *
 * The cell drives, against a `ReadyLocalWorld` constructed from the exact
 * candidate bytes:
 *   1. create the fresh owner actor;
 *   2. wait for the Server-created LiteLLM enrollment and select the gateway route;
 *   3. prepare + register the run-scoped repository;
 *   4. open the Desktop renderer and wait until Desktop has synchronized gateway
 *      state into AnyHarness;
 *   5. select the prepared repo and choose "Work locally" in the UI;
 *   6. create a workspace and session in the UI;
 *   7. choose the cheapest eligible non-Fable Claude model from the intersection
 *      of the qualification allowlist and AnyHarness's live gateway probe;
 *   8. send a bounded deterministic prompt, require a stable assistant answer;
 *   9. reload/reopen and require workspace/session/transcript/harness/model to
 *      remain visible; and
 *  10. correlate exactly this turn with one or more new LiteLLM spend rows.
 *
 * The green outcome carries a complete `LocalWorkspaceTurnEvidenceV1` (attached
 * through the runner's extended matrix outcome — see BRIEF "Runner amendments").
 * Cleanup runs in `finally` and its evidence is folded into that same block.
 *
 * ── Cross-workstream input gap beyond BRIEF §7 (disclosed; see final report) ──
 * BRIEF §7 documents two additive `ScenarioRunContext`/`ScenarioCellOutcome`
 * seams (`candidateBuildMap`, `evidence?`) owned by workstream C. Building a
 * `ReadyLocalWorld` also needs the resolved `RunIdentityV1`, a run/shard-scoped
 * `runDir`, and pre-allocated `LocalWorldPorts` (`ConstructLocalWorldOptions`,
 * `world.ts`) — none of which `ScenarioRunContext` carries today, and none of
 * which this workstream owns to add. This module reads them off a local bridge
 * type (`LocalWorldSmokeRunContext`) rather than inventing its own duplicate
 * identity/port-allocation machinery; when they are absent the cell fails
 * cleanly with a bounded reason instead of throwing (see
 * `resolveWorldConstructionInputs`).
 */

export const LOCAL_WORLD_SMOKE_1_ID = "LOCAL-WORLD-SMOKE-1";
export const REPRESENTATIVE_HARNESS = "claude";
export const DETERMINISTIC_PROMPT = "Reply with exactly the word: pong";

/**
 * Bridge type for the world-construction inputs noted above. `candidateBuildMap`
 * (BRIEF §7a) is now a first-class field of `ScenarioRunContext`, threaded by
 * the runner; `runIdentity`/`runDir`/`ports` are NOT yet part of that context
 * (see module doc) and remain optional additions read off this bridge — the
 * cell fails cleanly with a bounded reason when they are absent.
 */
export interface LocalWorldSmokeRunContext extends ScenarioRunContext {
  /** Not yet part of `ScenarioRunContext` — see module doc. */
  runIdentity?: RunIdentityV1;
  /** Not yet part of `ScenarioRunContext` — see module doc. */
  runDir?: string;
  /** Not yet part of `ScenarioRunContext` — see module doc. */
  ports?: LocalWorldPorts;
}

type ScenarioCellOutcomeWithEvidence = ScenarioCellOutcome & { evidence?: CellEvidenceV1 };

export const localWorldSmoke1: ScenarioDefinition = {
  id: LOCAL_WORLD_SMOKE_1_ID,
  kind: "matrix",
  title: "prove one real local workspace turn: exact candidate bytes → gateway turn → correlated spend",
  registryFlowRef: "specs/developing/testing/flows.md#local-world-smoke",
  lanes: ["local"],
  requiredEnv: [
    "AGENT_GATEWAY_LITELLM_BASE_URL",
    "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
  ],
  expandCells: (): ScenarioCellSpec[] => [{ dimensions: { harness: REPRESENTATIVE_HARNESS } }],
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => [
    { description: `[${cell.cell_id}] build the exact candidate three-artifact local world` },
    { description: `[${cell.cell_id}] create the fresh owner actor (setup claim + password login)` },
    { description: `[${cell.cell_id}] wait for Server-created LiteLLM enrollment and select the gateway route` },
    { description: `[${cell.cell_id}] prepare + register the run-scoped repository` },
    { description: `[${cell.cell_id}] open the Desktop renderer and wait for gateway state synced to AnyHarness` },
    { description: `[${cell.cell_id}] select the repository and choose "Work locally" in the UI` },
    { description: `[${cell.cell_id}] create a workspace and session in the UI` },
    { description: `[${cell.cell_id}] choose the cheapest eligible non-Fable Claude model (allowlist ∩ live probe)` },
    { description: `[${cell.cell_id}] send a bounded deterministic prompt and require a stable assistant reply` },
    { description: `[${cell.cell_id}] reload/reopen and require workspace/session/transcript/model to persist` },
    { description: `[${cell.cell_id}] correlate the turn with new LiteLLM spend rows for the actor key` },
    { description: `[${cell.cell_id}] clean up every run-owned resource, in reverse order` },
  ],
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> => {
    const driver = defaultLocalWorldSmokeDriver;
    const outcomes: ScenarioCellOutcomeWithEvidence[] = [];
    for (const cell of cells) {
      outcomes.push(await runLocalWorldSmokeCell(cell, ctx as LocalWorldSmokeRunContext, driver));
    }
    return outcomes;
  },
};

/** Structural subset of `QualificationLiteLlmConfig` this scenario reads out of `ctx.env`. */
export interface QualificationLiteLlmConfigLike {
  adminBaseUrl: string;
  publicBaseUrl: string;
  masterKey: string;
}

/**
 * Every privileged/stateful step the cell performs, factored out so unit
 * tests can fake the world/fixtures/browser/gateway entirely (spec/BRIEF:
 * "unit tests are deterministic and offline"). Production wiring
 * (`defaultLocalWorldSmokeDriver`) calls the real world/fixture/controller
 * functions this workstream and workstream A own.
 */
export interface LocalWorldSmokeDriver {
  buildWorld(inputs: {
    map: CandidateBuildMapV1;
    litellm: QualificationLiteLlmConfigLike;
    run: RunIdentityV1;
    runDir: string;
    ports: LocalWorldPorts;
  }): Promise<ReadyLocalWorld>;
  createActor(world: ReadyLocalWorld): Promise<AuthenticatedActor>;
  prepareRepo(world: ReadyLocalWorld, actor: AuthenticatedActor, cellId: string): Promise<PreparedRepository>;
  openPage(world: ReadyLocalWorld, actor: AuthenticatedActor): Promise<ProductPage>;
  /** Selects the prepared repo and clicks "Work locally"; returns the created workspace id. */
  selectRepoAndWorkLocally(page: ProductPage, repo: PreparedRepository): Promise<{ workspaceId: string }>;
  /** Creates a session for the given harness in the UI. */
  createSession(page: ProductPage, harnessKind: string): Promise<{ sessionId: string }>;
  /** AnyHarness's live-probed gateway model ids for the harness. */
  liveProbeModels(world: ReadyLocalWorld, harnessKind: string): Promise<string[]>;
  /** The qualification allowlist, cheapest-first (from controller preflight). */
  allowlistModels(world: ReadyLocalWorld): Promise<string[]>;
  /** Selects `modelId` via the composer's model picker. */
  selectModelInUi(page: ProductPage, modelId: string): Promise<void>;
  /** Sends the prompt and returns the observed assistant reply text. */
  sendPromptAndAwaitReply(page: ProductPage, prompt: string): Promise<string>;
  /** Reloads the page and asserts workspace/session/transcript/model survive. */
  reopenAndVerify(
    page: ProductPage,
    expectations: { workspaceId: string; sessionId: string; modelId: string; harnessKind: string },
  ): Promise<void>;
  snapshotSpend(
    world: ReadyLocalWorld,
    actor: AuthenticatedActor,
  ): ReturnType<ReadyLocalWorld["gateway"]["snapshotSpend"]>;
  correlateTurn(
    world: ReadyLocalWorld,
    params: {
      actor: AuthenticatedActor;
      before: Awaited<ReturnType<ReadyLocalWorld["gateway"]["snapshotSpend"]>>;
      acceptedModelId: string;
      windowStartedAt: string;
      windowFinishedAt: string;
    },
  ): ReturnType<ReadyLocalWorld["gateway"]["correlateTurn"]>;
  closeWorld(world: ReadyLocalWorld): ReturnType<ReadyLocalWorld["close"]>;
}

export const defaultLocalWorldSmokeDriver: LocalWorldSmokeDriver = {
  buildWorld: ({ map, litellm, run, runDir, ports }) => constructLocalWorld({ run, map, litellm, runDir, ports }),
  createActor: (world) => authenticatedActor(world, "owner"),
  prepareRepo: (world, actor, cellId) => preparedRepository(world, actor, { cellId }),
  openPage: (world, actor) => productPage(world, actor),
  async selectRepoAndWorkLocally(page, repo) {
    // Best-effort, resilient (role/text-based) selectors — see the module doc
    // and this workstream's final report: production `data-testid`s are
    // almost nonexistent in apps/desktop/src (verified 2026-07-14), so these
    // rely on stable copy (`homeRepoLaunchKindLabel` /
    // `apps/desktop/src/lib/domain/home/home-target-picker.ts`) that MUST be
    // confirmed against a live render before this cell is trusted.
    const repoName = repo.repoUrl.split("/").pop()?.replace(/\.git$/, "") ?? repo.path;
    await page.page.getByText(repoName, { exact: false }).first().click();
    await page.page.getByRole("button", { name: /Work locally/i }).click();
    const workspaceId = await page.page.evaluate(() => {
      const marker = document.querySelector("[data-workspace-id]");
      return marker?.getAttribute("data-workspace-id") ?? "";
    });
    if (!workspaceId) {
      throw new Error("selectRepoAndWorkLocally: could not read the created workspace id from the UI.");
    }
    return { workspaceId };
  },
  async createSession(page, harnessKind) {
    void harnessKind;
    const sessionId = await page.page.evaluate(() => {
      const marker = document.querySelector("[data-session-id]");
      return marker?.getAttribute("data-session-id") ?? "";
    });
    if (!sessionId) {
      throw new Error("createSession: could not read the created session id from the UI.");
    }
    return { sessionId };
  },
  liveProbeModels: async (world, harnessKind) => {
    const models = await world.runtime.client.getGatewayModels(harnessKind);
    return models.map((model) => model.id);
  },
  allowlistModels: async (world) => {
    const preflight = await world.gateway.preflight();
    return preflight.eligibleClaudeModels;
  },
  async selectModelInUi(page, modelId) {
    await page.page.getByRole("button", { name: /^Model:/ }).click();
    await page.page.getByRole("option", { name: modelId, exact: false }).click();
  },
  async sendPromptAndAwaitReply(page, prompt) {
    await page.page.getByPlaceholder(/Describe a task/i).fill(prompt);
    await page.page.getByRole("button", { name: "Send message" }).click();
    // Wait for the turn to end: the "Stop run" control appears while the
    // model is generating and disappears again once the turn completes.
    const stopButton = page.page.getByRole("button", { name: "Stop run" });
    await stopButton.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    await stopButton.waitFor({ state: "hidden", timeout: 60_000 });
    const reply = await page.page.evaluate(() => {
      const marker = document.querySelector("[data-last-assistant-reply]");
      return marker?.textContent?.trim() ?? "";
    });
    if (!reply) {
      throw new Error("sendPromptAndAwaitReply: no assistant reply observed after the turn ended.");
    }
    return reply;
  },
  async reopenAndVerify(page, expectations) {
    await page.page.reload({ waitUntil: "domcontentloaded" });
    const stillVisible = await page.page.evaluate(
      (ids) => {
        const workspace = document.querySelector(`[data-workspace-id="${ids.workspaceId}"]`);
        const session = document.querySelector(`[data-session-id="${ids.sessionId}"]`);
        return Boolean(workspace) && Boolean(session);
      },
      { workspaceId: expectations.workspaceId, sessionId: expectations.sessionId },
    );
    if (!stillVisible) {
      throw new Error(
        `reopenAndVerify: workspace "${expectations.workspaceId}" / session "${expectations.sessionId}" ` +
          "did not remain visible after reopen.",
      );
    }
  },
  snapshotSpend: (world, actor) => world.gateway.snapshotSpend(actor.gatewayKey),
  correlateTurn: (world, params) =>
    world.gateway.correlateTurn({
      actor: params.actor.gatewayKey,
      before: params.before,
      acceptedModelId: params.acceptedModelId,
      windowStartedAt: params.windowStartedAt,
      windowFinishedAt: params.windowFinishedAt,
    }),
  closeWorld: (world) => world.close(),
};

/**
 * The real per-cell orchestration, independent of the matrix plumbing so it
 * is directly unit-testable against a fake `LocalWorldSmokeDriver`. Builds the
 * world first; if construction inputs are missing or world startup fails, the
 * cell fails cleanly (spec failure table) rather than throwing out of
 * `runCells` and losing every sibling result. World `close()` always runs
 * exactly once, and its cleanup evidence is folded into the green evidence
 * block (or reported alongside a failure that reached that point).
 */
export async function runLocalWorldSmokeCell(
  cell: PlannedCellV1,
  ctx: LocalWorldSmokeRunContext,
  driver: LocalWorldSmokeDriver,
): Promise<ScenarioCellOutcomeWithEvidence> {
  const inputs = resolveWorldConstructionInputs(ctx);
  if (!inputs.ok) {
    return { cellId: cell.cell_id, status: "failed", reason: { code: "scenario_failure", message: inputs.reason } };
  }

  let world: ReadyLocalWorld;
  try {
    world = await driver.buildWorld(inputs.value);
  } catch (error) {
    return {
      cellId: cell.cell_id,
      status: "failed",
      reason: { code: "scenario_failure", message: `world construction failed: ${describe(error)}` },
    };
  }

  const harnessKind = cell.dimensions.harness ?? REPRESENTATIVE_HARNESS;
  let worldClosed = false;
  try {
    const actor = await driver.createActor(world);
    const repo = await driver.prepareRepo(world, actor, cell.cell_id);
    const page = await driver.openPage(world, actor);
    try {
      const { workspaceId } = await driver.selectRepoAndWorkLocally(page, repo);
      const { sessionId } = await driver.createSession(page, harnessKind);

      const [allowlist, liveProbe] = await Promise.all([
        driver.allowlistModels(world),
        driver.liveProbeModels(world, harnessKind),
      ]);
      const modelId = selectCheapestEligibleClaudeModel(allowlist, liveProbe);
      if (!modelId) {
        return {
          cellId: cell.cell_id,
          status: "blocked",
          reason: {
            code: "scenario_blocked",
            message:
              "no eligible non-Fable Claude model in the intersection of the qualification allowlist " +
              "and AnyHarness's live gateway probe",
          },
        };
      }
      await driver.selectModelInUi(page, modelId);

      const before = await driver.snapshotSpend(world, actor);
      const windowStartedAt = new Date().toISOString();
      const reply = await driver.sendPromptAndAwaitReply(page, DETERMINISTIC_PROMPT);
      if (!reply.trim()) {
        throw new Error("empty assistant reply");
      }
      const windowFinishedAt = new Date().toISOString();

      await driver.reopenAndVerify(page, { workspaceId, sessionId, modelId, harnessKind });

      const correlated = await driver.correlateTurn(world, {
        actor,
        before,
        acceptedModelId: modelId,
        windowStartedAt,
        windowFinishedAt,
      });

      const serverVersion = world.artifacts.server.version;
      const anyharnessVersion = world.artifacts.anyharness.version;
      const artifactIds = [
        world.artifacts.server.artifact_id,
        world.artifacts.anyharness.artifact_id,
        world.artifacts.desktopRenderer.artifact_id,
      ];

      const cleanup = await driver.closeWorld(world);
      worldClosed = true;

      const evidence: LocalWorkspaceTurnEvidenceV1 = {
        kind: "local_workspace_turn",
        artifact_ids: artifactIds,
        server_version: serverVersion,
        anyharness_version: anyharnessVersion,
        harness: "claude",
        model_id: modelId,
        workspace_id_hash: sha256Hex(workspaceId),
        session_id_hash: sha256Hex(sessionId),
        transcript_reopened: true,
        litellm: {
          token_id_hash: correlated.tokenIdHash,
          request_ids: correlated.requestIds,
          window_started_at: correlated.windowStartedAt,
          window_finished_at: correlated.windowFinishedAt,
          prompt_tokens: correlated.promptTokens,
          completion_tokens: correlated.completionTokens,
          total_tokens: correlated.totalTokens,
          spend_usd: correlated.spendUsd,
        },
        cleanup: {
          ledger_id_hash: cleanup.ledgerIdHash,
          registered: cleanup.registered,
          reconciled: cleanup.reconciled,
          failed: cleanup.failed,
          virtual_key_deleted: cleanup.virtualKeyDeleted,
          litellm_subjects_deleted: cleanup.litellmSubjectsDeleted,
          browser_closed: cleanup.browserClosed,
          processes_stopped: cleanup.processesStopped,
          containers_removed: cleanup.containersRemoved,
          local_paths_removed: cleanup.localPathsRemoved,
        },
      };

      // Cleanup failure means the cell cannot remain green (spec failure table).
      if (cleanup.failed > 0 || !allCleanupBooleansTrue(cleanup)) {
        return {
          cellId: cell.cell_id,
          status: "failed",
          reason: { code: "scenario_failure", message: `cleanup did not fully reconcile (failed=${cleanup.failed})` },
          evidence,
        };
      }

      return { cellId: cell.cell_id, status: "green", evidence };
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

function allCleanupBooleansTrue(cleanup: {
  virtualKeyDeleted: boolean;
  litellmSubjectsDeleted: boolean;
  browserClosed: boolean;
  processesStopped: boolean;
  containersRemoved: boolean;
  localPathsRemoved: boolean;
}): boolean {
  return (
    cleanup.virtualKeyDeleted &&
    cleanup.litellmSubjectsDeleted &&
    cleanup.browserClosed &&
    cleanup.processesStopped &&
    cleanup.containersRemoved &&
    cleanup.localPathsRemoved
  );
}

type WorldConstructionInputs =
  | {
      ok: true;
      value: {
        map: CandidateBuildMapV1;
        litellm: QualificationLiteLlmConfigLike;
        run: RunIdentityV1;
        runDir: string;
        ports: LocalWorldPorts;
      };
    }
  | { ok: false; reason: string };

/**
 * Reads the world-construction inputs off the bridge context (see module
 * doc). Returns a typed failure instead of throwing so the cell can report a
 * clean `failed` outcome.
 */
export function resolveWorldConstructionInputs(ctx: LocalWorldSmokeRunContext): WorldConstructionInputs {
  const map = ctx.candidateBuildMap;
  if (!map) {
    return { ok: false, reason: "no candidate build map was supplied to this run; the cell cannot start a world" };
  }
  if (!ctx.runIdentity) {
    return { ok: false, reason: "no run identity was threaded into the scenario context" };
  }
  if (!ctx.runDir) {
    return { ok: false, reason: "no run/shard-scoped run directory was threaded into the scenario context" };
  }
  if (!ctx.ports) {
    return { ok: false, reason: "no pre-allocated local-world ports were threaded into the scenario context" };
  }
  let adminBaseUrl: string;
  let publicBaseUrl: string;
  let masterKey: string;
  try {
    adminBaseUrl = ctx.env.require("AGENT_GATEWAY_LITELLM_BASE_URL");
    publicBaseUrl = ctx.env.require("AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL");
    masterKey = ctx.env.require("AGENT_GATEWAY_LITELLM_MASTER_KEY");
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
  return {
    ok: true,
    value: { map, litellm: { adminBaseUrl, publicBaseUrl, masterKey }, run: ctx.runIdentity, runDir: ctx.runDir, ports: ctx.ports },
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
