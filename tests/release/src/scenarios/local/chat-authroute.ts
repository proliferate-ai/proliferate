import { createHash } from "node:crypto";

import type { Page } from "playwright";

import type { ScenarioCellOutcome, ScenarioRunContext } from "../types.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";
import type { LocalWorldCleanupEvidence } from "../../worlds/local-workspace/cleanup.js";
import { authenticatedActor, type AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import { preparedRepository, type PreparedRepository } from "../../fixtures/prepared-repository.js";
import { productPage, type ProductPage } from "../../fixtures/product-page.js";
import { findErrorEvent, findTurnEndedEvent } from "../../fixtures/local-runtime.js";
import { selectCheapestEligibleClaudeModel } from "../../services/qualification-litellm.js";
import {
  DETERMINISTIC_PROMPT,
  defaultLocalWorldSmokeDriver,
} from "../local-world-smoke-1.js";
import { bootLocalFunctionalWorld, isWorldBackedRun, resolveLocalFunctionalWorldInputs } from "./world-boot.js";
import { captureLocalDriverFailure } from "./debug-capture.js";
import {
  resolveLocalWorkspaceSessionAfter,
  resolveLocalWorkspaceSessionId,
  snapshotLocalWorkspaceSessionIds,
} from "./local-session.js";
import type {
  LocalCleanupV1,
  LocalHarnessKind,
  LocalLitellmSpendV1,
  LocalRoute,
  LocalRouteTurnEvidenceV1,
} from "../../evidence/schema.js";

/**
 * LOCAL-2 (managed gateway turn per harness), LOCAL-3 (user API-key turn per
 * harness), and LOCAL-6 (route-change semantics) — all authored under the
 * canonical runner scenario IDs `T3-CHAT-1` (LOCAL-2) and `T3-AUTHROUTE-1`
 * (LOCAL-3 + LOCAL-6). Owner: chat-authroute workstream.
 *
 * These collectors reuse the `LOCAL-WORLD-SMOKE-1` driver-seam idiom: every
 * privileged/UI step is a method on a driver interface so unit tests fake the
 * world/fixtures/browser/gateway entirely and never touch a real container,
 * browser, or network. Production wiring (`defaultLocalRouteDriver`) calls the
 * real world/fixture/controller functions.
 *
 * Fanout comes from `t3-chat-1`'s `shippedHarnessKinds()` (audit ruling #4): one
 * cell per catalog harness kind. Cursor ships with NO gateway auth slot, so on a
 * gateway-route matrix (LOCAL-2) its cell is the truthful typed `blocked`
 * (unsupported) outcome — never green-required, never silently dropped (audit
 * ruling #2). Cursor is EXCLUDED from user-key cells (LOCAL-3) because its
 * `CURSOR_API_KEY` is an account key, not a provider key (standing exclusion).
 *
 * Billing carve-out (audit ruling #1): LOCAL-2 asserts the functional core plus
 * LiteLLM spend-log correlation to the actor's `token_id` (external provider
 * truth). The product usage-import / balance / debit reconcile is DEFERRED to
 * PR 4's billing half; evidence records the deferral (`billing_reconcile_deferred`).
 * NO `T3-BILL-1` / product-ledger assertion is made here.
 */

/** The route a functional cell drives. */
export type { LocalRoute } from "../../evidence/schema.js";

/**
 * BYOK env mapping (BRIEF §"BYOK input mapping"). Each user-key harness reads a
 * dedicated bounded provider key from the controller's secret environment and
 * stores/selects it through the product UI. Cursor is intentionally absent.
 */
export const BYOK_ENV_BY_HARNESS: Readonly<Record<Exclude<LocalHarnessKind, "cursor">, string>> = {
  // Anthropic direct key A → claude user-key route.
  claude: "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY",
  // OpenAI direct key → codex user-key route (codex's own provider family).
  codex: "RELEASE_E2E_BYOK_OPENAI_API_KEY",
  // xAI direct key → grok user-key route.
  grok: "RELEASE_E2E_BYOK_XAI_API_KEY",
  // Anthropic direct key B → opencode user-key route (its matching DIRECT
  // provider, distinct from the injected `proliferate` gateway provider; a
  // second Anthropic key so the two Anthropic-consuming harnesses stay isolated).
  opencode: "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY",
};

/** The representative single-source harness LOCAL-6 uses (gateway and direct do
 * NOT coexist for it, so route switching is observable). OpenCode is excluded
 * from LOCAL-6 because its gateway and direct sources coexist by design. */
export const LOCAL6_REPRESENTATIVE_HARNESS = "claude" satisfies LocalHarnessKind &
  keyof typeof BYOK_ENV_BY_HARNESS;

/**
 * The injected managed-gateway provider id (`proliferate`). OpenCode's gateway
 * cell MUST select a model from this provider so a native/direct provider cannot
 * satisfy the turn; its user-key cell MUST select a model of the matching DIRECT
 * provider (never this one). Recorded in `RouteModelSelection.providerId` and
 * asserted for OpenCode (BRIEF §"BYOK input mapping + model-selection rules").
 */
export const GATEWAY_PROVIDER_ID = "proliferate";

/**
 * Harness kinds that ship with NO managed-gateway auth slot in the candidate
 * catalog (audit ruling #2, registry/catalog verified). On the LOCAL-2 gateway
 * matrix their cell is the truthful typed `blocked` (unsupported) result — never
 * green-required, never dropped. Cursor is the only such kind today.
 */
export const HARNESSES_WITHOUT_GATEWAY_AUTH_SLOT: ReadonlySet<LocalHarnessKind> = new Set<LocalHarnessKind>([
  "cursor",
]);

/**
 * How a harness selects its model on each route (BRIEF §"BYOK input mapping"):
 *  - gateway: cheapest eligible non-Fable Claude model from the intersection of
 *    the qualification allowlist and AnyHarness's live gateway probe (identical
 *    to the smoke, per harness). OpenCode MUST select from the injected
 *    `proliferate` provider so a native/direct provider cannot satisfy the turn.
 *  - user_key: cheapest eligible non-premium model of the harness's OWN direct
 *    provider family. OpenCode MUST select a model of the matching DIRECT
 *    provider, not the injected `proliferate` gateway provider.
 */
export interface RouteModelSelection {
  route: LocalRoute;
  modelId: string;
  /** For OpenCode: the provider id the model belongs to, asserted route-correct. */
  providerId?: string;
}

/**
 * Every privileged/UI step LOCAL-2/3/6 perform, factored out for offline unit
 * tests (BRIEF §"Driver seams"). Mirrors `LocalWorldSmokeDriver` and extends it
 * with world construction, user-key storage/selection, and route-change steps.
 */
export interface LocalRouteDriver {
  /**
   * Builds this scenario's own `ReadyLocalWorld` from the run context (the same
   * candidate bytes/identity/dir/ports the smoke uses), delegating to
   * `world-boot`. A construction failure throws; the collector maps it to a
   * clean `failed` batch rather than a throw out of `runCells`.
   */
  buildWorld(ctx: ScenarioRunContext, worldId: string): Promise<ReadyLocalWorld>;
  createGatewayActor(world: ReadyLocalWorld, harness: LocalHarnessKind): Promise<AuthenticatedActor>;
  /** Fresh user-key actor: registered, its repo prepared, NO gateway route selected. */
  createUserKeyActor(world: ReadyLocalWorld, harness: LocalHarnessKind): Promise<AuthenticatedActor>;
  /** LOCAL-6: one actor with BOTH a valid user key and gateway enrollment. */
  createDualRouteActor(world: ReadyLocalWorld, harness: LocalHarnessKind): Promise<AuthenticatedActor>;
  prepareRepo(world: ReadyLocalWorld, actor: AuthenticatedActor, cellId: string): Promise<PreparedRepository>;
  openPage(world: ReadyLocalWorld, actor: AuthenticatedActor): Promise<ProductPage>;
  ensureHarnessReady(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind): Promise<void>;

  /**
   * Reads the harness's run-scoped provider key from the controller secret env
   * (per `BYOK_ENV_BY_HARNESS`), STORES it through the product Settings UI
   * (ApiKeysPane / HarnessAuthApiKey* rows — new `data-*` testids), and SELECTS
   * the user-key ("api_key") route for the harness through `HarnessAuthSection`.
   * Prerequisite provider-key configuration is a scenario action here, done via
   * the real product surface (audit ruling: LOCAL-3 is UI-driven).
   */
  storeAndSelectUserKeyRoute(page: ProductPage, harness: LocalHarnessKind): Promise<void>;

  /** LOCAL-6: switch the selected route to `gateway` in Settings and wait for the
   * new auth-state revision Desktop pushes into AnyHarness. */
  switchSelectedRouteToGateway(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind): Promise<void>;

  /** Waits until Desktop has synced the selected route's auth state into AnyHarness. */
  waitForRouteSync(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind, route: LocalRoute): Promise<void>;

  /** Home screen: select prepared repo + "Work locally". */
  selectRepoAndWorkLocally(page: ProductPage, repo: PreparedRepository): Promise<void>;

  /** Resolves the route-correct model per the rules above (gateway ∩ allowlist,
   * or the direct provider family), asserting OpenCode's provider source. */
  resolveRouteModel(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind, route: LocalRoute): Promise<RouteModelSelection>;

  selectModelInUi(page: ProductPage, modelId: string): Promise<void>;

  /** Sends the bounded prompt, materializes workspace+session, runs one turn,
   * asserts a stable reply, and asserts the LAUNCH route (evidence, not config
   * success — LOCAL-2/3: "the launch evidence must identify the route"). */
  sendBoundedTurn(
    world: ReadyLocalWorld,
    page: ProductPage,
    expectedRoute: LocalRoute,
    repoPath: string,
    existingSessionIds?: ReadonlySet<string>,
  ): Promise<{ workspaceId: string; sessionId: string; reply: string }>;

  reopenAndVerify(
    world: ReadyLocalWorld,
    page: ProductPage,
    expect: { workspaceId: string; sessionId: string; modelId: string; harness: LocalHarnessKind; route: LocalRoute; repoPath: string },
  ): Promise<void>;

  /** Gateway correlation (LOCAL-2/LOCAL-6 gateway leg): the smoke's snapshot →
   * correlateTurn against the actor's `token_id`. */
  correlateGatewaySpend(
    world: ReadyLocalWorld,
    params: { actor: AuthenticatedActor; acceptedModelId: string; windowStartedAt: string; windowFinishedAt: string; before: Awaited<ReturnType<ReadyLocalWorld["gateway"]["snapshotSpend"]>> },
  ): Promise<LocalLitellmSpendV1>;
  snapshotGatewaySpend(world: ReadyLocalWorld, actor: AuthenticatedActor): ReturnType<ReadyLocalWorld["gateway"]["snapshotSpend"]>;

  /** User-key isolation (LOCAL-3): assert NO LiteLLM spend row for the actor/run/
   * session across the turn window. The product-ledger balance is NOT read
   * (hard billing non-goal, LQF-006); the returned block records only the
   * observed zero-LiteLLM-spend fact plus the balance-read-deferred marker. */
  assertNoManagedSpend(
    world: ReadyLocalWorld,
    params: { actor: AuthenticatedActor; windowStartedAt: string; windowFinishedAt: string },
  ): Promise<{ litellmSpendRows: 0; managedBalanceReadDeferred: true }>;

  closeWorld(world: ReadyLocalWorld): ReturnType<ReadyLocalWorld["close"]>;
}

// ── Production driver: real world/fixtures/browser/gateway ───────────────────

/** Bounded waits for the live browser/runtime flow (kept generous but finite). */
const ROUTE_SYNC_TIMEOUT_MS = 120_000;
const WORKSPACE_SETTLE_TIMEOUT_MS = 90_000;
const TURN_TIMEOUT_MS = 300_000;
const ASSISTANT_REPLY_TIMEOUT_MS = 20_000;
const SETTINGS_STEP_TIMEOUT_MS = 30_000;

export const defaultLocalRouteDriver: LocalRouteDriver = {
  async buildWorld(ctx, worldId) {
    const inputs = resolveLocalFunctionalWorldInputs(ctx);
    if (!inputs.ok) {
      throw new Error(inputs.reason);
    }
    return bootLocalFunctionalWorld(inputs.value, worldId);
  },
  createGatewayActor: (world, harness) =>
    authenticatedActor(world, "owner", { harnessKind: harness, selectGatewayRoute: true }),
  createUserKeyActor: (world, harness) =>
    // No gateway route selected: the user-key route is stored + selected through
    // the product UI later (LOCAL-3 is UI-driven), so the enrolled key stays idle.
    authenticatedActor(world, "owner", { harnessKind: harness, selectGatewayRoute: false }),
  createDualRouteActor: (world, harness) =>
    // Gateway enrollment is present from creation; the user key is added +
    // selected first through the UI, then the route is switched to gateway.
    authenticatedActor(world, "owner", { harnessKind: harness, selectGatewayRoute: true }),
  prepareRepo: (world, actor, cellId) => preparedRepository(world, actor, { cellId }),
  openPage: (world, actor) => productPage(world, actor),
  ensureHarnessReady: (world, page, harness) =>
    defaultLocalWorldSmokeDriver.ensureHarnessReady(world, page, harness),
  async storeAndSelectUserKeyRoute(page, harness) {
    const envVar = BYOK_ENV_BY_HARNESS[harness as Exclude<LocalHarnessKind, "cursor">];
    if (!envVar) {
      throw new Error(`storeAndSelectUserKeyRoute: harness "${harness}" has no BYOK provider mapping.`);
    }
    const key = process.env[envVar];
    if (!key) {
      throw new Error(`storeAndSelectUserKeyRoute: required provider key env "${envVar}" is not set.`);
    }
    const p = page.page;
    // The api_key route lives on the per-harness settings pane (fix round 3).
    await openHarnessSettings(p, harness);
    // Select the api_key method card. On a single-source harness this only
    // highlights the card + reveals the api-key details block ("Add API key");
    // it does not itself open the create modal (product: HarnessAuthSection).
    await p
      .locator(`[data-harness-route-option="${cssAttr(`${harness}:api_key`)}"]`)
      .first()
      .click();
    // Open the "Create and bind" modal from the api-key details block. The button
    // text is stable product copy (HARNESS_PANE_COPY.addApiKey).
    const addKey = p.getByRole("button", { name: "Add API key", exact: false }).first();
    await addKey.waitFor({ state: "visible", timeout: SETTINGS_STEP_TIMEOUT_MS });
    await addKey.click();
    // The modal prefills the env-var name from the harness suggestion and stamps
    // the value input / save button with the provider hint. Target by attribute
    // presence (one modal is open) rather than a hardcoded provider so opencode's
    // derived provider hint is handled too.
    const valueInput = p.locator("[data-api-key-input]").first();
    await valueInput.waitFor({ state: "visible", timeout: SETTINGS_STEP_TIMEOUT_MS });
    await valueInput.fill(key);
    // The vault key needs a human title (showTitleField=true).
    await p.locator("#api-key-title").first().fill(`qual-${harness}-user-key`);
    await p.locator("[data-api-key-save]").first().click();
    // A wired+enabled row appears (create+bind autosaves the selection via
    // PUT /agent-auth selections), and the harness's selected route flips to
    // api_key. Both are the product's own readbacks.
    await p
      .locator("[data-api-key-saved]")
      .first()
      .waitFor({ state: "attached", timeout: SETTINGS_STEP_TIMEOUT_MS });
    await p
      .locator(`[data-harness-selected-route~="${cssAttr(`${harness}:api_key`)}"]`)
      .first()
      .waitFor({ state: "attached", timeout: SETTINGS_STEP_TIMEOUT_MS });
    // Return to the home composer for the repo-selection / send flow.
    await returnToAppHome(p);
  },
  async switchSelectedRouteToGateway(world, page, harness) {
    const p = page.page;
    // The route switch is a settings action; the page is on the workspace shell
    // after the user-key turn, so navigate back to the harness pane first.
    await openHarnessSettings(p, harness);
    await selectHarnessRoute(p, harness, "gateway");
    // A workspace is already active here (unlike LOCAL-2/3's first settings
    // visit), so "Back to app" returns to the workspace chat shell, not the
    // home composer.
    await returnToAppHome(p, "[data-workspace-shell]");
    await this.waitForRouteSync(world, page, harness, "gateway");
    // LOCAL-6 requires the gateway turn to run on a NEW session (the cell
    // asserts gatewayTurn.sessionId !== userKeyTurn.sessionId). Back on the
    // workspace shell the user-key session is still active, and picking the
    // gateway model there fires the product's same-harness LIVE model switch on
    // that session (setActiveSessionConfigOption), which the server correctly
    // 400s SESSION_CONFIG_REJECTED — a session must not silently jump auth
    // contexts via a config PATCH (proven: Actions run 29570511844,
    // T3-AUTHROUTE-1/local/route=change). Open a fresh in-workspace chat tab so
    // the gateway model pick + send go through the create-session/launch path.
    await openNewChat(p);
  },
  async waitForRouteSync(world, _page, harness, route) {
    // Desktop's use-local-auth-state-sync pushes the newly selected route's auth
    // state into AnyHarness; poll (bounded) the runtime signal that reflects it.
    // Gateway: the managed-proxy model probe becomes non-empty. User-key: the
    // harness appears launchable (its direct-provider models resolve).
    const deadline = Date.now() + ROUTE_SYNC_TIMEOUT_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        if (route === "gateway") {
          const models = await world.runtime.client.getGatewayModels(harness);
          if (models.length > 0) {
            return;
          }
        } else {
          const options = await world.runtime.client.getAgentLaunchOptions();
          const entry = options.find((agent) => agent.kind === harness);
          if (entry && entry.models.length > 0) {
            return;
          }
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(1_000);
    }
    throw new Error(
      `waitForRouteSync: Desktop did not sync the "${route}" route for "${harness}" within ` +
        `${ROUTE_SYNC_TIMEOUT_MS}ms${lastError ? ` (last probe error: ${describe(lastError)})` : ""}.`,
    );
  },
  selectRepoAndWorkLocally: (page, repo) => defaultLocalWorldSmokeDriver.selectRepoAndWorkLocally(page, repo),
  async resolveRouteModel(world, _page, harness, route) {
    if (route === "gateway") {
      const [preflight, probe] = await Promise.all([
        world.gateway.preflight(),
        world.runtime.client.getGatewayModels(harness),
      ]);
      const modelId = selectCheapestEligibleClaudeModel(
        preflight.eligibleClaudeModels,
        probe.map((model) => model.id),
      );
      if (!modelId) {
        throw new Error(
          `[${harness}] no eligible non-Fable gateway model in the intersection of the qualification ` +
            "allowlist and AnyHarness's live gateway probe",
        );
      }
      return { route, modelId, providerId: GATEWAY_PROVIDER_ID };
    }
    // user_key: the harness's OWN direct-provider models, live-probed via the
    // runtime launch options once the user key is selected. Cheapest non-Fable.
    const options = await world.runtime.client.getAgentLaunchOptions();
    const entry = options.find((agent) => agent.kind === harness);
    const ids = (entry?.models ?? []).map((model) => model.id).filter((id) => !/fable/i.test(id));
    if (ids.length === 0) {
      throw new Error(`[${harness}] no user-key (direct-provider) model offered by the runtime launch options`);
    }
    const modelId = pickCheapestModelId(ids);
    return { route, modelId, providerId: directProviderId(modelId) };
  },
  selectModelInUi: (page, modelId) => defaultLocalWorldSmokeDriver.selectModelInUi(page, modelId),
  async sendBoundedTurn(world, page, _expectedRoute, repoPath, existingSessionIds) {
    const p = page.page;
    // Snapshot before Send. LOCAL-6 uses the same concrete workspace for both
    // routes; resolving the "latest" session after the click can otherwise
    // bind the gateway leg to the already-completed user-key session while the
    // new process is still reconciling.
    //
    // For LOCAL-6's gateway leg the caller passes an `existingSessionIds`
    // snapshot taken BEFORE `switchSelectedRouteToGateway` opens the new chat
    // tab, because that navigation itself materializes the AnyHarness session
    // (product's `createSessionWithResolvedConfig` runs unconditionally on
    // open, prompt or not). Snapshotting here — after that navigation — would
    // count the just-created session as pre-existing and leave zero new
    // candidates for `resolveLocalWorkspaceSessionAfter` to find (Actions run
    // 29628880856, T3-AUTHROUTE-1/local/route=change). Callers that don't pass
    // one (LOCAL-2/3, whose first turn runs from the home screen and doesn't
    // pre-create a session) keep taking their own fresh snapshot here.
    const preSendSessionIds = existingSessionIds ?? (await snapshotLocalWorkspaceSessionIds(world, repoPath));
    // LOCAL-2/3's first turn runs from the home screen (`[data-home-composer-editor]`);
    // LOCAL-6's gateway turn runs from a fresh in-workspace tab
    // (`[data-chat-composer-editor]`, opened by `openNewChat`). Accept either
    // surface — the same dual-composer idiom `config-session.ts` uses.
    const editor = p.locator("[data-home-composer-editor], [data-chat-composer-editor]").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.fill(DETERMINISTIC_PROMPT);
    const send = p.locator("[data-chat-send-button]:not([disabled])").first();
    await send.waitFor({ state: "visible", timeout: 15_000 });
    await send.click();
    await p.locator("[data-workspace-shell]").first().waitFor({ state: "visible", timeout: 30_000 });
    await p
      .locator('[data-workspace-shell][data-pending-workspace="false"]')
      .first()
      .waitFor({ state: "attached", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
    // `data-workspace-ui-key` is the LOGICAL workspace id (repo-remote keyed);
    // the AnyHarness session keys off the CONCRETE runtime workspace at the repo
    // clone path (see local-session.ts). Keep the ui-key for shell selectors, but
    // resolve only a session created after the pre-send snapshot from the
    // runtime's own local workspace. The shell may briefly expose a
    // `client-session:*` alias; one new runtime id is its unambiguous target.
    const workspaceId = await readWorkspaceUiKey(p);
    const activeSessionAlias =
      (await p
        .locator("[data-workspace-shell]")
        .first()
        .getAttribute("data-workspace-session-id")
        .catch(() => null)) || null;
    const sessionId = await resolveLocalWorkspaceSessionAfter(
      world,
      repoPath,
      WORKSPACE_SETTLE_TIMEOUT_MS,
      { existingSessionIds: preSendSessionIds, activeSessionAlias },
    );
    const completion = await waitForTurnCompletion(world, sessionId, TURN_TIMEOUT_MS);
    if (completion.error) {
      throw new Error(`sendBoundedTurn: assistant turn errored: ${completion.error}`);
    }
    if (!completion.ended) {
      throw new Error(`sendBoundedTurn: assistant turn did not end within ${TURN_TIMEOUT_MS}ms.`);
    }
    const reply = await readAssistantReply(p, ASSISTANT_REPLY_TIMEOUT_MS);
    return { workspaceId, sessionId, reply };
  },
  async reopenAndVerify(world, page, expect) {
    const p = page.page;
    await p.reload({ waitUntil: "domcontentloaded" });
    const shell = p
      .locator(`[data-workspace-shell][data-workspace-ui-key="${cssAttr(expect.workspaceId)}"]`)
      .first();
    await shell.waitFor({ state: "attached", timeout: 60_000 });
    const sessionId = await resolveLocalWorkspaceSessionId(world, expect.repoPath, 30_000).catch(() => null);
    if (sessionId !== expect.sessionId) {
      throw new Error(
        `reopenAndVerify: session "${expect.sessionId}" did not remain active after reopen (saw "${sessionId ?? ""}").`,
      );
    }
    const reply = await readAssistantReply(p, ASSISTANT_REPLY_TIMEOUT_MS);
    if (!reply.trim()) {
      throw new Error("reopenAndVerify: the transcript did not re-render an assistant reply after reopen.");
    }
    await p
      .locator(`[data-composer-model-trigger][data-composer-selected-model="${cssAttr(expect.modelId)}"]`)
      .first()
      .waitFor({ state: "attached", timeout: 15_000 })
      .catch(() => {
        throw new Error(`reopenAndVerify: composer no longer reflects model "${expect.modelId}" after reopen.`);
      });
  },
  async correlateGatewaySpend(world, params) {
    const correlated = await world.gateway.correlateTurn({
      actor: params.actor.gatewayKey,
      before: params.before,
      acceptedModelId: params.acceptedModelId,
      windowStartedAt: params.windowStartedAt,
      windowFinishedAt: params.windowFinishedAt,
    });
    return {
      token_id_hash: correlated.tokenIdHash,
      request_ids: correlated.requestIds,
      window_started_at: correlated.windowStartedAt,
      window_finished_at: correlated.windowFinishedAt,
      prompt_tokens: correlated.promptTokens,
      completion_tokens: correlated.completionTokens,
      total_tokens: correlated.totalTokens,
      spend_usd: correlated.spendUsd,
    };
  },
  snapshotGatewaySpend: (world, actor) => world.gateway.snapshotSpend(actor.gatewayKey),
  async assertNoManagedSpend(world, params) {
    // A fresh user-key actor never routed through the managed gateway, so its
    // token has zero LiteLLM spend rows — the observed isolation proof (LOCAL-3).
    // The product-ledger balance is deliberately NOT read (hard billing
    // non-goal, LQF-006): while zero LiteLLM rows implies no managed-credit
    // consumption, an inferred zero balance delta is never encoded as an
    // observed measurement. The real product balance/debit assertion is deferred
    // to the billing slice (LOCAL-BILL-*).
    const snapshot = await world.gateway.snapshotSpend(params.actor.gatewayKey);
    if (snapshot.requestIds.length > 0) {
      throw new Error(
        `assertNoManagedSpend: user-key route leaked ${snapshot.requestIds.length} LiteLLM spend row(s) ` +
          "for the actor key; the user-key turn must not consume managed credit.",
      );
    }
    return { litellmSpendRows: 0, managedBalanceReadDeferred: true };
  },
  closeWorld: (world) => world.close(),
};

// ── Collectors ───────────────────────────────────────────────────────────────

/**
 * LOCAL-2 collector (T3-CHAT-1/local, world-backed). One shared world for the
 * whole harness matrix; per assigned cell: gateway turn + reload + spend
 * correlation → green `local_route_turn` evidence; cursor → typed `blocked`.
 * Only invoked on a world-backed run (the legacy diagnostic path stays in
 * `t3-chat-1.ts`'s `runLocalLane`).
 */
export function collectLocal2GatewayCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: LocalRouteDriver = defaultLocalRouteDriver,
): Promise<ScenarioCellOutcome[]> {
  return runRouteBatch(ctx, cells, driver, runLocal2GatewayCell);
}

/**
 * LOCAL-3 collector (T3-AUTHROUTE-1/local/harness=<kind>, user-key). Cursor
 * excluded at expansion. Per cell: store+select user key via UI, bounded turn,
 * assert zero managed spend / zero balance change → green `local_route_turn`
 * (route=user_key).
 */
export function collectLocal3UserKeyCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: LocalRouteDriver = defaultLocalRouteDriver,
): Promise<ScenarioCellOutcome[]> {
  return runRouteBatch(ctx, cells, driver, runLocal3UserKeyCell);
}

/**
 * LOCAL-6 collector (T3-AUTHROUTE-1/local/route=change, single cell). Dual-route
 * actor: prove user-key session, switch selected route to gateway, prove a new
 * gateway session with correlated spend while the old session stays user-key →
 * green `local_route_turn` with a `route_change` block.
 */
export async function collectLocal6RouteChangeCell(
  ctx: ScenarioRunContext,
  cell: PlannedCellV1,
  driver: LocalRouteDriver = defaultLocalRouteDriver,
): Promise<ScenarioCellOutcome> {
  const outcomes = await runRouteBatch(ctx, [cell], driver, runLocal6RouteChangeCell);
  return outcomes[0]!;
}

/**
 * The per-green-cell payload, captured before world teardown. The shared cleanup
 * receipt is folded into every green cell's evidence AFTER the single
 * `closeWorld` (BRIEF §"World lifecycle").
 */
interface GreenRoutePayload {
  journey: LocalRouteTurnEvidenceV1["journey"];
  route: LocalRoute;
  harness: LocalHarnessKind;
  modelId: string;
  workspaceId: string;
  sessionId: string;
  gatewaySpend: LocalLitellmSpendV1 | null;
  userKeyIsolation: { litellmSpendRows: 0; managedBalanceReadDeferred: true } | null;
  routeChange: LocalRouteTurnEvidenceV1["route_change"];
}

type PendingRouteCell =
  | { cellId: string; kind: "green"; green: GreenRoutePayload }
  | { cellId: string; kind: "terminal"; status: "failed" | "blocked"; reason: { code: "scenario_failure" | "scenario_blocked"; message: string } };

type RunOneRouteCell = (
  cell: PlannedCellV1,
  world: ReadyLocalWorld,
  driver: LocalRouteDriver,
) => Promise<PendingRouteCell>;

/**
 * Shared batch lifecycle: build one world, run each assigned cell against it,
 * close the world exactly once in `finally`, then fold the single cleanup
 * receipt into every green cell's evidence (a cleanup failure fails the green
 * cells). A non-world-backed run yields a clean per-cell `blocked` (the new
 * T3-AUTHROUTE-1 scenario has no legacy path); a world-construction failure
 * fails the whole batch cleanly — never a throw out of `runCells`.
 */
async function runRouteBatch(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: LocalRouteDriver,
  runCell: RunOneRouteCell,
): Promise<ScenarioCellOutcome[]> {
  if (!isWorldBackedRun(ctx)) {
    return cells.map((cell) => ({
      cellId: cell.cell_id,
      status: "blocked" as const,
      reason: {
        code: "scenario_blocked" as const,
        message: "this functional route journey requires the candidate world; no candidate build map was supplied",
      },
    }));
  }

  let world: ReadyLocalWorld;
  try {
    // One world per scenario, keyed by scenario id for its isolated subdir.
    world = await driver.buildWorld(ctx, cells[0]?.scenario_id ?? "route");
  } catch (error) {
    return cells.map((cell) => ({
      cellId: cell.cell_id,
      status: "failed" as const,
      reason: { code: "scenario_failure" as const, message: `world construction failed: ${describe(error)}` },
    }));
  }

  const pendings: PendingRouteCell[] = [];
  let cleanupResult: LocalWorldCleanupEvidence | null = null;
  let closeError: unknown;
  try {
    for (const cell of cells) {
      pendings.push(await runCell(cell, world, driver));
    }
  } finally {
    try {
      cleanupResult = await driver.closeWorld(world);
    } catch (error) {
      closeError = error;
    }
  }

  return pendings.map((pending) => finalizePending(pending, world, cleanupResult, closeError));
}

/** Folds the shared cleanup receipt into a green cell's evidence and applies the
 * green cleanup rule; terminal cells pass through unchanged. */
function finalizePending(
  pending: PendingRouteCell,
  world: ReadyLocalWorld,
  cleanupResult: LocalWorldCleanupEvidence | null,
  closeError: unknown,
): ScenarioCellOutcome {
  if (pending.kind === "terminal") {
    return { cellId: pending.cellId, status: pending.status, reason: pending.reason };
  }
  if (!cleanupResult) {
    return {
      cellId: pending.cellId,
      status: "failed",
      reason: { code: "scenario_failure", message: `world cleanup did not complete: ${describe(closeError)}` },
    };
  }
  const cleanup = toCleanupV1(cleanupResult);
  const evidence = buildLocalRouteTurnEvidence({
    journey: pending.green.journey,
    route: pending.green.route,
    harness: pending.green.harness,
    artifactIds: artifactIdsOf(world),
    serverVersion: world.artifacts.server.version,
    anyharnessVersion: world.artifacts.anyharness.version,
    modelId: pending.green.modelId,
    workspaceId: pending.green.workspaceId,
    sessionId: pending.green.sessionId,
    gatewaySpend: pending.green.gatewaySpend,
    userKeyIsolation: pending.green.userKeyIsolation,
    routeChange: pending.green.routeChange,
    cleanup,
  });
  if (cleanupResult.failed > 0 || !allCleanupBooleansTrue(cleanupResult)) {
    return {
      cellId: pending.cellId,
      status: "failed",
      reason: { code: "scenario_failure", message: `cleanup did not fully reconcile (failed=${cleanupResult.failed})` },
      evidence,
    };
  }
  return { cellId: pending.cellId, status: "green", evidence };
}

/** LOCAL-2: one gateway turn per harness. Cursor → typed `blocked` (no gateway
 * auth slot), never green-required, never dropped (audit ruling #2). */
async function runLocal2GatewayCell(
  cell: PlannedCellV1,
  world: ReadyLocalWorld,
  driver: LocalRouteDriver,
): Promise<PendingRouteCell> {
  const harness = harnessOf(cell);
  if (HARNESSES_WITHOUT_GATEWAY_AUTH_SLOT.has(harness)) {
    return {
      cellId: cell.cell_id,
      kind: "terminal",
      status: "blocked",
      reason: {
        code: "scenario_blocked",
        message:
          `[${harness}] the candidate catalog ships no managed-gateway auth slot for this harness, so the ` +
          "managed gateway route is unsupported (it carries an account key, not a provider key); this cell is " +
          "the truthful typed-unsupported result and is never green-required",
      },
    };
  }
  try {
    const actor = await driver.createGatewayActor(world, harness);
    await world.trackActorSubjects?.(actor.gatewayKey);
    const repo = await driver.prepareRepo(world, actor, cell.cell_id);
    const page = await driver.openPage(world, actor);
    try {
      await driver.waitForRouteSync(world, page, harness, "gateway");
      await driver.ensureHarnessReady(world, page, harness);
      await driver.selectRepoAndWorkLocally(page, repo);
      const selection = await driver.resolveRouteModel(world, page, harness, "gateway");
      assertOpencodeProviderSource(harness, "gateway", selection);
      await driver.selectModelInUi(page, selection.modelId);
      const before = await driver.snapshotGatewaySpend(world, actor);
      const windowStartedAt = new Date().toISOString();
      const turn = await driver.sendBoundedTurn(world, page, "gateway", repo.path);
      if (!turn.reply.trim()) {
        throw new Error("empty assistant reply");
      }
      const windowFinishedAt = new Date().toISOString();
      await driver.reopenAndVerify(world, page, {
        workspaceId: turn.workspaceId,
        sessionId: turn.sessionId,
        modelId: selection.modelId,
        harness,
        route: "gateway",
        repoPath: repo.path,
      });
      const gatewaySpend = await driver.correlateGatewaySpend(world, {
        actor,
        acceptedModelId: selection.modelId,
        windowStartedAt,
        windowFinishedAt,
        before,
      });
      return {
        cellId: cell.cell_id,
        kind: "green",
        green: {
          journey: "LOCAL-2",
          route: "gateway",
          harness,
          modelId: selection.modelId,
          workspaceId: turn.workspaceId,
          sessionId: turn.sessionId,
          gatewaySpend,
          userKeyIsolation: null,
          routeChange: null,
        },
      };
    } catch (uiError) {
      await captureLocalDriverFailure(page, `${cell.cell_id}-ui-failure`);
      throw uiError;
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (error) {
    return failedPending(cell, error);
  }
}

/** LOCAL-3: one user-key turn per harness. Store+select the BYOK key through the
 * UI, run the bounded turn, assert zero managed spend + zero balance change. */
async function runLocal3UserKeyCell(
  cell: PlannedCellV1,
  world: ReadyLocalWorld,
  driver: LocalRouteDriver,
): Promise<PendingRouteCell> {
  const harness = harnessOf(cell);
  try {
    const actor = await driver.createUserKeyActor(world, harness);
    await world.trackActorSubjects?.(actor.gatewayKey);
    const repo = await driver.prepareRepo(world, actor, cell.cell_id);
    const page = await driver.openPage(world, actor);
    try {
      // Store + SELECT the user key FIRST (decision #3): on the api_key route a
      // harness only surfaces models in its launch-options once the provider key
      // is stored AND the api_key route selected. Then INSTALL before polling the
      // sync signal: `waitForRouteSync("user_key")` reads launch-options, and an
      // agent appears there only once its agent process is INSTALLED. On a fresh
      // world claude is `install_required`, and only `ensureHarnessReady` triggers
      // the install, so polling launch-options before it can never converge.
      //
      // NOTE on the api_key route yielding launchable models: this requires the
      // runtime to emit a credential fact for a stored api_key source so the
      // catalog's env-signaled auth context activates and `visible_models` is
      // non-empty. On the frozen PR-1 base runtime it did NOT (an api_key-only
      // source emitted no fact → empty model menu forever — the same defect a
      // real BYOK desktop user hit, since the composer picker keys off the same
      // launch-options `models[]`). Fixed on main by #1236 ("scope models to
      // active auth route", `collect_enrolled_source_facts` now pushes
      // `CredentialFact::Env` for api_key sources); this cell requires the
      // rebased/rebuilt candidate that includes it. The ordering below is the
      // driver's own correctness requirement, independent of that runtime fix.
      await driver.storeAndSelectUserKeyRoute(page, harness);
      await driver.ensureHarnessReady(world, page, harness);
      await driver.waitForRouteSync(world, page, harness, "user_key");
      await driver.selectRepoAndWorkLocally(page, repo);
      const selection = await driver.resolveRouteModel(world, page, harness, "user_key");
      assertOpencodeProviderSource(harness, "user_key", selection);
      await driver.selectModelInUi(page, selection.modelId);
      const windowStartedAt = new Date().toISOString();
      const turn = await driver.sendBoundedTurn(world, page, "user_key", repo.path);
      if (!turn.reply.trim()) {
        throw new Error("empty assistant reply");
      }
      const windowFinishedAt = new Date().toISOString();
      await driver.reopenAndVerify(world, page, {
        workspaceId: turn.workspaceId,
        sessionId: turn.sessionId,
        modelId: selection.modelId,
        harness,
        route: "user_key",
        repoPath: repo.path,
      });
      const isolation = await driver.assertNoManagedSpend(world, { actor, windowStartedAt, windowFinishedAt });
      return {
        cellId: cell.cell_id,
        kind: "green",
        green: {
          journey: "LOCAL-3",
          route: "user_key",
          harness,
          modelId: selection.modelId,
          workspaceId: turn.workspaceId,
          sessionId: turn.sessionId,
          gatewaySpend: null,
          userKeyIsolation: isolation,
          routeChange: null,
        },
      };
    } catch (uiError) {
      await captureLocalDriverFailure(page, `${cell.cell_id}-ui-failure`);
      throw uiError;
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (error) {
    return failedPending(cell, error);
  }
}

/** LOCAL-6: one dual-route actor. Prove a user-key session, switch the selected
 * route to gateway, prove a NEW gateway session with correlated spend; the old
 * user-key session stays on its original route (route frozen at process start). */
async function runLocal6RouteChangeCell(
  cell: PlannedCellV1,
  world: ReadyLocalWorld,
  driver: LocalRouteDriver,
): Promise<PendingRouteCell> {
  const harness = LOCAL6_REPRESENTATIVE_HARNESS;
  try {
    const actor = await driver.createDualRouteActor(world, harness);
    await world.trackActorSubjects?.(actor.gatewayKey);
    const repo = await driver.prepareRepo(world, actor, cell.cell_id);
    const page = await driver.openPage(world, actor);
    try {
      // 1) Start + prove the user-key session (the original route). Store +
      // select the user key first (decision #3), then INSTALL via
      // `ensureHarnessReady` BEFORE polling the user-key sync signal: the
      // launch-options signal `waitForRouteSync("user_key")` lists an agent only
      // once its process is installed, and only `ensureHarnessReady` triggers the
      // install on a fresh world. (The api_key route only yields launchable models
      // on a runtime carrying #1236's api_key credential fact — see the LOCAL-3
      // note above; this route-change cell requires the same rebased/rebuilt
      // candidate.)
      await driver.storeAndSelectUserKeyRoute(page, harness);
      await driver.ensureHarnessReady(world, page, harness);
      await driver.waitForRouteSync(world, page, harness, "user_key");
      await driver.selectRepoAndWorkLocally(page, repo);
      const userKeySelection = await driver.resolveRouteModel(world, page, harness, "user_key");
      await driver.selectModelInUi(page, userKeySelection.modelId);
      const userKeyTurn = await driver.sendBoundedTurn(world, page, "user_key", repo.path);
      if (!userKeyTurn.reply.trim()) {
        throw new Error("empty assistant reply on the user-key session");
      }
      await driver.reopenAndVerify(world, page, {
        workspaceId: userKeyTurn.workspaceId,
        sessionId: userKeyTurn.sessionId,
        modelId: userKeySelection.modelId,
        harness,
        route: "user_key",
        repoPath: repo.path,
      });

      // 2) Switch the selected route to gateway; a NEW session launches on it.
      // `switchSelectedRouteToGateway` opens a fresh in-workspace chat tab (so the
      // gateway turn is a genuinely new session, not a rejected live config-switch
      // on the user-key session). The workspace/repo binding is retained by the
      // new-tab path — no repo re-selection needed (those "Project:"/"Runtime:"
      // controls exist only on the home screen).
      // Snapshot the pre-existing sessions BEFORE `switchSelectedRouteToGateway`:
      // its trailing `openNewChat` navigation materializes the new AnyHarness
      // session immediately (product's create-session path runs unconditionally
      // on open), so a snapshot taken after it would wrongly count that session
      // as pre-existing and leave `sendBoundedTurn` unable to find a "new"
      // candidate (Actions run 29628880856, T3-AUTHROUTE-1/local/route=change).
      const preRouteSwitchSessionIds = await snapshotLocalWorkspaceSessionIds(world, repo.path);
      await driver.switchSelectedRouteToGateway(world, page, harness);
      const gatewaySelection = await driver.resolveRouteModel(world, page, harness, "gateway");
      await driver.selectModelInUi(page, gatewaySelection.modelId);
      const before = await driver.snapshotGatewaySpend(world, actor);
      const windowStartedAt = new Date().toISOString();
      const gatewayTurn = await driver.sendBoundedTurn(world, page, "gateway", repo.path, preRouteSwitchSessionIds);
      if (!gatewayTurn.reply.trim()) {
        throw new Error("empty assistant reply on the gateway session");
      }
      const windowFinishedAt = new Date().toISOString();
      if (gatewayTurn.sessionId === userKeyTurn.sessionId) {
        throw new Error("route change did not start a new session; the gateway turn reused the user-key session");
      }
      await driver.reopenAndVerify(world, page, {
        workspaceId: gatewayTurn.workspaceId,
        sessionId: gatewayTurn.sessionId,
        modelId: gatewaySelection.modelId,
        harness,
        route: "gateway",
        repoPath: repo.path,
      });
      const gatewaySpend = await driver.correlateGatewaySpend(world, {
        actor,
        acceptedModelId: gatewaySelection.modelId,
        windowStartedAt,
        windowFinishedAt,
        before,
      });

      return {
        cellId: cell.cell_id,
        kind: "green",
        green: {
          journey: "LOCAL-6",
          route: "gateway",
          harness,
          modelId: gatewaySelection.modelId,
          workspaceId: gatewayTurn.workspaceId,
          sessionId: gatewayTurn.sessionId,
          gatewaySpend,
          userKeyIsolation: null,
          routeChange: {
            original_route: "user_key",
            original_session_id_hash: sha256Hex(userKeyTurn.sessionId),
            new_route: "gateway",
            new_session_id_hash: sha256Hex(gatewayTurn.sessionId),
          },
        },
      };
    } catch (uiError) {
      await captureLocalDriverFailure(page, `${cell.cell_id}-ui-failure`);
      throw uiError;
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (error) {
    return failedPending(cell, error);
  }
}

/** Assembles a green LOCAL-2/3/6 `local_route_turn` evidence record. Exported so
 * the collectors and their unit tests share one construction path. */
export function buildLocalRouteTurnEvidence(input: {
  journey: LocalRouteTurnEvidenceV1["journey"];
  route: LocalRoute;
  harness: LocalHarnessKind;
  artifactIds: string[];
  serverVersion: string;
  anyharnessVersion: string;
  modelId: string;
  workspaceId: string;
  sessionId: string;
  gatewaySpend: LocalLitellmSpendV1 | null;
  userKeyIsolation: { litellmSpendRows: 0; managedBalanceReadDeferred: true } | null;
  routeChange: LocalRouteTurnEvidenceV1["route_change"];
  cleanup: LocalCleanupV1;
}): LocalRouteTurnEvidenceV1 {
  return {
    kind: "local_route_turn",
    journey: input.journey,
    artifact_ids: input.artifactIds,
    server_version: input.serverVersion,
    anyharness_version: input.anyharnessVersion,
    harness: input.harness,
    route: input.route,
    model_id: input.modelId,
    workspace_id_hash: sha256Hex(input.workspaceId),
    session_id_hash: sha256Hex(input.sessionId),
    transcript_reopened: true,
    gateway_spend: input.gatewaySpend,
    user_key_isolation: input.userKeyIsolation
      ? {
          litellm_spend_rows: input.userKeyIsolation.litellmSpendRows,
          managed_balance_read_deferred: input.userKeyIsolation.managedBalanceReadDeferred,
        }
      : null,
    route_change: input.routeChange,
    billing_reconcile_deferred: true,
    cleanup: input.cleanup,
  };
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** OpenCode's provider source must be route-correct: the injected `proliferate`
 * gateway provider on the gateway route, a matching DIRECT provider on the
 * user-key route (BRIEF §"model-selection rules"). Other harnesses are exempt. */
export function assertOpencodeProviderSource(
  harness: LocalHarnessKind,
  route: LocalRoute,
  selection: RouteModelSelection,
): void {
  if (harness !== "opencode") {
    return;
  }
  if (route === "gateway") {
    if (selection.providerId !== GATEWAY_PROVIDER_ID) {
      throw new Error(
        `[opencode] gateway cell must select a model from the injected "${GATEWAY_PROVIDER_ID}" provider ` +
          `(got "${selection.providerId ?? "<none>"}"), so a native/direct provider cannot satisfy the turn`,
      );
    }
    return;
  }
  if (!selection.providerId || selection.providerId === GATEWAY_PROVIDER_ID) {
    throw new Error(
      `[opencode] user-key cell must select a model of the matching DIRECT provider, not the injected ` +
        `"${GATEWAY_PROVIDER_ID}" gateway provider (got "${selection.providerId ?? "<none>"}")`,
    );
  }
}

function harnessOf(cell: PlannedCellV1): LocalHarnessKind {
  return cell.dimensions.harness as LocalHarnessKind;
}

function failedPending(cell: PlannedCellV1, error: unknown): PendingRouteCell {
  return {
    cellId: cell.cell_id,
    kind: "terminal",
    status: "failed",
    reason: { code: "scenario_failure", message: describe(error) },
  };
}

function artifactIdsOf(world: ReadyLocalWorld): string[] {
  return [
    world.artifacts.server.artifact_id,
    world.artifacts.anyharness.artifact_id,
    world.artifacts.desktopRenderer.artifact_id,
  ];
}

function toCleanupV1(cleanup: LocalWorldCleanupEvidence): LocalCleanupV1 {
  return {
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
  };
}

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

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cheapest-first tier ranking for direct-provider (user-key) model ids; Fable
 * excluded upstream. Cost is not on the wire, so a deterministic tier ladder is
 * the proxy (small/haiku/mini/nano < sonnet/medium < opus/large). */
function pickCheapestModelId(ids: readonly string[]): string {
  const rank = (id: string): number => {
    const lower = id.toLowerCase();
    if (/haiku|mini|nano|small|flash|lite/.test(lower)) return 0;
    if (/sonnet|medium/.test(lower)) return 1;
    if (/opus|large/.test(lower)) return 2;
    return 3;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0]!;
}

/** The direct provider id a model belongs to, from a `provider/model` id prefix
 * (e.g. `anthropic/claude-...` → `anthropic`); undefined for an unprefixed id. */
function directProviderId(modelId: string): string | undefined {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash) : undefined;
}

/** Escapes a value for safe interpolation inside a `[attr="…"]` CSS selector. */
function cssAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Thrown when the per-harness auth / integration UI is unreachable because the
 * desktop's `cloudActive` is false (server capability `cloudWorkspaces` off — no
 * cloud-compute provisioning). A truthful, actionable fail-closed signal for the
 * LOCAL-3/6 cells: the navigation + selectors are correct, but the surface is
 * product-gated in the local qualification world. Surfaced for a ruling — never a
 * silently-weakened assertion.
 */
export class CloudSurfaceGatedError extends Error {}

/** The Agents-scope settings sidebar label for each harness (fix round 3: the
 * user-key surface lives on the per-harness settings pane, reached via the
 * account menu → Settings → Agents scope → this row — NOT the workspace-scoped
 * "Repo's settings" button the round-2 driver clicked, and NOT the cloud-gated
 * `agent-api-keys` ApiKeysPane, which is a titled key vault, not the api_key
 * route surface). Verified against the live renderer DOM (fix round 3). */
const HARNESS_SETTINGS_LABEL: Readonly<Record<LocalHarnessKind, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
  opencode: "OpenCode",
  cursor: "Cursor",
};

/**
 * Opens the real app Settings surface: the sidebar account block's "Open account
 * menu" button → the "Settings" menu item (`navigate("/settings?section=account")`).
 * The workspace-scoped "Repo's settings" control the round-2 driver matched with
 * `getByRole(button, /settings/i)` is a DIFFERENT surface and never shows the
 * harness auth cards — hence the round-2 timeout.
 */
async function openAppSettings(page: Page): Promise<void> {
  // The main sidebar starts collapsed on a fresh renderer; the account block that
  // owns the "Settings" entry lives in it. Expand it first if the "Show sidebar"
  // toggle is present (verified against the live DOM, fix round 3).
  await ensureSidebarOpen(page);
  await page.getByRole("button", { name: "Open account menu" }).first().click();
  // The account popover's "Settings" row is a native button; its accessible name
  // includes the trailing shortcut hint, so match on the leading label.
  const settingsItem = page.getByRole("button", { name: /^settings/i }).first();
  await settingsItem.waitFor({ state: "visible", timeout: SETTINGS_STEP_TIMEOUT_MS });
  await settingsItem.click();
  // The settings screen renders its scope tablist and a "Back to app" control.
  await page.getByRole("button", { name: /back to app/i }).first().waitFor({ state: "visible", timeout: SETTINGS_STEP_TIMEOUT_MS });
}

/**
 * Navigates to a harness's per-agent settings pane (Agents scope → harness row)
 * and waits for its authentication method cards to render. Fails closed if the
 * auth section never appears — that is the live signal that the cloud surface is
 * gated (cloudActive false), reported by the caller as a product-config gap
 * rather than silently passing.
 */
async function openHarnessSettings(page: Page, harness: LocalHarnessKind): Promise<void> {
  await openAppSettings(page);
  await page.getByRole("tab", { name: /agents/i }).first().click();
  const label = HARNESS_SETTINGS_LABEL[harness];
  await page.getByRole("button", { name: label, exact: false }).first().click();
  const authSection = page.locator(`[data-harness-auth-section="${cssAttr(harness)}"]`).first();
  // Race the expected auth cards against the cloud sign-in gate so a gated build
  // fails closed with a precise reason instead of an opaque waitFor timeout.
  const gate = page.getByText("Sign in to Proliferate Cloud", { exact: false }).first();
  const deadline = Date.now() + SETTINGS_STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await authSection.isVisible().catch(() => false)) {
      return;
    }
    if (await gate.isVisible().catch(() => false)) {
      throw new CloudSurfaceGatedError(
        `[${harness}] the per-harness auth surface is gated behind "Sign in to Proliferate Cloud" ` +
          "(cloudActive=false). The api_key/gateway model-auth UI requires cloudActive, which the desktop " +
          "derives from the server capability contract's cloudWorkspaces flag " +
          "(server: cloud_provisioning_configured, i.e. E2B cloud-compute configured). The local qualification " +
          "world configures no cloud compute, so cloudWorkspaces=false → cloudActive=false and this surface " +
          "cannot be driven. Resolution is a ruling: either the qual world declares cloud provisioning so " +
          "cloudActive is true, or the product decouples model-auth/integration UI from the cloud-compute gate.",
      );
    }
    await sleep(500);
  }
  throw new Error(`openHarnessSettings: [${harness}] the harness auth section never rendered.`);
}

/** Expands the main sidebar if it is collapsed (the "Show sidebar" toggle is
 * only present while collapsed). Best-effort; a no-op when already open. */
async function ensureSidebarOpen(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Show sidebar" }).first();
  if (await toggle.count().catch(() => 0)) {
    await toggle.click({ timeout: SETTINGS_STEP_TIMEOUT_MS }).catch(() => undefined);
  }
  await page
    .getByRole("button", { name: "Open account menu" })
    .first()
    .waitFor({ state: "visible", timeout: SETTINGS_STEP_TIMEOUT_MS });
}

/** Returns from the settings surface to the app. Waits for `expectedSurface` to
 * become visible afterward — the home composer by default (LOCAL-2/3 callers,
 * where no workspace is active yet), but callers with an already-active
 * workspace (e.g. LOCAL-6's `switchSelectedRouteToGateway`, where the product
 * returns to the workspace chat shell rather than the home screen) must pass
 * the surface it actually lands on, or this waits forever for a selector that
 * never appears (proven: Actions run 29549140268, T3-AUTHROUTE-1/local/route=change). */
async function returnToAppHome(page: Page, expectedSurface = "[data-home-composer-editor]"): Promise<void> {
  await page.getByRole("button", { name: /back to app/i }).first().click();
  await page
    .locator(expectedSurface)
    .first()
    .waitFor({ state: "visible", timeout: SETTINGS_STEP_TIMEOUT_MS });
}

/** Opens a NEW, genuinely-empty session tab in the CURRENT workspace via the
 * header "+" new-tab button (`data-chat-new-tab-button`, sr-only label "New
 * chat" → openNewSessionTab → createEmptySessionWithResolvedConfig). This stays
 * inside the active workspace shell — the workspace/repo binding is retained —
 * and lands on the in-workspace chat composer (`[data-chat-composer-editor]`),
 * NOT the standalone home screen's `[data-home-composer-editor]`. That fresh
 * session is what makes the gateway turn a new session distinct from the
 * user-key one, without a rejected live config switch on the old session. */
async function openNewChat(page: Page): Promise<void> {
  await page.locator("[data-chat-new-tab-button]:not([disabled])").first().click();
  await page
    .locator("[data-chat-composer-editor]")
    .first()
    .waitFor({ state: "visible", timeout: SETTINGS_STEP_TIMEOUT_MS });
}

/** Selects a harness's auth route (`gateway`/`api_key`/`native`) via
 * `HarnessAuthSection`'s route options, then waits for the selected-route
 * readback to reflect it. The renderer's `data-harness-selected-route` carries
 * the selection as whitespace-separated `<kind>:<route>` tokens (a multi-source
 * harness like opencode can have several routes active at once), so the
 * readback is the exact-token `~=` attribute match — a strict equality on the
 * just-selected route, not a substring heuristic. */
async function selectHarnessRoute(page: Page, harness: string, route: "gateway" | "api_key" | "native"): Promise<void> {
  await page
    .locator(`[data-harness-auth-section="${cssAttr(harness)}"]`)
    .first()
    .waitFor({ state: "visible", timeout: SETTINGS_STEP_TIMEOUT_MS });
  await page.locator(`[data-harness-route-option="${cssAttr(`${harness}:${route}`)}"]`).first().click();
  await page
    .locator(`[data-harness-selected-route~="${cssAttr(`${harness}:${route}`)}"]`)
    .first()
    .waitFor({ state: "attached", timeout: SETTINGS_STEP_TIMEOUT_MS });
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

/** Polls AnyHarness's session event stream until the turn ends or errors. */
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

/** Waits for a settled (non-streaming) assistant prose block with non-empty text. */
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
