import { createHash } from "node:crypto";

import type { Page } from "playwright";

import type { ScenarioCellOutcome, ScenarioRunContext } from "../types.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import { authenticatedActor, type AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import { findErrorEvent, findTurnEndedEvent } from "../../fixtures/local-runtime.js";
import { preparedRepository, type PreparedRepository } from "../../fixtures/prepared-repository.js";
import { productPage, type ProductPage } from "../../fixtures/product-page.js";
import { selectCheapestEligibleClaudeModel } from "../../services/qualification-litellm.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";
import {
  LOCAL_HARNESS_KINDS,
  type LocalCleanupV1,
  type LocalConfigMatrixEvidenceV1,
  type LocalHarnessKind,
  type LocalSessionTabsEvidenceV1,
} from "../../evidence/schema.js";
import { resolveWorldConstructionInputs } from "../local-world-smoke-1.js";
import { bootLocalFunctionalWorld, type LocalFunctionalWorldInputs } from "./world-boot.js";
import { captureLocalDriverFailure } from "./debug-capture.js";
import { resolveLocalWorkspaceSessionId } from "./local-session.js";
import {
  GATEWAY_UNSUPPORTED_HARNESSES,
  gatewayUnsupportedMessage,
} from "../../fixtures/gateway-unsupported-harnesses.js";
import { waitForSidebarControlReady } from "./sidebar-control-readiness.js";

/**
 * LOCAL-4 (live configuration matrix, per harness) under `T3-CFG-1/local`, and
 * LOCAL-5 (session and tab semantics, single cell) under `T3-SESSION-1/local`.
 * Owner: config-session workstream.
 *
 * LOCAL-4 (audit ruling #5): `t3-cfg-1`'s API-only value-cycling LOGIC is reused
 * (enumerate `normalizedControls`, cycle each settable control's values), but
 * ACCEPTANCE is UI-driven per the contract: select each value THROUGH the
 * product surface (composer config/mode/reasoning controls — new `data-*`
 * testids), wait beyond the normal rejection window, and read back. A rejected
 * value must leave the last accepted value intact. Known #1063 rejections stay
 * tracked expected-fail, NOT green.
 *
 * LOCAL-5 proves, in one workspace: empty-chat harness switch replaces the
 * unused backend session (id changes, one visible tab); switch-after-messages
 * preserves the old transcript and opens a new tab immediately to its right;
 * same-harness model change stays in-session where permitted; reload preserves
 * tab order, active tab, harness attachment, and transcript. New tab-strip
 * `data-*` testids are added by builders-ci (attributes only, BRIEF §4.6).
 *
 * World lifecycle (BRIEF §2): each collector boots its OWN `ReadyLocalWorld`
 * from the validated candidate inputs (single-sourced through the smoke's
 * `resolveWorldConstructionInputs`), constructs it behind the `buildWorld` driver
 * seam (production → `bootLocalFunctionalWorld`), and closes it exactly once in a
 * `finally`; the cleanup receipt folds into each green cell's evidence.
 */

/** The bounded baseline prompt used before the LOCAL-4 config cycle (contract:
 * config only after one real turn) and by LOCAL-5's `sendMessage`. */
export const BASELINE_PROMPT = "Reply with exactly the word: pong";

/** LOCAL-5 starts on claude (matches `SESSION_TABS_START_HARNESS`) and switches
 * to a second shipped kind so the tab/session replacement is observable. */
export const SESSION_TABS_START_HARNESS: LocalHarnessKind = "claude";
export const SESSION_TABS_SWITCH_HARNESS: LocalHarnessKind = "codex";

/** Bounded waits for the live browser flow (kept generous but finite). */
const HARNESS_READY_TIMEOUT_MS = 300_000;
const MODEL_PICKER_TIMEOUT_MS = 60_000;
const WORKSPACE_SETTLE_TIMEOUT_MS = 90_000;
const TURN_TIMEOUT_MS = 300_000;
/** How long past a config selection to wait before reading back — must exceed the
 * runtime's normal apply/reject window so a late rejection has settled first. */
const CONFIG_REJECTION_WINDOW_MS = 6_000;
const TAB_SETTLE_TIMEOUT_MS = 30_000;

type ScenarioCellOutcomeWithEvidence = ScenarioCellOutcome & { evidence?: LocalConfigMatrixEvidenceV1 | LocalSessionTabsEvidenceV1 };

/** Every privileged/UI step LOCAL-4 performs, faked in offline unit tests. */
export interface LocalConfigDriver {
  /** Boots the candidate world from resolved inputs (production →
   * `bootLocalFunctionalWorld`); faked entirely in unit tests. `worldId` scopes
   * the world's isolated subdir (world-per-scenario, serialized). */
  buildWorld(inputs: LocalFunctionalWorldInputs, worldId: string): Promise<ReadyLocalWorld>;
  createActor(world: ReadyLocalWorld, harness: LocalHarnessKind): Promise<AuthenticatedActor>;
  /**
   * Selects the `gateway` route for `harness` through the genuine product
   * selections API (`PUT /v1/cloud/agent-gateway/selections/{harness}?surface=local`
   * — the exact call `HarnessSettingsSection` drives, and the one
   * `authenticatedActor` itself uses for its default harness). LOCAL-4 reuses ONE
   * owner actor across the whole harness batch, but `authenticatedActor` selects
   * only the default harness's (claude's) route; without a selection for the
   * other runnable harnesses the server's local-surface state.json carries no
   * route for them, so the REAL renderer's `useLocalAuthStateSync` has nothing to
   * push and their launch-options never populate — the codex/grok/opencode
   * "never became launchable within 300s" red (run 29628880856). Called for every
   * runnable harness BEFORE `openPage`, so the renderer boots once with all routes
   * present and its worker-independent `PUT /v1/agent-auth/state` sync lands them
   * all at startup (an out-of-band selection made after boot would not trigger the
   * renderer's own agent-auth-state refetch). The gateway route still reaches
   * AnyHarness only through the real product renderer path — nothing is seeded
   * into AnyHarness world-side, and readiness is never synthesized.
   */
  selectGatewayRoute(actor: AuthenticatedActor, harness: LocalHarnessKind): Promise<void>;
  prepareRepo(world: ReadyLocalWorld, actor: AuthenticatedActor, cellId: string): Promise<PreparedRepository>;
  openPage(world: ReadyLocalWorld, actor: AuthenticatedActor): Promise<ProductPage>;
  ensureHarnessReady(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind): Promise<void>;
  selectRepoAndWorkLocally(page: ProductPage, repo: PreparedRepository): Promise<void>;

  /** Runs the harness's cheap baseline turn first (contract: config only after
   * a real turn), returning the materialized workspace/session ids + model. */
  runBaselineTurn(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind, repoPath: string): Promise<{ workspaceId: string; sessionId: string; modelId: string }>;

  /** Enumerates the session's live-probe controls (reuses the runtime's
   * `GET /v1/sessions/{id}/live-config` `normalizedControls`, the t3-cfg-1 seam). */
  enumerateControls(world: ReadyLocalWorld, sessionId: string): Promise<LocalConfigControl[]>;

  /**
   * Selects `value` for `control` THROUGH the product UI (composer
   * SessionConfigControls / SessionModeControl / ComposerReasoningEffortBars /
   * model picker), waits beyond the rejection window, and reads the value back
   * from the UI. Returns whether it was accepted or rejected-and-restored.
   */
  selectConfigValueInUi(page: ProductPage, control: LocalConfigControl, value: string): Promise<{ accepted: boolean; readback: string }>;

  closeWorld(world: ReadyLocalWorld): ReturnType<ReadyLocalWorld["close"]>;
}

/** One settable control the live probe advertises (mirror of the runtime's
 * `LiveConfigOption`, narrowed to what LOCAL-4 drives through the UI). */
export interface LocalConfigControl {
  key: string;
  rawConfigId: string;
  currentValue: string;
  settable: boolean;
  values: readonly string[];
  /** Which composer surface renders it, so the driver picks the right testid.
   * Only "mode" (SessionModeControl popover) and "reasoning"
   * (ComposerReasoningEffortBars stepper) exist on the live chat composer —
   * see `configSurfaceFor` for why the other advertised controls are excluded. */
  surface: "mode" | "reasoning";
}

/** Every privileged/UI step LOCAL-5 performs, faked in offline unit tests. */
export interface LocalSessionTabsDriver {
  buildWorld(inputs: LocalFunctionalWorldInputs, worldId: string): Promise<ReadyLocalWorld>;
  createActor(world: ReadyLocalWorld): Promise<AuthenticatedActor>;
  prepareRepo(world: ReadyLocalWorld, actor: AuthenticatedActor, cellId: string): Promise<PreparedRepository>;
  openPage(world: ReadyLocalWorld, actor: AuthenticatedActor): Promise<ProductPage>;
  ensureHarnessReady(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind): Promise<void>;
  selectRepoAndWorkLocally(page: ProductPage, repo: PreparedRepository): Promise<void>;
  /** Materializes the FIRST chat (tab A) by sending a prompt and awaiting turn
   * completion — this necessarily gives the tab transcript (a materialized
   * session is never empty per the product's `isSessionEmpty`), so this is the
   * "messaged" starting point, not an empty chat. Named for what it does: the
   * genuinely EMPTY tab used for the empty-chat-switch proof is the one the
   * product itself opens later, in `switchHarnessAfterMessages`. */
  materializeFirstChat(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind): Promise<{ workspaceId: string; sessionId: string; tabId: string }>;

