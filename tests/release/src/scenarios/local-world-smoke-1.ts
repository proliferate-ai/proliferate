import { createHash } from "node:crypto";

import type { Page } from "playwright";

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
import { findErrorEvent, findTurnEndedEvent } from "../fixtures/local-runtime.js";
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
 * The world-construction inputs — the validated path-bearing `candidateBuildMap`
 * (BRIEF §7a), the resolved `runIdentity`, the run/shard-scoped `runDir`, and
 * the pre-allocated `LocalWorldPorts` — are all first-class fields of
 * `ScenarioRunContext`, threaded by the runner from the execute options and the
 * `local-world-ports.json` sidecar the candidate builder wrote next to the
 * candidate map. When any is absent the cell fails cleanly with a bounded reason
 * instead of throwing (see `resolveWorldConstructionInputs`).
 */

export const LOCAL_WORLD_SMOKE_1_ID = "LOCAL-WORLD-SMOKE-1";
export const REPRESENTATIVE_HARNESS = "claude";
export const DETERMINISTIC_PROMPT = "Reply with exactly the word: pong";

/** Bounded waits for the live browser flow (kept generous but finite). */
const GATEWAY_SYNC_TIMEOUT_MS = 120_000;
const HARNESS_READY_TIMEOUT_MS = 300_000;
const MODEL_PICKER_TIMEOUT_MS = 60_000;
const WORKSPACE_SETTLE_TIMEOUT_MS = 90_000;
const TURN_TIMEOUT_MS = 120_000;
const ASSISTANT_REPLY_TIMEOUT_MS = 20_000;

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
    { description: `[${cell.cell_id}] open the Desktop renderer (home composer)` },
    { description: `[${cell.cell_id}] select the repository and choose "Work locally" in the UI` },
    { description: `[${cell.cell_id}] wait until Desktop syncs gateway state into AnyHarness` },
    { description: `[${cell.cell_id}] choose the cheapest eligible non-Fable Claude model (allowlist ∩ live probe)` },
    { description: `[${cell.cell_id}] send a bounded deterministic prompt; materialize the workspace + session and run one turn` },
    { description: `[${cell.cell_id}] reload/reopen and require workspace/session/transcript/model to persist` },
    { description: `[${cell.cell_id}] correlate the turn with new LiteLLM spend rows for the actor key` },
    { description: `[${cell.cell_id}] clean up every run-owned resource, in reverse order` },
  ],
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> => {
    const driver = defaultLocalWorldSmokeDriver;
    const outcomes: ScenarioCellOutcomeWithEvidence[] = [];
    for (const cell of cells) {
      outcomes.push(await runLocalWorldSmokeCell(cell, ctx, driver));
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
  /**
   * Waits until the booted Desktop renderer has pushed the Server-provided
   * agent-auth (gateway) state into AnyHarness — observed as AnyHarness's own
   * gateway model probe becoming non-empty for the harness. Desktop, not the
   * fixture, performs the `PUT /v1/agent-auth/state` push; this only reads the
   * runtime's probe result. Fails closed if the state never syncs.
   */
  waitForGatewaySync(world: ReadyLocalWorld, page: ProductPage, harnessKind: string): Promise<void>;
  /**
   * Ensures the representative harness's agent process is installed and reaches
   * readiness `ready` in AnyHarness, so Desktop lists it as a launchable agent
   * (its models appear in the composer picker). Claude's ACP process is built
   * from git and can still be installing after gateway state syncs. Prerequisite
   * agent setup — not the workspace/session/turn behavior under test.
   */
  ensureHarnessReady(world: ReadyLocalWorld, page: ProductPage, harnessKind: string): Promise<void>;
  /**
   * Home screen: selects the prepared repository in the project picker and the
   * "Work locally" runtime. No workspace exists yet — the pending-workspace
   * composer flow materializes it only on send.
   */
  selectRepoAndWorkLocally(page: ProductPage, repo: PreparedRepository): Promise<void>;
  /** AnyHarness's live-probed gateway model ids for the harness. */
  liveProbeModels(world: ReadyLocalWorld, harnessKind: string): Promise<string[]>;
  /** The qualification allowlist, cheapest-first (from controller preflight). */
  allowlistModels(world: ReadyLocalWorld): Promise<string[]>;
  /** Selects `modelId` in the home composer's model picker and asserts the picker reflects it. */
  selectModelInUi(page: ProductPage, modelId: string): Promise<void>;
  /**
   * Sends the bounded prompt from the home composer. This materializes the
   * pending workspace + session, transitions to the workspace shell, and runs
   * the first turn. Returns the created workspace/session ids (read from the
   * settled shell hooks) and the assistant reply observed in the transcript.
   */
  sendPromptAndMaterialize(
    world: ReadyLocalWorld,
    page: ProductPage,
    prompt: string,
  ): Promise<{ workspaceId: string; sessionId: string; reply: string }>;
  /** Reloads the page and asserts workspace/session/transcript/model survive. */
  reopenAndVerify(
    world: ReadyLocalWorld,
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
  async waitForGatewaySync(world, _page, harnessKind) {
    // Desktop's use-local-auth-state-sync pushes the Server-minted gateway
    // state to AnyHarness on boot; AnyHarness then probes the managed proxy and
    // records the servable model list. An empty list means either the push has
    // not landed yet or gateway auth is absent. Poll (bounded) until non-empty.
    const deadline = Date.now() + GATEWAY_SYNC_TIMEOUT_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const models = await world.runtime.client.getGatewayModels(harnessKind);
        if (models.length > 0) {
          return;
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(1_000);
    }
    throw new Error(
      `waitForGatewaySync: Desktop did not sync gateway state into AnyHarness for "${harnessKind}" ` +
        `within ${GATEWAY_SYNC_TIMEOUT_MS}ms${lastError ? ` (last probe error: ${describe(lastError)})` : ""}.`,
    );
  },
  async ensureHarnessReady(world, page, harnessKind) {
    const client = world.runtime.client;
    const deadline = Date.now() + HARNESS_READY_TIMEOUT_MS;
    let triggeredInstall = false;
    let last: Awaited<ReturnType<typeof client.getAgent>> | undefined;
    let launchable = false;
    // Wait until AnyHarness both reports the agent ready AND lists it (with
    // models) in launch-options — the exact source Desktop's composer reads.
    // Claude's ACP process builds from git and can still be installing after
    // gateway state syncs, so this is generously bounded.
    while (Date.now() < deadline) {
      last = await client.getAgent(harnessKind).catch(() => undefined);
      if (last?.readiness === "ready") {
        const options = await client.getAgentLaunchOptions().catch(() => []);
        const entry = options.find((agent) => agent.kind === harnessKind);
        if (entry && entry.models.length > 0) {
          launchable = true;
          break;
        }
      }
      // Trigger the install once if the agent process is not yet present and
      // nothing else is already installing it (Desktop may auto-reconcile).
      if (
        !triggeredInstall &&
        last &&
        last.installState !== "installing" &&
        (last.readiness === "install_required" || last.installState === "not_installed")
      ) {
        triggeredInstall = true;
        await client.installAgent(harnessKind).catch(() => undefined);
      }
      await sleep(2_000);
    }
    if (!launchable) {
      await dumpHarnessReadinessDiagnostics(world, harnessKind).catch(() => undefined);
      throw new Error(
        `ensureHarnessReady: agent "${harnessKind}" never became launchable within ${HARNESS_READY_TIMEOUT_MS}ms ` +
          `(last: readiness=${last?.readiness}, installState=${last?.installState}, credentialState=${last?.credentialState}).`,
      );
    }
    // Desktop fetches agents/launch-options once at boot and does not poll them
    // (anyharness/sdk-react useAgentsQuery/useAgentLaunchOptionsQuery have no
    // refetchInterval), so a harness that finished installing after boot never
    // appears in the composer. Reload to force a fresh fetch now that AnyHarness
    // lists it, then wait for the home composer to re-render.
    await page.page.reload({ waitUntil: "domcontentloaded" });
    await page.page
      .locator("[data-home-composer-editor]")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  },
  async selectRepoAndWorkLocally(page, repo) {
    const p = page.page;
    // Open the target row's Project picker (aria "Project: …"). The prepared
    // repo was registered into AnyHarness by preparedRepository, so Desktop
    // lists it as a repo-root whose `sourceRoot` equals the clone path.
    await clickByRole(p, "button", /^Project:/, "home Project picker trigger");
    // Select deterministically by the clone path (repo-root sourceRoot), since
    // the displayed name is the git remote name, not the clone-dir basename.
    const repoRow = p.locator(`[data-repo-source-root="${cssAttr(repo.path)}"]`).first();
    try {
      await repoRow.waitFor({ state: "visible", timeout: 20_000 });
      await repoRow.click();
    } catch (error) {
      // Fall back to the display name for resilience against path normalization.
      const repoName = deriveRepoName(repo);
      const available = await p
        .locator("[data-repo-source-root]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-repo-source-root")))
        .catch(() => []);
      try {
        await clickMenuItemByText(p, repoName, "prepared repository row");
      } catch {
        throw new Error(
          `selectRepoAndWorkLocally: prepared repo not offered by the project picker. ` +
            `Wanted sourceRoot="${repo.path}" or name="${repoName}". ` +
            `Available sourceRoots: ${JSON.stringify(available)} (${describe(error)}).`,
        );
      }
    }
    // Selecting a repo leaves the launch kind at its default ("New worktree").
    // Open the Runtime popover and switch to "Work locally" (repoLaunchKind=local).
    await clickByRole(p, "button", /^Runtime:/, "home Runtime picker trigger");
    await clickMenuItemByText(p, "Work locally", '"Work locally" runtime option');
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
    const p = page.page;
    // The composer model picker is disabled until agents are healthy, and the
    // just-installed claude agent can surface a beat after AnyHarness reports it
    // ready (Desktop refetches agents on an interval). Retry opening the picker
    // until the model option appears.
    const deadline = Date.now() + MODEL_PICKER_TIMEOUT_MS;
    const optionSelector = `[data-model-option="${cssAttr(modelId)}"]`;
    let lastAvailable: Array<string | null> = [];
    while (Date.now() < deadline) {
      const trigger = p.locator("[data-composer-model-trigger]:not([disabled])").first();
      try {
        await trigger.waitFor({ state: "visible", timeout: 5_000 });
        await trigger.click();
      } catch {
        await sleep(1_500);
        continue;
      }
      const option = p.locator(optionSelector).first();
      if (await option.count().catch(() => 0)) {
        await option.click();
        // Assert the composer now reflects the selection (spec step 7).
        await p
          .locator(`[data-composer-model-trigger][data-composer-selected-model="${cssAttr(modelId)}"]`)
          .first()
          .waitFor({ state: "attached", timeout: 10_000 });
        return;
      }
      lastAvailable = await p
        .locator("[data-model-option]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-model-option")))
        .catch(() => []);
      // Close the popover and retry after a beat.
      await p.keyboard.press("Escape").catch(() => undefined);
      await sleep(2_000);
    }
    throw new Error(
      `selectModelInUi: model "${modelId}" was not offered by the composer picker within ` +
        `${MODEL_PICKER_TIMEOUT_MS}ms. Last available options: ${JSON.stringify(lastAvailable)}.`,
    );
  },
  async sendPromptAndMaterialize(world, page, prompt) {
    const p = page.page;
    const editor = p.locator("[data-home-composer-editor]").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.fill(prompt);
    const send = p.locator("[data-chat-send-button]:not([disabled])").first();
    await send.waitFor({ state: "visible", timeout: 15_000 });
    await send.click();
    // The pending-workspace composer transitions to the workspace shell; wait
    // for it to settle (data-pending-workspace flips to "false") so the ui-key
    // is the materialized workspace id rather than the pending synthetic key.
    await p.locator("[data-workspace-shell]").first().waitFor({ state: "visible", timeout: 30_000 });
    await p
      .locator('[data-workspace-shell][data-pending-workspace="false"]')
      .first()
      .waitFor({ state: "attached", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
    const { workspaceId, sessionId } = await readWorkspaceIds(p);
    // Turn completion is asserted from AnyHarness's own event stream (robust,
    // not DOM-timing-flaky). A session-level error is surfaced as a real
    // failure rather than a hang.
    const completion = await waitForTurnCompletion(world, sessionId, TURN_TIMEOUT_MS);
    if (completion.error) {
      throw new Error(`sendPromptAndMaterialize: assistant turn errored: ${completion.error}`);
    }
    if (!completion.ended) {
      throw new Error(`sendPromptAndMaterialize: assistant turn did not end within ${TURN_TIMEOUT_MS}ms.`);
    }
    // Spec: a stable assistant answer must be visible in the transcript.
    const reply = await readAssistantReply(p, ASSISTANT_REPLY_TIMEOUT_MS);
    return { workspaceId, sessionId, reply };
  },
  async reopenAndVerify(world, page, expectations) {
    void world;
    const p = page.page;
    await p.reload({ waitUntil: "domcontentloaded" });
    // The Desktop client restores the last workspace/session on boot (the
    // logical workspace is persisted; its active session is re-derived a beat
    // later). Wait for the shell to restore the exact workspace, then poll for
    // the session id to settle back to the same value.
    const shell = p.locator(`[data-workspace-shell][data-workspace-ui-key="${cssAttr(expectations.workspaceId)}"]`).first();
    await shell.waitFor({ state: "attached", timeout: 60_000 });
    const sessionDeadline = Date.now() + 30_000;
    let sessionId: string | null = null;
    while (Date.now() < sessionDeadline) {
      sessionId = await shell.getAttribute("data-workspace-session-id").catch(() => null);
      if (sessionId === expectations.sessionId) {
        break;
      }
      await sleep(1_000);
    }
    if (sessionId !== expectations.sessionId) {
      throw new Error(
        `reopenAndVerify: session "${expectations.sessionId}" did not remain active after reopen ` +
          `(saw "${sessionId ?? ""}").`,
      );
    }
    const reply = await readAssistantReply(p, ASSISTANT_REPLY_TIMEOUT_MS);
    if (!reply.trim()) {
      throw new Error("reopenAndVerify: the transcript did not re-render an assistant reply after reopen.");
    }
    // The selected model (and thus harness) must remain visible in the composer.
    await p
      .locator(
        `[data-composer-model-trigger][data-composer-selected-model="${cssAttr(expectations.modelId)}"]`,
      )
      .first()
      .waitFor({ state: "attached", timeout: 15_000 })
      .catch(() => {
        throw new Error(
          `reopenAndVerify: composer no longer reflects model "${expectations.modelId}" after reopen.`,
        );
      });
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
  ctx: ScenarioRunContext,
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
    // Enrol the actor's server-minted LiteLLM key + user + team into the world's
    // cleanup stack as soon as the key identity is resolved, so world close()
    // deletes them (spec "Cleanup": actor virtual key/team/user) and populates
    // the required `virtual_key_deleted`/`litellm_subjects_deleted` evidence.
    // Without this the shared staging proxy leaks the run's subjects.
    await world.trackActorSubjects?.(actor.gatewayKey);
    const repo = await driver.prepareRepo(world, actor, cell.cell_id);
    const page = await driver.openPage(world, actor);
    try {
      // Desktop (not the fixture) must push the Server-provided gateway state
      // into AnyHarness before the turn; block on that sync signal.
      await driver.waitForGatewaySync(world, page, harnessKind);

      // The representative harness's agent process must be installed + ready in
      // AnyHarness before Desktop lists it as launchable in the composer. This
      // reloads the page once the harness is launchable so Desktop re-fetches.
      await driver.ensureHarnessReady(world, page, harnessKind);

      // Home screen: select the prepared repo + "Work locally". The workspace
      // and session do not exist yet — the composer materializes them on send.
      await driver.selectRepoAndWorkLocally(page, repo);

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
      const { workspaceId, sessionId, reply } = await driver.sendPromptAndMaterialize(
        world,
        page,
        DETERMINISTIC_PROMPT,
      );
      if (!reply.trim()) {
        throw new Error("empty assistant reply");
      }
      const windowFinishedAt = new Date().toISOString();

      await driver.reopenAndVerify(world, page, { workspaceId, sessionId, modelId, harnessKind });

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
    } catch (uiError) {
      // Env-gated failure diagnostics (LOCAL_WORLD_SMOKE_DEBUG_DIR): dump the
      // real rendered DOM + a screenshot at the point of a browser-flow failure
      // so a selector/flow break can be fixed without a live browser. Never on
      // the green path; best-effort so it never masks the real error.
      await captureUiFailure(page, "scenario-ui-failure");
      await dumpServerGatewayState(actor, "scenario-ui-failure").catch(() => undefined);
      await dumpRuntimeWorkspaces(world, "scenario-ui-failure").catch(() => undefined);
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
export function resolveWorldConstructionInputs(ctx: ScenarioRunContext): WorldConstructionInputs {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Env-gated (`LOCAL_WORLD_SMOKE_DEBUG_DIR`) dump of the live DOM + a screenshot
 * when a browser-flow step fails. No-op unless the env var is set (so it never
 * runs in CI or unit tests), and fully best-effort so it never masks the real
 * failure.
 */
async function captureUiFailure(page: ProductPage | undefined, label: string): Promise<void> {
  const dir = process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR;
  if (!dir || !page) {
    return;
  }
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const nodePath = await import("node:path");
    mkdirSync(dir, { recursive: true });
    const stamp = `${label}-${Date.now()}`;
    const html = await page.page.content().catch(() => "<no content>");
    writeFileSync(nodePath.join(dir, `${stamp}.html`), html);
    await page.page.screenshot({ path: nodePath.join(dir, `${stamp}.png`), fullPage: true }).catch(() => undefined);
    if (page.debug) {
      writeFileSync(nodePath.join(dir, `${stamp}.console.txt`), page.debug.console.join("\n"));
      writeFileSync(nodePath.join(dir, `${stamp}.network.txt`), page.debug.network.join("\n"));
    }
  } catch {
    // Diagnostics are best-effort.
  }
}

/**
 * Diagnostic-only (env-gated) dump of why a harness is not launchable: the full
 * launch-options, gateway probes for the target + grok, and the pushed
 * agent-auth state.json. Best-effort; never affects the outcome.
 */
async function dumpHarnessReadinessDiagnostics(world: ReadyLocalWorld, harnessKind: string): Promise<void> {
  const dir = process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR;
  if (!dir) {
    return;
  }
  const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
  const nodePath = await import("node:path");
  const client = world.runtime.client;
  const diag: Record<string, unknown> = {};
  diag.launchOptions = await client.getAgentLaunchOptions().catch((e) => `err: ${describe(e)}`);
  diag.gatewayModelsTarget = await client.getGatewayModels(harnessKind).catch((e) => `err: ${describe(e)}`);
  diag.gatewayModelsGrok = await client.getGatewayModels("grok").catch((e) => `err: ${describe(e)}`);
  diag.agentTarget = await client.getAgent(harnessKind).catch((e) => `err: ${describe(e)}`);
  diag.agentGrok = await client.getAgent("grok").catch((e) => `err: ${describe(e)}`);
  try {
    const statePath = nodePath.join(world.paths.runtimeHome, "agent-auth", "state.json");
    diag.stateJson = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (e) {
    diag.stateJson = `err: ${describe(e)}`;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(nodePath.join(dir, `harness-readiness-diag-${Date.now()}.json`), JSON.stringify(diag, null, 2));
}

/**
 * Diagnostic-only (env-gated) dump of the SERVER-rendered local-surface
 * agent-auth state document and selections (the exact inputs Desktop fetches
 * and pushes to AnyHarness). Reveals whether the server renders the harness's
 * gateway route. Best-effort.
 */
async function dumpServerGatewayState(actor: AuthenticatedActor, label: string): Promise<void> {
  const dir = process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR;
  if (!dir) {
    return;
  }
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const nodePath = await import("node:path");
  const diag: Record<string, unknown> = {};
  diag.stateLocal = await actor.api
    .get("/v1/cloud/agent-gateway/state?surface=local")
    .catch((e) => `err: ${describe(e)}`);
  diag.selectionsLocal = await actor.api
    .get("/v1/cloud/agent-gateway/selections?surface=local")
    .catch((e) => `err: ${describe(e)}`);
  diag.capabilities = await actor.api
    .get("/v1/cloud/agent-gateway/capabilities")
    .catch((e) => `err: ${describe(e)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(nodePath.join(dir, `server-gateway-state-${label}-${Date.now()}.json`), JSON.stringify(diag, null, 2));
}

/**
 * Diagnostic-only (env-gated) dump of the runtime's workspaces + launch options
 * at failure — reveals whether the "Work locally" workspace actually
 * materialized in AnyHarness. Best-effort.
 */
async function dumpRuntimeWorkspaces(world: ReadyLocalWorld, label: string): Promise<void> {
  const dir = process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR;
  if (!dir) {
    return;
  }
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const nodePath = await import("node:path");
  const diag: Record<string, unknown> = {};
  diag.workspaces = await world.runtime.client.listWorkspaces().catch((e) => `err: ${describe(e)}`);
  diag.launchOptions = await world.runtime.client.getAgentLaunchOptions().catch((e) => `err: ${describe(e)}`);
  const sessions = await world.runtime.client.listSessions().catch(() => []);
  diag.sessions = sessions;
  const sessionDiags: Record<string, unknown> = {};
  for (const session of Array.isArray(sessions) ? sessions : []) {
    sessionDiags[session.id] = await world.runtime.client
      .getEvents(session.id, 50)
      .catch((e) => `err: ${describe(e)}`);
  }
  diag.sessionEvents = sessionDiags;
  mkdirSync(dir, { recursive: true });
  writeFileSync(nodePath.join(dir, `runtime-workspaces-${label}-${Date.now()}.json`), JSON.stringify(diag, null, 2));
}

/** The repository's display name as Desktop lists it — the clone's basename. */
function deriveRepoName(repo: PreparedRepository): string {
  const fromPath = repo.path.replace(/\/+$/, "").split("/").pop();
  if (fromPath && fromPath.length > 0) {
    return fromPath;
  }
  return repo.repoUrl.split("/").pop()?.replace(/\.git$/, "") ?? repo.path;
}

/** Escapes a value for safe interpolation inside a `[attr="…"]` CSS selector. */
function cssAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
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

/** Clicks a popover menu row by its visible text (menu rows are native buttons). */
async function clickMenuItemByText(page: Page, text: string, what: string): Promise<void> {
  const byRole = page.getByRole("button", { name: text, exact: false }).first();
  if (await byRole.count().catch(() => 0)) {
    await byRole.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    if (await byRole.isVisible().catch(() => false)) {
      await byRole.click();
      return;
    }
  }
  const byText = page.getByText(text, { exact: false }).first();
  try {
    await byText.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    throw new Error(`could not find ${what} (text="${text}"): ${describe(error)}`);
  }
  await byText.click();
}

/**
 * Reads the settled workspace id (data-workspace-ui-key) and active session id
 * (data-workspace-session-id) off the workspace shell. The session id can lag
 * the shell mount by a beat, so it is briefly retried.
 */
async function readWorkspaceIds(page: Page): Promise<{ workspaceId: string; sessionId: string }> {
  const shell = page.locator("[data-workspace-shell]").first();
  const deadline = Date.now() + 30_000;
  let workspaceId = "";
  let sessionId = "";
  while (Date.now() < deadline) {
    workspaceId = (await shell.getAttribute("data-workspace-ui-key").catch(() => "")) ?? "";
    sessionId = (await shell.getAttribute("data-workspace-session-id").catch(() => "")) ?? "";
    if (workspaceId && sessionId) {
      return { workspaceId, sessionId };
    }
    await sleep(500);
  }
  throw new Error(
    `readWorkspaceIds: workspace/session ids never settled ` +
      `(workspace="${workspaceId}", session="${sessionId}").`,
  );
}

/**
 * Polls AnyHarness's session event stream until the turn ends or errors.
 * Turn completion is authoritative here; the transcript DOM is asserted
 * separately for the "answer visible in the transcript" requirement.
 */
async function waitForTurnCompletion(
  world: ReadyLocalWorld,
  sessionId: string,
  timeoutMs: number,
): Promise<{ ended: boolean; error: string | undefined }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await world.runtime.client.getEvents(sessionId).catch(() => []);
    const error = findErrorEvent(events);
    if (error) {
      return { ended: true, error };
    }
    if (findTurnEndedEvent(events)) {
      return { ended: true, error: undefined };
    }
    await sleep(1_000);
  }
  return { ended: false, error: undefined };
}

/**
 * Waits for a non-streaming assistant prose block to carry non-empty text and
 * returns the last one's trimmed content (the final assistant answer).
 */
async function readAssistantReply(page: Page, timeoutMs: number): Promise<string> {
  const settled = page.locator('[data-assistant-prose][data-assistant-streaming="false"]').last();
  await settled.waitFor({ state: "attached", timeout: timeoutMs }).catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = (await settled.textContent().catch(() => "")) ?? "";
    if (text.trim().length > 0) {
      return text.trim();
    }
    await sleep(500);
  }
  return "";
}