  /** Switch harness on a GENUINELY EMPTY chat tab (the one `switchHarnessAfterMessages`
   * just opened): asserts the in-place replacement (tab count and the tab's
   * position/index unchanged; a NEW backend session id on the SAME tab
   * position). Returns the old/new session ids, the tab's (unchanged) index,
   * whether the tab count stayed the same, and whether the call was a no-op
   * (requested the harness the tab was already on). */
  switchHarnessEmptyChat(world: ReadyLocalWorld, page: ProductPage, toHarness: LocalHarnessKind): Promise<{ oldSessionId: string; newSessionId: string; tabIndex: number; tabCountUnchanged: boolean; noOp: boolean }>;

  /** Send a message so the current (active) session has transcript. */
  sendMessage(world: ReadyLocalWorld, page: ProductPage): Promise<{ sessionId: string }>;

  /** Switch harness AFTER messages: old transcript preserved on its tab, a NEW
   * EMPTY tab created immediately to the right on `toHarness`. Returns both
   * tabs' ids, harnesses, AND the new tab's index so the caller can prove the
   * switch was real (the two tabs are on different harnesses) and later verify
   * the empty-chat switch kept that new tab's position stable. */
  switchHarnessAfterMessages(world: ReadyLocalWorld, page: ProductPage, toHarness: LocalHarnessKind): Promise<{ preservedTabId: string; preservedTabHarness: LocalHarnessKind; newTabId: string; newTabHarness: LocalHarnessKind; newTabIndex: number; newSessionId: string }>;

  /** Same harness, change to a DIFFERENT supported model (excluding the active
   * one): returns the before/after model ids and whether it stayed in-session
   * where the harness contract permits it. */
  changeModelSameHarness(world: ReadyLocalWorld, page: ProductPage): Promise<{ sessionId: string; fromModelId: string; toModelId: string; stayedInSession: boolean }>;

  /** Reload and assert tab order, active tab, and — for both the preserved old
   * tab and the active new tab — the expected harness and its transcript all
   * survive. */
  reloadAndVerifyTabs(world: ReadyLocalWorld, page: ProductPage, expect: { tabOrder: string[]; activeTabId: string; preservedTab: { id: string; harness: LocalHarnessKind }; activeTab: { id: string; harness: LocalHarnessKind } }): Promise<void>;

  closeWorld(world: ReadyLocalWorld): ReturnType<ReadyLocalWorld["close"]>;
}

// ── Production drivers: real world/fixtures/browser/runtime ──────────────────

export const defaultLocalConfigDriver: LocalConfigDriver = {
  buildWorld: (inputs, worldId) => bootLocalFunctionalWorld(inputs, worldId),
  createActor: (world) => authenticatedActor(world, "owner"),
  selectGatewayRoute: (actor, harness) => selectGatewayRouteForHarness(actor, harness),
  prepareRepo: (world, actor, cellId) => preparedRepository(world, actor, { cellId }),
  openPage: (world, actor) => productPage(world, actor),
  ensureHarnessReady: (world, page, harness) => ensureHarnessReady(world, page, harness),
  selectRepoAndWorkLocally: (page, repo) => selectRepoAndWorkLocally(page, repo),
  runBaselineTurn: (world, page, harness, repoPath) => runBaselineTurn(world, page, harness, repoPath),
  async enumerateControls(world, sessionId) {
    const live = await world.runtime.client.getLiveConfig(sessionId);
    const normalized = Object.values(live.normalizedControls);
    // The reasoning bars render ONE ladder: `effort` wins over `reasoning` when
    // both are advertised (resolveReasoningEffortControl), so a shadowed
    // `reasoning` control has no surface of its own.
    const hasEffort = normalized.some((control) => control.key === "effort");
    return normalized.flatMap((control) => {
      const surface = configSurfaceFor(control.key);
      if (!surface || (control.key === "reasoning" && hasEffort)) {
        // No live-composer surface renders this control (see configSurfaceFor);
        // it cannot be UI-driven, so LOCAL-4 excludes it from the cycle rather
        // than timing out against a selector that can never exist.
        return [];
      }
      return [
        {
          key: control.key,
          rawConfigId: control.rawConfigId,
          currentValue: control.currentValue,
          settable: control.settable,
          values: control.values.map((option) => option.value),
          surface,
        },
      ];
    });
  },
  selectConfigValueInUi: (page, control, value) => selectConfigValueInUi(page, control, value),
  closeWorld: (world) => world.close(),
};

export const defaultLocalSessionTabsDriver: LocalSessionTabsDriver = {
  buildWorld: (inputs, worldId) => bootLocalFunctionalWorld(inputs, worldId),
  createActor: async (world) => {
    const actor = await authenticatedActor(world, "owner");
    // LOCAL-5 launches sessions on BOTH harnesses (start + switch).
    // `authenticatedActor` selects the gateway route only for its default
    // harness (the start harness, claude); without a selected route the switch
    // harness never resolves launch credentials and can never appear in
    // launch-options, so select its gateway route through the same documented
    // selections API the actor fixture itself uses (fix round 4).
    await actor.api.put(
      `/v1/cloud/agent-gateway/selections/${encodeURIComponent(SESSION_TABS_SWITCH_HARNESS)}?surface=local`,
      { sources: [{ sourceKind: "gateway", enabled: true }] },
    );
    return actor;
  },
  prepareRepo: (world, actor, cellId) => preparedRepository(world, actor, { cellId }),
  openPage: (world, actor) => productPage(world, actor),
  ensureHarnessReady: (world, page, harness) => ensureHarnessReady(world, page, harness),
  selectRepoAndWorkLocally: (page, repo) => selectRepoAndWorkLocally(page, repo),
  materializeFirstChat: (world, page, harness) => materializeFirstChat(world, page, harness),
  switchHarnessEmptyChat: (world, page, toHarness) => switchHarnessEmptyChat(world, page, toHarness),
  sendMessage: (world, page) => sendMessage(world, page),
  switchHarnessAfterMessages: (world, page, toHarness) => switchHarnessAfterMessages(world, page, toHarness),
  changeModelSameHarness: (world, page) => changeModelSameHarness(world, page),
  reloadAndVerifyTabs: (world, page, expect) => reloadAndVerifyTabs(world, page, expect),
  closeWorld: (world) => world.close(),
};

// ── LOCAL-4 collector ────────────────────────────────────────────────────────

interface CollectedConfigCell {
  cell: PlannedCellV1;
  outcome:
    | { kind: "blocked"; message: string }
    | { kind: "failed"; message: string }
    | {
        kind: "ok";
        harness: LocalHarnessKind;
        modelId: string;
        workspaceId: string;
        sessionId: string;
        controls: Array<{ controlKey: string; acceptedValue: string; rejected: boolean }>;
        known1063: boolean;
      };
}

/** LOCAL-4 collector (T3-CFG-1/local/harness=<kind>, world-backed, UI-driven).
 *
 * One shared world for the whole harness matrix (BRIEF §2); one owner actor
 * reused across cells (LOCAL-4 permits reuse — sharding note "Configuration
 * cells may reuse the already-qualified harness process"); per assigned cell a
 * fresh baseline workspace/session + config cycle. Cursor → typed `blocked`. The
 * world is closed exactly once in `finally`; its cleanup receipt folds into each
 * green cell's evidence. */
export async function collectLocal4ConfigCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: LocalConfigDriver = defaultLocalConfigDriver,
): Promise<ScenarioCellOutcome[]> {
  const inputs = resolveWorldConstructionInputs(ctx);
  if (!inputs.ok) {
    return cells.map((cell) => failedOutcome(cell.cell_id, inputs.reason));
  }

  let world: ReadyLocalWorld;
  try {
    world = await driver.buildWorld(inputs.value, cells[0]?.scenario_id ?? "T3-CFG-1");
  } catch (error) {
    return cells.map((cell) => failedOutcome(cell.cell_id, `world construction failed: ${describe(error)}`));
  }

  const collected: CollectedConfigCell[] = [];
  let setupError: string | undefined;
  let cleanup: LocalCleanupV1 | null = null;
  let page: ProductPage | undefined;

  try {
    // A single owner actor + repo + page reused across the harness batch.
    const representative = firstRunnableHarness(cells) ?? SESSION_TABS_START_HARNESS;
    const actor = await driver.createActor(world, representative);
    await world.trackActorSubjects?.(actor.gatewayKey);
    // Select the gateway route for EVERY runnable harness in this batch before
    // the page boots. `createActor` selects only the representative harness's
    // route, but the reused actor drives baseline turns on each assigned kind;
    // without a per-harness selection the server's local-surface state.json
    // carries no route for the others, so the real renderer's
    // `useLocalAuthStateSync` has nothing to sync and their launch-options never
    // populate (codex/grok/opencode "never became launchable in 300s"). The
    // representative's selection is idempotent, so re-selecting it is harmless.
    for (const harness of runnableHarnesses(cells)) {
      await driver.selectGatewayRoute(actor, harness);
    }
    const repo = await driver.prepareRepo(world, actor, `${cells[0]?.scenario_id ?? "T3-CFG-1"}/local`);
    page = await driver.openPage(world, actor);

    for (const cell of cells) {
      const harness = normalizeHarness(cell.dimensions.harness);
      if (!harness) {
        collected.push({ cell, outcome: { kind: "blocked", message: `unknown harness "${cell.dimensions.harness}"` } });
        continue;
      }
      if (GATEWAY_UNSUPPORTED_HARNESSES.has(harness)) {
        collected.push({
          cell,
          outcome: {
            kind: "blocked",
            message: gatewayUnsupportedMessage(
              harness,
              "its LOCAL-4 baseline turn cannot run on the gateway-enrolled world",
            ),
          },
        });
        continue;
      }
      try {
        await driver.ensureHarnessReady(world, page, harness);
        await driver.selectRepoAndWorkLocally(page, repo);
        const { workspaceId, sessionId, modelId } = await driver.runBaselineTurn(world, page, harness, repo.path);
        const controls = await driver.enumerateControls(world, sessionId);
        const { recorded, known1063 } = await cycleConfigControls(page, controls, driver);
        collected.push({
          cell,
          outcome: { kind: "ok", harness, modelId, workspaceId, sessionId, controls: recorded, known1063 },
        });
      } catch (error) {
        await captureLocalDriverFailure(page, `${cell.cell_id}-ui-failure`);
        collected.push({ cell, outcome: { kind: "failed", message: describe(error) } });
      }
    }
  } catch (error) {
    await captureLocalDriverFailure(page, `${cells[0]?.scenario_id ?? "T3-CFG-1"}-setup-failure`);
    setupError = describe(error);
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    cleanup = await driver.closeWorld(world).then(toLocalCleanup).catch(() => null);
  }

  if (setupError) {
    return cells.map((cell) => failedOutcome(cell.cell_id, setupError!));
  }

  const serverVersion = world.artifacts.server.version;
  const anyharnessVersion = world.artifacts.anyharness.version;
  const artifactIds = worldArtifactIds(world);

  return collected.map((entry) => {
    if (entry.outcome.kind === "blocked") {
      return { cellId: entry.cell.cell_id, status: "blocked", reason: { code: "scenario_blocked", message: entry.outcome.message } };
    }
    if (entry.outcome.kind === "failed") {
      return failedOutcome(entry.cell.cell_id, entry.outcome.message);
    }
    const evidence = buildLocalConfigMatrixEvidence({
      harness: entry.outcome.harness,
      artifactIds,
      serverVersion,
      anyharnessVersion,
      modelId: entry.outcome.modelId,
      workspaceId: entry.outcome.workspaceId,
      sessionId: entry.outcome.sessionId,
      controls: entry.outcome.controls,
      known1063ExpectedFail: entry.outcome.known1063,
      cleanup: cleanup ?? unknownCleanup(),
    });
    // A #1063 menu/apply mismatch (settable control rejected on apply) is a
    // tracked expected-fail, never green (audit ruling #5).
    if (entry.outcome.known1063) {
      return {
        cellId: entry.cell.cell_id,
        status: "expected_fail",
        reason: {
          code: "known_gap",
          message:
            `[${entry.outcome.harness}] a live-config control advertised as settable was rejected on apply through the ` +
            `product UI (menu/apply mismatch) — tracked as https://github.com/proliferate-ai/proliferate/issues/1063; not green`,
        },
        evidence,
      };
    }
    // A green cell requires clean world cleanup (spec cleanup rule).
    if (!cleanup || cleanup.failed > 0 || !allCleanupBooleansTrue(cleanup)) {
      return { cellId: entry.cell.cell_id, status: "failed", reason: { code: "scenario_failure", message: `cleanup did not fully reconcile (failed=${cleanup?.failed ?? "n/a"})` }, evidence };
    }
    return { cellId: entry.cell.cell_id, status: "green", evidence };
  });
}

/**
 * Cycles each settable, cyclable control through the product UI (t3-cfg-1 logic,
 * UI-driven acceptance). Per control, one accepted value is enough — the apply
 * seam is proved by any successful set+readback. A rejected value is tolerated
 * (the driver asserts the UI restored the last-accepted value); only a control
 * whose EVERY advertised value is rejected on apply is the #1063 menu/apply
 * mismatch, tracked expected-fail. Requires at least one settable, cyclable
 * control to be advertised, mirroring t3-cfg-1's `controlKeys.length > 0`.
 */
export async function cycleConfigControls(
  page: ProductPage,
  controls: readonly LocalConfigControl[],
  driver: Pick<LocalConfigDriver, "selectConfigValueInUi">,
): Promise<{ recorded: Array<{ controlKey: string; acceptedValue: string; rejected: boolean }>; known1063: boolean }> {
  const cyclable = controls.filter(
    (control) => control.settable && control.values.some((value) => value !== control.currentValue),
  );
  if (cyclable.length === 0) {
    throw new Error("LOCAL-4: session advertised no settable, cyclable live-config control");
  }

  const recorded: Array<{ controlKey: string; acceptedValue: string; rejected: boolean }> = [];
  let known1063 = false;

  for (const control of cyclable) {
    let lastAccepted = control.currentValue;
    let acceptedAny = false;
    for (const value of control.values) {
      if (value === control.currentValue) {
        continue;
      }
      const { accepted, readback } = await driver.selectConfigValueInUi(page, control, value);
      if (accepted) {
        lastAccepted = readback;
        acceptedAny = true;
        break;
      }
      // Rejected on apply: the UI must have restored the last-accepted value
      // (the driver asserts `readback === lastAccepted`). A tolerated rejection —
      // keep trying the control's other advertised values.
      lastAccepted = readback;
    }
    recorded.push({ controlKey: control.key, acceptedValue: lastAccepted, rejected: !acceptedAny });
    // A settable, cyclable control that accepted NONE of its advertised values is
    // the #1063 menu/apply mismatch (never green).
    if (!acceptedAny) {
      known1063 = true;
    }
  }

  return { recorded, known1063 };
}

// ── LOCAL-5 collector ────────────────────────────────────────────────────────

/** LOCAL-5 collector (T3-SESSION-1/local, single cell, world-backed). Boots its
 * own world; on a diagnostic run (no candidate map) returns a clean `blocked`
 * (the scenario has no legacy path — BRIEF §1c). */
export async function collectLocal5SessionTabsCell(
  ctx: ScenarioRunContext,
  cell: PlannedCellV1,
  driver: LocalSessionTabsDriver = defaultLocalSessionTabsDriver,
): Promise<ScenarioCellOutcome> {
  const inputs = resolveWorldConstructionInputs(ctx);
  if (!inputs.ok) {
    return {
      cellId: cell.cell_id,
      status: "blocked",
      reason: { code: "scenario_blocked", message: `LOCAL-5 requires the candidate world: ${inputs.reason}` },
    };
  }

  let world: ReadyLocalWorld;
  try {
    world = await driver.buildWorld(inputs.value, cell.scenario_id);
  } catch (error) {
    return failedOutcome(cell.cell_id, `world construction failed: ${describe(error)}`);
  }

  const startHarness = normalizeHarness(cell.dimensions.harness) ?? SESSION_TABS_START_HARNESS;
  let page: ProductPage | undefined;
  let cellData: { workspaceId: string; sessionIds: string[] } | undefined;
  let failure: string | undefined;
  let cleanup: LocalCleanupV1 | null = null;

  try {
    const actor = await driver.createActor(world);
    await world.trackActorSubjects?.(actor.gatewayKey);
    const repo = await driver.prepareRepo(world, actor, `${cell.scenario_id}/local`);
    page = await driver.openPage(world, actor);

    await driver.ensureHarnessReady(world, page, startHarness);
    await driver.selectRepoAndWorkLocally(page, repo);

    const sessionIds: string[] = [];
    // Tab A: materialize the FIRST chat by sending a prompt and awaiting turn
    // completion. This tab is MESSAGED (per the product's `isSessionEmpty`, a
    // materialized session with transcript is never empty), so it is deliberately
    // NOT the tab used for the empty-chat-switch proof.
    const tabA = await driver.materializeFirstChat(world, page, startHarness);
    sessionIds.push(tabA.sessionId);

    // Proof 1 ("switch after messages"): a REAL harness switch on tab A's
    // messaged session preserves tab A (its harness + transcript intact) and
    // opens a NEW, genuinely EMPTY tab B, on the switched-to harness, immediately
    // to tab A's right.
    const afterMessagesSwitch = await driver.switchHarnessAfterMessages(world, page, SESSION_TABS_SWITCH_HARNESS);
    if (afterMessagesSwitch.preservedTabId === afterMessagesSwitch.newTabId) {
      throw new Error("LOCAL-5: switch-after-messages did not open a new tab beside the preserved one");
    }
    if (afterMessagesSwitch.preservedTabHarness === afterMessagesSwitch.newTabHarness) {
      throw new Error(
        `LOCAL-5: switch-after-messages was not a real harness switch (both tabs on "${afterMessagesSwitch.newTabHarness}")`,
      );
    }
    if (afterMessagesSwitch.newTabHarness !== SESSION_TABS_SWITCH_HARNESS) {
      throw new Error(
        `LOCAL-5: the new tab is on "${afterMessagesSwitch.newTabHarness}", expected the switched-to "${SESSION_TABS_SWITCH_HARNESS}"`,
      );
    }
    sessionIds.push(afterMessagesSwitch.newSessionId);

    // Proof 2 ("empty-chat switch"): switch tab B — the product's OWN genuinely
    // empty tab — back to SESSION_TABS_START_HARNESS (claude), a harness
    // genuinely different from tab B's current codex. The switch must be a real
    // in-place replacement, not a no-op and not a second new tab:
    //  - tab COUNT stays the same (the driver observed it before/after),
    //  - the switch was not requested against the harness the tab was already on,
    //  - the session id changed from tab B's messaged-turn-free session (the DOM
    //    tab ELEMENT id itself changes with the session — see the driver
    //    contract note — so the poll targets the ACTIVE tab, not tab B's stale id).
    const emptySwitch = await driver.switchHarnessEmptyChat(world, page, SESSION_TABS_START_HARNESS);
    if (emptySwitch.noOp) {
      throw new Error("LOCAL-5: empty-chat harness switch was a no-op (requested the harness the tab was already on)");
    }
    if (emptySwitch.oldSessionId === emptySwitch.newSessionId) {
      throw new Error("LOCAL-5: empty-chat harness switch did not replace the backend session (id unchanged)");
    }
    if (!emptySwitch.tabCountUnchanged) {
      throw new Error("LOCAL-5: empty-chat harness switch changed the number of tabs (expected in-place replacement)");
    }
    if (emptySwitch.tabIndex !== afterMessagesSwitch.newTabIndex) {
      throw new Error(
        `LOCAL-5: empty-chat harness switch moved the tab's position (was index ${afterMessagesSwitch.newTabIndex}, ` +
          `now ${emptySwitch.tabIndex}); the in-place replacement must keep the same slot`,
      );
    }
    sessionIds.push(emptySwitch.newSessionId);

    // Give the now-claude active tab (tab B, post-replacement) transcript so
    // reload can verify it.
    const messaged = await driver.sendMessage(world, page);
    sessionIds.push(messaged.sessionId);

    // Proof 3 ("same-harness model change"): on the now-claude active tab,
    // selects a DIFFERENT eligible model and stays in-session where the harness
    // contract permits it.
    const modelChange = await driver.changeModelSameHarness(world, page);
    if (modelChange.fromModelId === modelChange.toModelId) {
      throw new Error("LOCAL-5: same-harness model change was a no-op (model id unchanged)");
    }
    if (!modelChange.stayedInSession) {
      throw new Error("LOCAL-5: same-harness model change did not stay in the session");
    }
    sessionIds.push(modelChange.sessionId);

    // Proof 4 ("reload"): tab order [tab A, the current active tab id (tab B's
    // slot, now on claude after the in-place replacement)]; both the preserved
    // tab A and the current active tab survive with their expected harness and
    // transcript. The active tab's CURRENT id is read fresh (post model-change),
    // since the replacement changed it from tab B's original id.
    await driver.reloadAndVerifyTabs(world, page, {
      tabOrder: [afterMessagesSwitch.preservedTabId, modelChange.sessionId],
      activeTabId: modelChange.sessionId,
      preservedTab: { id: afterMessagesSwitch.preservedTabId, harness: afterMessagesSwitch.preservedTabHarness },
      activeTab: { id: modelChange.sessionId, harness: startHarness },
    });

    cellData = { workspaceId: tabA.workspaceId, sessionIds: dedupe(sessionIds) };
  } catch (error) {
    await captureLocalDriverFailure(page, `${cell.cell_id}-ui-failure`);
    failure = describe(error);
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    cleanup = await driver.closeWorld(world).then(toLocalCleanup).catch(() => null);
  }

  if (failure || !cellData) {
    return failedOutcome(cell.cell_id, failure ?? "LOCAL-5 collected no proof");
  }

  const evidence = buildLocalSessionTabsEvidence({
    harness: startHarness,
    artifactIds: worldArtifactIds(world),
    serverVersion: world.artifacts.server.version,
    anyharnessVersion: world.artifacts.anyharness.version,
    workspaceId: cellData.workspaceId,
    sessionIds: cellData.sessionIds,
    cleanup: cleanup ?? unknownCleanup(),
  });

  if (!cleanup || cleanup.failed > 0 || !allCleanupBooleansTrue(cleanup)) {
    return { cellId: cell.cell_id, status: "failed", reason: { code: "scenario_failure", message: `cleanup did not fully reconcile (failed=${cleanup?.failed ?? "n/a"})` }, evidence };
  }
  return { cellId: cell.cell_id, status: "green", evidence };
}

// ── Evidence builders ────────────────────────────────────────────────────────

export function buildLocalConfigMatrixEvidence(input: {
  harness: LocalHarnessKind;
  artifactIds: string[];
  serverVersion: string;
  anyharnessVersion: string;
  modelId: string;
  workspaceId: string;
  sessionId: string;
  controls: Array<{ controlKey: string; acceptedValue: string; rejected: boolean }>;
  known1063ExpectedFail: boolean;
  cleanup: LocalCleanupV1;
}): LocalConfigMatrixEvidenceV1 {
  return {
    kind: "local_config_matrix",
    artifact_ids: input.artifactIds,
    server_version: input.serverVersion,
    anyharness_version: input.anyharnessVersion,
    harness: input.harness,
    model_id: input.modelId,
    workspace_id_hash: sha256Hex(input.workspaceId),
    session_id_hash: sha256Hex(input.sessionId),
    controls: input.controls.map((control) => ({
      control_key: control.controlKey,
      accepted_value: control.acceptedValue,
      rejected: control.rejected,
    })),
    known_1063_expected_fail: input.known1063ExpectedFail,
    cleanup: input.cleanup,
  };
}

export function buildLocalSessionTabsEvidence(input: {
  harness: LocalHarnessKind;
  artifactIds: string[];
  serverVersion: string;
  anyharnessVersion: string;
  workspaceId: string;
  sessionIds: string[];
  cleanup: LocalCleanupV1;
}): LocalSessionTabsEvidenceV1 {
  return {
    kind: "local_session_tabs",
    artifact_ids: input.artifactIds,
    server_version: input.serverVersion,
    anyharness_version: input.anyharnessVersion,
    harness: input.harness,
    workspace_id_hash: sha256Hex(input.workspaceId),
    empty_switch_session_replaced: true,
    messaged_switch_new_tab: true,
    same_harness_model_change_in_session: true,
    reload_preserved: true,
    session_id_hashes: input.sessionIds.map(sha256Hex),
    cleanup: input.cleanup,
  };
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function failedOutcome(cellId: string, message: string): ScenarioCellOutcome {
  return { cellId, status: "failed", reason: { code: "scenario_failure", message } };
}

function normalizeHarness(value: string | undefined): LocalHarnessKind | undefined {
  return LOCAL_HARNESS_KINDS.find((kind) => kind === value);
}

function firstRunnableHarness(cells: readonly PlannedCellV1[]): LocalHarnessKind | undefined {
  for (const cell of cells) {
    const harness = normalizeHarness(cell.dimensions.harness);
    if (harness && !GATEWAY_UNSUPPORTED_HARNESSES.has(harness)) {
      return harness;
    }
  }
  return undefined;
}

/** The distinct runnable (gateway-capable) harness kinds this batch drives, in
 * declaration order. Each needs its gateway route selected before the page boots
 * so the real renderer syncs them all — see `LocalConfigDriver.selectGatewayRoute`. */
function runnableHarnesses(cells: readonly PlannedCellV1[]): LocalHarnessKind[] {
  const seen = new Set<LocalHarnessKind>();
  for (const cell of cells) {
    const harness = normalizeHarness(cell.dimensions.harness);
    if (harness && !GATEWAY_UNSUPPORTED_HARNESSES.has(harness)) {
      seen.add(harness);
    }
  }
  return LOCAL_HARNESS_KINDS.filter((kind) => seen.has(kind));
}

/**
 * Selects the `gateway` route for `harness` through the genuine product
 * selections API — the exact endpoint `HarnessSettingsSection` and the
 * `authenticatedActor` fixture drive. Prerequisite product state only: the real
 * renderer's `useLocalAuthStateSync` is what actually pushes the resulting
 * local-surface state.json to AnyHarness.
 */
async function selectGatewayRouteForHarness(actor: AuthenticatedActor, harness: LocalHarnessKind): Promise<void> {
  await actor.api.put(
    `/v1/cloud/agent-gateway/selections/${encodeURIComponent(harness)}?surface=local`,
    { sources: [{ sourceKind: "gateway", enabled: true }] },
  );
}

function worldArtifactIds(world: ReadyLocalWorld): string[] {
  return [
    world.artifacts.server.artifact_id,
    world.artifacts.anyharness.artifact_id,
    world.artifacts.desktopRenderer.artifact_id,
  ];
}

/** Structural map from the world's cleanup evidence to the shared `LocalCleanupV1`
 * (identical shape; the smoke's inline `cleanup` block uses the same fields). */
function toLocalCleanup(cleanup: {
  ledgerIdHash: string;
  registered: number;
  reconciled: number;
  failed: number;
  virtualKeyDeleted: boolean;
  litellmSubjectsDeleted: boolean;
  browserClosed: boolean;
  processesStopped: boolean;
  containersRemoved: boolean;
  localPathsRemoved: boolean;
}): LocalCleanupV1 {
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

/** A cleanup receipt for the case world.close() itself failed — recorded so a
 * non-green cell can still carry honest evidence of the cleanup failure. */
function unknownCleanup(): LocalCleanupV1 {
  return {
    ledger_id_hash: sha256Hex("cleanup-unavailable"),
    registered: 0,
    reconciled: 0,
    failed: 1,
    virtual_key_deleted: false,
    litellm_subjects_deleted: false,
    browser_closed: false,
    processes_stopped: false,
    containers_removed: false,
    local_paths_removed: false,
  };
}

function allCleanupBooleansTrue(cleanup: LocalCleanupV1): boolean {
  return (
    cleanup.virtual_key_deleted &&
    cleanup.litellm_subjects_deleted &&
    cleanup.browser_closed &&
    cleanup.processes_stopped &&
    cleanup.containers_removed &&
    cleanup.local_paths_removed
  );
}

/**
 * Picks the live-composer surface (and thus testid family) for a normalized
 * live-config control, or null when the composer renders no UI for it.
 *
 * Ground truth (fix round 4, verified in product source): the live chat
 * composer (ChatInputControlRow) renders ONLY the promoted control groups from
 * `buildComposerSessionControlGroups` —
 *   - `collaboration_mode` / `mode`  → SessionModeControl (data-session-mode-*)
 *   - `effort` / `reasoning`         → ComposerReasoningEffortBars
 *                                      (data-reasoning-effort-*)
 *   - `fast_mode`                    → ComposerFastModeToggle (NO testid)
 * and the product's supported normalized keys are exactly that set
 * (config/session-controls.ts SupportedLiveControlKey). Everything else has no
 * composer surface:
 *   - the raw ACP `model` control is owned by the catalog model picker
 *     (data-model-option carries CATALOG model ids, never the control's raw
 *     values — run 3 deadlocked waiting for `[data-model-option="default"]`),
 *     and the baseline turn already proves that surface end-to-end via
 *     `selectModelInComposer` (set + data-composer-selected-model readback);
 *   - the generic SessionConfigControls strip (data-session-config-control)
 *     renders only on the Settings/automations composers, not the live chat
 *     composer;
 *   - `fast_mode` carries no data-* testid, and no assigned harness currently
 *     advertises it on this candidate (claude/grok probe fastMode=false).
 */
export function configSurfaceFor(key: string): LocalConfigControl["surface"] | null {
  if (key === "effort" || key === "reasoning") {
    return "reasoning";
  }
  if (key === "collaboration_mode" || key === "mode") {
    return "mode";
  }
  return null;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
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

/** Escapes a value for safe interpolation inside a `[attr="…"]` CSS selector. */
function cssAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Waits for a locator to report itself enabled (not `disabled`), polling
 * rather than relying on Playwright's default 30s click-actionability
 * timeout — used where a trigger's mount can race a preceding reload and the
 * scenario's own budget is far larger than 30s.
 */
async function waitForEnabled(locator: ReturnType<Page["locator"]>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.isEnabled().catch(() => false)) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`waitForEnabled: ${what} did not become enabled within ${timeoutMs}ms`);
}

// ── Production UI/runtime driver bodies ──────────────────────────────────────
//
// These drive the real Desktop renderer + candidate AnyHarness through the
// documented `data-*` testids (existing ones from the smoke; new tab-strip /
// config-control testids added by builders-ci, BRIEF §4.6). They cannot be
// exercised offline — the offline unit tests fake the driver entirely — so they
// mirror the smoke's proven browser idioms and are refined against the live
// candidate world in the strict CI job.

async function ensureHarnessReady(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind): Promise<void> {
  const client = world.runtime.client;
  const deadline = Date.now() + HARNESS_READY_TIMEOUT_MS;
  let triggeredInstall = false;
  let launchable = false;
  let last: Awaited<ReturnType<typeof client.getAgent>> | undefined;
  while (Date.now() < deadline) {
    last = await client.getAgent(harness).catch(() => undefined);
    const options = await client.getAgentLaunchOptions().catch(() => []);
    const entry = options.find((agent) => agent.kind === harness);
    if (entry && entry.models.length > 0) {
      launchable = true;
      break;
    }
    if (!triggeredInstall && last && last.readiness === "install_required") {
      triggeredInstall = true;
      await client.installAgent(harness).catch(() => undefined);
    }
    await sleep(2_000);
  }
  if (!launchable) {
    // Surface the runtime's last-seen readiness triad (as
    // local-world-smoke-1's `ensureHarnessReady` does) so a launch-options
    // timeout is diagnosable without a live runtime: `readiness=login_required`
    // with an unsynced gateway route points at the route-sync path, an
    // `installing`/`install_required` installState points at the agent build.
    throw new Error(
      `ensureHarnessReady: agent "${harness}" never became launchable within ${HARNESS_READY_TIMEOUT_MS}ms ` +
        `(last: readiness=${last?.readiness}, installState=${last?.installState}, credentialState=${last?.credentialState}).`,
    );
  }
  await page.page.reload({ waitUntil: "domcontentloaded" });
  // `ensureHarnessReady` is shared by two contexts: LOCAL-4 gates readiness from
  // the HOME composer (before any workspace is materialized), while LOCAL-5's
  // harness-switch calls it AFTER `createEmptyChat` has already materialized a
  // workspace — so the post-reload page lands on the WORKSPACE shell, whose
  // composer is `[data-chat-composer-editor]`, not `[data-home-composer-editor]`.
  // Waiting only for the home composer is the run-3/4 30s
  // "locator.waitFor: Timeout 30000ms" in the switch flow. Accept whichever
  // composer the reload actually renders.
  await page.page
    .locator("[data-home-composer-editor], [data-chat-composer-editor], [data-workspace-tab-strip]")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function selectRepoAndWorkLocally(page: ProductPage, repo: PreparedRepository): Promise<void> {
  const p = page.page;
  const projectTrigger = p.getByRole("button", { name: /^Project:/ }).first();

  // LOCAL-4 deliberately reuses one renderer page across the harness matrix.
  // After the first cell creates a workspace, `ensureHarnessReady` reloads that
  // active workspace shell; it does not return to Home. The old collector then
  // waited five minutes for a Project trigger that only exists on Home (run
  // 29631868610's captured HTML has `data-workspace-shell` and the chat
  // composer, with no Project trigger). Use the real sidebar navigation before
  // selecting the next cell's repository. This preserves the real renderer and
  // Worker/enrollment boundary; it only restores the UI surface the collector
  // requires.
  if (!await projectTrigger.isVisible().catch(() => false)) {
    const newChatNav = p.locator("nav").getByRole("button", { name: "New chat" }).first();
    await waitForSidebarControlReady(p, newChatNav);
    await newChatNav.click();
    await p
      .locator("[data-home-composer-editor]")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  await projectTrigger.waitFor({ state: "visible", timeout: 30_000 });
  await waitForEnabled(projectTrigger, 30_000, "Project: trigger");
  await projectTrigger.click();
  const repoRow = p.locator(`[data-repo-source-root="${cssAttr(repo.path)}"]`).first();
  await repoRow.waitFor({ state: "visible", timeout: 20_000 });
  await repoRow.click();
  await p.getByRole("button", { name: /^Runtime:/ }).first().click();
  await p.getByRole("button", { name: /Work locally/i }).first().click();
}

async function selectModelInComposer(page: ProductPage, modelId: string): Promise<void> {
  const p = page.page;
  const deadline = Date.now() + MODEL_PICKER_TIMEOUT_MS;
  const optionSelector = `[data-model-option="${cssAttr(modelId)}"]`;
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
      await p
        .locator(`[data-composer-model-trigger][data-composer-selected-model="${cssAttr(modelId)}"]`)
        .first()
        .waitFor({ state: "attached", timeout: 10_000 });
      return;
    }
    await p.keyboard.press("Escape").catch(() => undefined);
    await sleep(2_000);
  }
  throw new Error(`selectModelInComposer: model "${modelId}" was not offered by the composer picker.`);
}

async function runBaselineTurn(
  world: ReadyLocalWorld,
  page: ProductPage,
  harness: LocalHarnessKind,
  repoPath: string,
): Promise<{ workspaceId: string; sessionId: string; modelId: string }> {
  const preflight = await world.gateway.preflight();
  const probe = (await world.runtime.client.getGatewayModels(harness).catch(() => [])).map((model) => model.id);
  const modelId = selectCheapestEligibleClaudeModel(preflight.eligibleClaudeModels, probe);
  if (!modelId) {
    throw new Error(`runBaselineTurn: no eligible non-Fable model for "${harness}" in the allowlist ∩ live probe`);
  }
  await selectModelInComposer(page, modelId);

  const p = page.page;
  const editor = p.locator("[data-home-composer-editor]").first();
  await editor.waitFor({ state: "visible", timeout: 15_000 });
  await editor.fill(BASELINE_PROMPT);
  const send = p.locator("[data-chat-send-button]:not([disabled])").first();
  await send.waitFor({ state: "visible", timeout: 15_000 });
  await send.click();

  await p
    .locator('[data-workspace-shell][data-pending-workspace="false"]')
    .first()
    .waitFor({ state: "attached", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
  // `data-workspace-ui-key` is the LOGICAL workspace id; the AnyHarness session
  // keys off the CONCRETE runtime workspace at the repo clone path (see
  // local-session.ts). Keep the ui-key for the caller/DOM, resolve the session
  // from the runtime's own local workspace.
  const workspaceId = await readRequiredAttr(p, "[data-workspace-shell]", "data-workspace-ui-key");
  const sessionId = await resolveLocalWorkspaceSessionId(world, repoPath, WORKSPACE_SETTLE_TIMEOUT_MS);
  const completion = await waitForTurnCompletion(world, sessionId, TURN_TIMEOUT_MS);
  if (completion.error) {
    throw new Error(`runBaselineTurn: assistant turn errored: ${completion.error}`);
  }
  if (!completion.ended) {
    throw new Error(`runBaselineTurn: assistant turn did not end within ${TURN_TIMEOUT_MS}ms`);
  }
  return { workspaceId, sessionId, modelId };
}

async function selectConfigValueInUi(
  page: ProductPage,
  control: LocalConfigControl,
  value: string,
): Promise<{ accepted: boolean; readback: string }> {
  if (control.surface === "reasoning") {
    return stepReasoningEffortToValue(page, value, control.values.length);
  }
  // mode: SessionModeControl is a real popover — click the trigger, click the
  // target PopoverMenuItem (data-session-mode-option), read the selection back.
  const p = page.page;
  const trigger = p.locator("[data-session-mode-trigger]").first();
  await trigger.waitFor({ state: "visible", timeout: 15_000 });
  await trigger.click();
  const option = p.locator(`[data-session-mode-option="${cssAttr(value)}"]`).first();
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();
  // Wait beyond the runtime's normal apply/reject window so a late rejection has
  // reverted the UI to the last-accepted value before we read back.
  await sleep(CONFIG_REJECTION_WINDOW_MS);
  const readback = await readRequiredAttr(p, "[data-session-mode-trigger]", "data-session-mode-selected");
  return { accepted: readback === value, readback };
}

/**
 * Drives the reasoning-effort ladder to `value`. ComposerReasoningEffortBars is
 * a STEPPER, not a menu: the whole control is one button whose click advances
 * the selection to the next level ((currentIndex + 1) % levels — LevelBarsButton),
 * and the `data-reasoning-effort-option` spans inside it are decorative level
 * bars whose clicks just bubble to the same button (round-3 note: "click may
 * STEP, not jump"). So step until the trigger's own readback attribute reports
 * the target, bounded by one full lap of the ladder; a step whose readback never
 * moves is a rejected apply (the UI stayed on the last-accepted value).
 *
 * `ladderSize` is the enumerated control value count (`control.values.length`),
 * NOT the count of `data-reasoning-effort-option` spans: the tier-label branch
 * (e.g. the 6-value low..ultra ladder) renders a plain ComposerControlButton
 * with NO option spans, so a DOM-span count would be 0 there and cap the walk at
 * 2 steps — enough to give up early on a >2-step target and record a FALSE
 * rejection. Bounding by the enumerated ladder length covers both the bars and
 * tier-label renderings.
 */
async function stepReasoningEffortToValue(
  page: ProductPage,
  value: string,
  ladderSize: number,
): Promise<{ accepted: boolean; readback: string }> {
  const p = page.page;
  const trigger = p.locator("[data-reasoning-effort-trigger]").first();
  await trigger.waitFor({ state: "visible", timeout: 15_000 });
  const maxSteps = Math.max(ladderSize, 2);
  let readback = (await trigger.getAttribute("data-reasoning-effort-selected").catch(() => null)) ?? "";
  for (let step = 0; step < maxSteps && readback !== value; step += 1) {
    const before = readback;
    await trigger.click();
    // Each step round-trips through the runtime's apply seam; wait (bounded by
    // the rejection window) for the readback attribute to move before deciding.
    const deadline = Date.now() + CONFIG_REJECTION_WINDOW_MS;
    while (Date.now() < deadline) {
      readback = (await trigger.getAttribute("data-reasoning-effort-selected").catch(() => null)) ?? "";
      if (readback !== before) {
        break;
      }
      await sleep(300);
    }
    if (readback === before) {
      // The step was rejected (or the control is wedged): the UI held the
      // last-accepted value. Report it so the cycle records a clean rejection.
      break;
    }
  }
  // Let a late rejection revert before the final readback (same settle the
  // popover path uses).
  await sleep(CONFIG_REJECTION_WINDOW_MS);
  readback = (await trigger.getAttribute("data-reasoning-effort-selected").catch(() => null)) ?? "";
  return { accepted: readback === value, readback };
}

// ── LOCAL-5 tab-strip production bodies (new tab-strip testids, BRIEF §4.6) ──

async function materializeFirstChat(
  world: ReadyLocalWorld,
  page: ProductPage,
  harness: LocalHarnessKind,
): Promise<{ workspaceId: string; sessionId: string; tabId: string }> {
  const p = page.page;
  // Fix round 3 (live-proof ruling): the local workspace + AnyHarness session —
  // and therefore the tab strip — materialize ONLY on first send. Waiting for the
  // tab strip pre-send (the round-2 body) timed out. So materialize the first
  // (single-turn) session through the real send path: select the cheapest
  // eligible model, send one bounded prompt from the home composer, then read the
  // materialized session's tab off the strip. Sending to create the session is
  // not "seeding" — it is the only real creation path. NOTE: this necessarily
  // gives the tab transcript (a materialized session is never empty per the
  // product's `isSessionEmpty`), so tab A is the MESSAGED starting point, not an
  // empty chat.
  const preflight = await world.gateway.preflight();
  const probe = (await world.runtime.client.getGatewayModels(harness).catch(() => [])).map((model) => model.id);
  const modelId = selectCheapestEligibleClaudeModel(preflight.eligibleClaudeModels, probe);
  if (!modelId) {
    throw new Error(`materializeFirstChat: no eligible non-Fable model for "${harness}" in the allowlist ∩ live probe`);
  }
  await selectModelInComposer(page, modelId);
  const editor = p.locator("[data-home-composer-editor]").first();
  await editor.waitFor({ state: "visible", timeout: 15_000 });
  await editor.fill(BASELINE_PROMPT);
  const send = p.locator("[data-chat-send-button]:not([disabled])").first();
  await send.waitFor({ state: "visible", timeout: 15_000 });
  await send.click();
  // The pending composer transitions to the workspace shell; the tab strip then
  // renders the materialized session's tab.
  await p
    .locator('[data-workspace-shell][data-pending-workspace="false"]')
    .first()
    .waitFor({ state: "attached", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
  await p.locator("[data-workspace-tab-strip]").first().waitFor({ state: "visible", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
  const tab = p.locator("[data-chat-tab]").first();
  await tab.waitFor({ state: "visible", timeout: TAB_SETTLE_TIMEOUT_MS });
  const tabId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab", tab);
  const workspaceId = await readRequiredAttr(p, "[data-workspace-shell]", "data-workspace-ui-key");
  const sessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", tab);
  // Wait for the materializing turn to complete so the session is real before the
  // subsequent tab-semantics proofs run against it.
  const anyharnessSessionId = await resolveActiveSessionId(world, sessionId);
  const completion = await waitForTurnCompletion(world, anyharnessSessionId, TURN_TIMEOUT_MS);
  if (completion.error) {
    throw new Error(`materializeFirstChat: the materializing turn errored: ${completion.error}`);
  }
  return { workspaceId, sessionId, tabId };
}

/**
 * Switches the harness of the CURRENTLY ACTIVE tab — by construction the
 * genuinely empty tab `switchHarnessAfterMessages` just opened. A messaged
 * session is never empty per the product's `isSessionEmpty`
 * (`transcript.turnOrder.length === 0` — see
 * `apps/packages/product-client/src/lib/domain/sessions/session-emptiness.ts`),
 * so a `beginEmptySessionReplacement` in-place swap only fires on a tab that
 * never received a message — proven false for `materializeFirstChat`'s tab
 * (Actions run 29549140268, cell T3-SESSION-1/local/harness=claude).
 *
 * `data-chat-tab` (the tab id) equals the session id in the DOM, so an in-place
 * replacement necessarily changes the tab ELEMENT's own id attribute — a
 * `tabId === tabId` equality check can never hold across a real replacement.
 * The stable proof is POSITIONAL: the tab's `data-chat-tab-index` and the total
 * tab count stay the same; only `data-chat-tab-session-id` (read off the
 * ACTIVE-tab selector, not the old tab id) changes.
 */
async function switchHarnessEmptyChat(
  world: ReadyLocalWorld,
  page: ProductPage,
  toHarness: LocalHarnessKind,
): Promise<{ oldSessionId: string; newSessionId: string; tabIndex: number; tabCountUnchanged: boolean; noOp: boolean }> {
  const p = page.page;
  // Capture the target (empty) tab's identity from the ACTIVE tab BEFORE
  // `ensureHarnessReady` — it reloads the page, and reload re-activates the
  // durable, messaged tab A (its backend session is persisted; tab B's empty,
  // in-place-replaceable session is not), so any read taken after the reload
  // describes tab A, not the empty tab B this switch must act on. The failing
  // run (Actions 29570511844, T3-SESSION-1) reloaded with tab A active and then
  // "switched" claude→claude on it — a silent no-op whose session id never
  // changed. Playwright locators are lazy (re-resolved at call time), so the
  // index/session-id must be read here, pre-reload, and the tab re-activated by
  // that index afterwards.
  const activeTabBefore = p.locator('[data-chat-tab][data-chat-tab-active="true"]').first();
  const harnessBefore = (await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-harness", activeTabBefore)) as LocalHarnessKind;
  const tabIndex = Number((await activeTabBefore.getAttribute("data-chat-tab-index").catch(() => null)) ?? "0");
  if (harnessBefore === toHarness) {
    const noopSessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", activeTabBefore);
    return { oldSessionId: noopSessionId, newSessionId: noopSessionId, tabIndex, tabCountUnchanged: true, noOp: true };
  }
  const beforeCount = await p.locator("[data-chat-tab]").count();
  await ensureHarnessReady(world, page, toHarness);
  // Reload re-activated tab A; re-select the empty tab B at its captured index
  // so the harness switch acts on the intended empty session, not the messaged
  // one.
  const targetTab = p.locator(`[data-chat-tab-index="${tabIndex}"]`).first();
  await targetTab.waitFor({ state: "visible", timeout: TAB_SETTLE_TIMEOUT_MS });
  await targetTab.click();
  await p
    .locator(`[data-chat-tab-index="${tabIndex}"][data-chat-tab-active="true"]`)
    .first()
    .waitFor({ state: "attached", timeout: TAB_SETTLE_TIMEOUT_MS });
  // Capture the reconciled server id of tab B AFTER the reload+reactivation. Two
  // reasons: (1) reload rebuilds the tab from the authoritative session list, so
  // it now carries the server id, not the pre-reload optimistic one — comparing
  // the post-switch id against the pre-reload id would spuriously "detect a
  // change" from the reload alone; (2) waiting for a reconciled (non
  // `client-session:`) id means the empty session is fully MATERIALIZED before
  // the switch, so the product's replace-in-place path dismisses a known
  // materialized session rather than racing a still-in-flight creation and
  // orphaning it — the orphan reappeared as a spurious 3rd tab after reload
  // (Actions run 29575928457, T3-SESSION-1). A materialized-but-empty session is
  // still empty (isSessionEmptyWithIntents checks transcript/intents, not
  // materialization), so this stays faithful to the empty-chat-switch proof.
  const activeTabByIndex = p.locator(`[data-chat-tab-index="${tabIndex}"]`).first();
  const oldSessionId = await waitForReconciledSessionId(p, activeTabByIndex);
  // KNOWN PRODUCT RACE (same class as issue #1333; #1337 landed a product fix
  // for the orphan variant, but the round-4 no-op / spurious-new-tab symptom
  // may persist — this cell is allowed to be red on it until proven otherwise).
  // The tab strip's `data-chat-tab-active`/`-session-id` are driven by the
  // optimistic pending-highlight (`resolveWorkspaceShellActivation` →
  // `{kind:"chat-session-pending"}`), which lands the instant a tab click
  // registers; the AUTHORITATIVE `useSessionSelectionStore.activeSessionId`
  // commit is deferred and coalesced ~180ms later
  // (`CHAT_TAB_ACTIVATION_COALESCE_MS`, use-chat-tab-activation.ts). If the
  // harness switch fires before that commit, `handleLaunchSelect` resolves
  // `replacesSessionId` from the still-stale active session (tab A, messaged),
  // so `beginEmptySessionReplacement` sees a non-empty record, returns null, and
  // the product opens a NEW empty tab instead of replacing in place — the
  // watched tab's id never changes and a spurious 3rd tab appears (Actions run
  // 29602686092: 3 tabs [Claude,Codex,Claude], id 53c6870d… frozen).
  //
  // A `waitForComposerHarnessCommitted` gate was tried here to close the race
  // and PROVEN UNSOUND (removed): it passes on a stale `defaultChatAgentKind`
  // preference fallback during the chat-session-pending suppressed phase, not on
  // the real activeSessionId commit, so Actions runs 29602686092 + 29617987951
  // showed the SAME 3-tab failure with and without it.
  await selectHarnessInComposer(world, page, toHarness);
  // The unused backend session is replaced IN PLACE at the same tab position:
  // poll the tab AT THIS INDEX (not the stale tab-id locator, since the tab
  // element's own id changes with the session) until its session-id changes.
  const newSessionId = await waitForAttrChange(p, "[data-chat-tab]", "data-chat-tab-session-id", oldSessionId, activeTabByIndex);
  const afterCount = await p.locator("[data-chat-tab]").count();
  return { oldSessionId, newSessionId, tabIndex, tabCountUnchanged: afterCount === beforeCount, noOp: false };
}

async function sendMessage(world: ReadyLocalWorld, page: ProductPage): Promise<{ sessionId: string }> {
  const p = page.page;
  const editor = p.locator("[data-chat-composer-editor]").first();
  await editor.waitFor({ state: "visible", timeout: 15_000 });
  await editor.fill(BASELINE_PROMPT);
  const send = p.locator("[data-chat-send-button]:not([disabled])").first();
  await send.click();
  const activeTab = p.locator('[data-chat-tab][data-chat-tab-active="true"]').first();
  const sessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", activeTab);
  const anyharnessSessionId = await resolveActiveSessionId(world, sessionId);
  const completion = await waitForTurnCompletion(world, anyharnessSessionId, TURN_TIMEOUT_MS);
  if (completion.error) {
    throw new Error(`sendMessage: assistant turn errored: ${completion.error}`);
  }
  return { sessionId };
}

async function switchHarnessAfterMessages(
  world: ReadyLocalWorld,
  page: ProductPage,
  toHarness: LocalHarnessKind,
): Promise<{ preservedTabId: string; preservedTabHarness: LocalHarnessKind; newTabId: string; newTabHarness: LocalHarnessKind; newTabIndex: number; newSessionId: string }> {
  await ensureHarnessReady(world, page, toHarness);
  const p = page.page;
  const activeTab = p.locator('[data-chat-tab][data-chat-tab-active="true"]').first();
  const preservedTabId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab", activeTab);
  const preservedTabHarness = (await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-harness", activeTab)) as LocalHarnessKind;
  if (preservedTabHarness === toHarness) {
    throw new Error(
      `switchHarnessAfterMessages: the messaged tab is already on "${toHarness}", so switching to it is a no-op ` +
        "and would not create the required new tab — pick a target harness different from the active one.",
    );
  }
  const beforeCount = await p.locator("[data-chat-tab]").count();
  await selectHarnessInComposer(world, page, toHarness);
  // A new session tab appears immediately to the right of the messaged one.
  await p.locator("[data-chat-tab]").nth(beforeCount).waitFor({ state: "visible", timeout: TAB_SETTLE_TIMEOUT_MS });
  const newTab = p.locator('[data-chat-tab][data-chat-tab-active="true"]').first();
  const newTabId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab", newTab);
  const newTabHarness = (await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-harness", newTab)) as LocalHarnessKind;
  const newTabIndex = Number((await newTab.getAttribute("data-chat-tab-index").catch(() => null)) ?? String(beforeCount));
  const newSessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", newTab);
  // The preserved (old) tab still exists, on its original harness, with its
  // transcript intact — it was not mutated by the switch.
  const preserved = p.locator(`[data-chat-tab][data-chat-tab="${cssAttr(preservedTabId)}"]`).first();
  const preservedHarnessAfter = await preserved.getAttribute("data-chat-tab-harness").catch(() => null);
  if (preservedHarnessAfter !== preservedTabHarness) {
    throw new Error(
      `switchHarnessAfterMessages: the preserved tab's harness changed from "${preservedTabHarness}" to ` +
        `"${preservedHarnessAfter}" — the switch mutated the old tab instead of opening a new one.`,
    );
  }
  return { preservedTabId, preservedTabHarness, newTabId, newTabHarness, newTabIndex, newSessionId };
}

async function changeModelSameHarness(
  world: ReadyLocalWorld,
  page: ProductPage,
): Promise<{ sessionId: string; fromModelId: string; toModelId: string; stayedInSession: boolean }> {
  const p = page.page;
  const activeTab = p.locator('[data-chat-tab][data-chat-tab-active="true"]').first();
  // Capture the RECONCILED server id, not the transient `client-session:` one:
  // this id becomes the reload expectation's active/ordered tab id
  // (collectLocal5SessionTabsCell → reloadAndVerifyTabs), and a fresh renderer
  // only ever shows the server id, so a client id could never match post-reload
  // (Actions run 29575928457, T3-SESSION-1).
  const sessionId = await waitForReconciledSessionId(p, activeTab);
  const harness = (await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-harness", activeTab)) as LocalHarnessKind;
  // The model the composer is currently on — the change must move OFF this one,
  // otherwise a no-op selection would trivially "stay in session".
  const fromModelId = await readRequiredAttr(p, "[data-composer-model-trigger]", "data-composer-selected-model");
  const preflight = await world.gateway.preflight();
  const probe = (await world.runtime.client.getGatewayModels(harness).catch(() => [])).map((model) => model.id);
  const candidates = probe.filter((id) => preflight.eligibleClaudeModels.includes(id) && id !== fromModelId);
  const toModelId = candidates.find((id) => id !== undefined);
  if (!toModelId) {
    throw new Error(
      `changeModelSameHarness: no alternate eligible model for "${harness}" other than the active "${fromModelId}" ` +
        "— cannot prove an in-session model change without a distinct target.",
    );
  }
  await selectModelInComposer(page, toModelId);
  const afterSessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", activeTab);
  return { sessionId, fromModelId, toModelId, stayedInSession: afterSessionId === sessionId };
}

async function reloadAndVerifyTabs(
  world: ReadyLocalWorld,
  page: ProductPage,
  expect: { tabOrder: string[]; activeTabId: string; preservedTab: { id: string; harness: LocalHarnessKind }; activeTab: { id: string; harness: LocalHarnessKind } },
): Promise<void> {
  const p = page.page;
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.locator("[data-workspace-tab-strip]").first().waitFor({ state: "visible", timeout: 60_000 });
  const observedOrder = await p
    .locator("[data-chat-tab]")
    .evaluateAll((els) =>
      els
        .map((el) => ({
          id: el.getAttribute("data-chat-tab"),
          index: Number(el.getAttribute("data-chat-tab-index") ?? "0"),
        }))
        .sort((a, b) => a.index - b.index)
        .map((entry) => entry.id),
    );
  if (JSON.stringify(observedOrder) !== JSON.stringify(expect.tabOrder)) {
    throw new Error(
      `reloadAndVerifyTabs: tab order not preserved (wanted ${JSON.stringify(expect.tabOrder)}, saw ${JSON.stringify(observedOrder)})`,
    );
  }
  const activeId = await readRequiredAttr(
    p,
    "[data-chat-tab]",
    "data-chat-tab",
    p.locator('[data-chat-tab][data-chat-tab-active="true"]').first(),
  );
  if (activeId !== expect.activeTabId) {
    throw new Error(`reloadAndVerifyTabs: active tab not preserved (wanted ${expect.activeTabId}, saw ${activeId})`);
  }

  // Verify BOTH tabs — the active new tab first (already focused), then reopen
  // the preserved old tab — each survives reload on its own expected harness
  // with its transcript rendered. Checking only the active tab (the round-3
  // behaviour) never proved the preserved tab kept its harness/transcript.
  for (const target of [expect.activeTab, expect.preservedTab]) {
    const tab = p.locator(`[data-chat-tab][data-chat-tab="${cssAttr(target.id)}"]`).first();
    await tab.waitFor({ state: "visible", timeout: 15_000 });
    // Activate the tab (the active one is a no-op click; the preserved one gets
    // reopened) so its pane's transcript renders.
    await tab.click();
    await p
      .locator(`[data-chat-tab][data-chat-tab="${cssAttr(target.id)}"][data-chat-tab-active="true"]`)
      .first()
      .waitFor({ state: "attached", timeout: 15_000 });
    const harnessAfter = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-harness", tab);
    if (harnessAfter !== target.harness) {
      throw new Error(
        `reloadAndVerifyTabs: tab ${target.id} came back on "${harnessAfter}", expected "${target.harness}" — ` +
          "harness attachment did not survive reload.",
      );
    }
    // Its transcript survived: a settled assistant reply is rendered in the pane.
    await p
      .locator('[data-assistant-prose][data-assistant-streaming="false"]')
      .last()
      .waitFor({ state: "attached", timeout: 20_000 });
  }
  void world;
}

/** Selects `harness` in the composer by picking one of ITS models in the model
 * picker. The picker (ComposerModelPickerPopover) groups rows by harness but
 * stamps only `data-model-option="<modelId>"` on each row — there is no
 * per-harness section testid in the popover (`data-harness-auth-section` is a
 * SETTINGS pane testid). The round-3 body clicked `.first()` of a union with
 * `[data-model-option]`, which resolves to the CURRENT harness's first model and
 * never switches (fix round 4). Resolve the target harness's own model ids from
 * the runtime's gateway probe and click the first one the picker offers. */
async function selectHarnessInComposer(
  world: ReadyLocalWorld,
  page: ProductPage,
  harness: LocalHarnessKind,
): Promise<void> {
  const p = page.page;
  const candidates = (await world.runtime.client.getGatewayModels(harness).catch(() => [])).map(
    (model) => model.id,
  );
  if (candidates.length === 0) {
    throw new Error(
      `selectHarnessInComposer: the runtime probed no gateway model for "${harness}", so the picker has no ` +
        "option that would switch to it.",
    );
  }
  const deadline = Date.now() + MODEL_PICKER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const trigger = p.locator("[data-composer-model-trigger]:not([disabled])").first();
    try {
      await trigger.waitFor({ state: "visible", timeout: 5_000 });
      await trigger.click();
    } catch {
      await sleep(1_500);
      continue;
    }
    for (const modelId of candidates) {
      const option = p.locator(`[data-model-option="${cssAttr(modelId)}"]`).first();
      if (await option.count().catch(() => 0)) {
        await option.click();
        return;
      }
    }
    // The just-installed harness's models can surface a beat later; close and
    // retry (the same idiom selectModelInComposer uses).
    await p.keyboard.press("Escape").catch(() => undefined);
    await sleep(2_000);
  }
  throw new Error(`selectHarnessInComposer: no "${harness}" model option appeared in the composer picker.`);
}

// ── Runtime/DOM read helpers ─────────────────────────────────────────────────

async function readRequiredAttr(
  page: Page,
  selector: string,
  attr: string,
  locatorOverride?: ReturnType<Page["locator"]>,
): Promise<string> {
  const locator = locatorOverride ?? page.locator(selector).first();
  const deadline = Date.now() + TAB_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = (await locator.getAttribute(attr).catch(() => null)) ?? "";
    if (value) {
      return value;
    }
    await sleep(500);
  }
  throw new Error(`readRequiredAttr: attribute "${attr}" on "${selector}" never settled`);
}

async function waitForAttrChange(
  page: Page,
  selector: string,
  attr: string,
  from: string,
  locatorOverride?: ReturnType<Page["locator"]>,
): Promise<string> {
  const locator = locatorOverride ?? page.locator(selector).first();
  const deadline = Date.now() + TAB_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = (await locator.getAttribute(attr).catch(() => null)) ?? "";
    if (value && value !== from) {
      return value;
    }
    await sleep(500);
  }
  throw new Error(`waitForAttrChange: attribute "${attr}" on "${selector}" never changed from "${from}"`);
}

/**
 * Waits until the active tab's `data-chat-tab-session-id` is a RECONCILED server
 * id — i.e. no longer a `client-session:` optimistic id (the client-side
 * directory key a freshly-created session carries until its background
 * materialization commits the real id; see session-creation-local-state.ts +
 * persisted-chat-sessions.ts `isTransientClientSessionId`). Any id captured for
 * a post-RELOAD expectation MUST be the server id: a fresh renderer only ever
 * shows the server uuid for that tab, so an expectation built from the transient
 * client id can never match (proven: Actions run 29575928457, T3-SESSION-1,
 * `reloadAndVerifyTabs: tab order not preserved` — the wanted id was
 * `client-session:claude:…`). Returns the reconciled id.
 */
async function waitForReconciledSessionId(
  page: Page,
  activeTab: ReturnType<Page["locator"]>,
): Promise<string> {
  const deadline = Date.now() + TAB_SETTLE_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    last = (await activeTab.getAttribute("data-chat-tab-session-id").catch(() => null)) ?? "";
    if (last && !last.startsWith("client-session:")) {
      return last;
    }
    await sleep(500);
  }
  throw new Error(
    `waitForReconciledSessionId: the active tab's session id never reconciled off the optimistic ` +
      `client id (last "${last}") within ${TAB_SETTLE_TIMEOUT_MS}ms.`,
  );
}

/** Resolves the AnyHarness native session id backing the currently-active chat.
 * The Desktop client's tab session id is ephemeral; the runtime's most recent
 * session is the one just messaged. */
async function resolveActiveSessionId(world: ReadyLocalWorld, _clientSessionId: string): Promise<string> {
  const deadline = Date.now() + WORKSPACE_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const sessions = await world.runtime.client.listSessions().catch(() => []);
    if (sessions.length > 0) {
      return sessions[sessions.length - 1]!.id;
    }
    await sleep(1_000);
  }
  throw new Error("resolveActiveSessionId: no AnyHarness session found for the active chat");
}

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
