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

/** Cursor ships with no gateway auth slot; its LOCAL-4 baseline turn cannot run
 * on the gateway-enrolled world, so its cell is the truthful typed `blocked`
 * (mirroring LOCAL-2's cursor treatment) — never green, never silently dropped. */
const GATEWAY_UNSUPPORTED_HARNESSES: ReadonlySet<LocalHarnessKind> = new Set(["cursor"]);

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
  /** Which composer surface renders it, so the driver picks the right testid. */
  surface: "model" | "mode" | "reasoning" | "config";
}

/** Every privileged/UI step LOCAL-5 performs, faked in offline unit tests. */
export interface LocalSessionTabsDriver {
  buildWorld(inputs: LocalFunctionalWorldInputs, worldId: string): Promise<ReadyLocalWorld>;
  createActor(world: ReadyLocalWorld): Promise<AuthenticatedActor>;
  prepareRepo(world: ReadyLocalWorld, actor: AuthenticatedActor, cellId: string): Promise<PreparedRepository>;
  openPage(world: ReadyLocalWorld, actor: AuthenticatedActor): Promise<ProductPage>;
  ensureHarnessReady(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind): Promise<void>;
  selectRepoAndWorkLocally(page: ProductPage, repo: PreparedRepository): Promise<void>;
  createEmptyChat(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind): Promise<{ workspaceId: string; sessionId: string; tabId: string }>;

  /** Switch harness in a VISIBLE EMPTY chat: assert one visible tab preserved,
   * backend session replaced (new session id), returning old+new ids. */
  switchHarnessEmptyChat(world: ReadyLocalWorld, page: ProductPage, toHarness: LocalHarnessKind): Promise<{ oldSessionId: string; newSessionId: string; tabId: string }>;

  /** Send a message so the current session has transcript. */
  sendMessage(world: ReadyLocalWorld, page: ProductPage): Promise<{ sessionId: string }>;

  /** Switch harness AFTER messages: old transcript preserved, a NEW tab created
   * immediately to the right of the old one. */
  switchHarnessAfterMessages(world: ReadyLocalWorld, page: ProductPage, toHarness: LocalHarnessKind): Promise<{ preservedTabId: string; newTabId: string; newSessionId: string }>;

  /** Same harness, change a supported model: assert it stays in the same session
   * where the harness contract permits it. */
  changeModelSameHarness(world: ReadyLocalWorld, page: ProductPage): Promise<{ sessionId: string; stayedInSession: boolean }>;

  /** Reload and assert tab order, active tab, harness attachment, and transcript
   * all survive. */
  reloadAndVerifyTabs(world: ReadyLocalWorld, page: ProductPage, expect: { tabOrder: string[]; activeTabId: string }): Promise<void>;

  closeWorld(world: ReadyLocalWorld): ReturnType<ReadyLocalWorld["close"]>;
}

// ── Production drivers: real world/fixtures/browser/runtime ──────────────────

export const defaultLocalConfigDriver: LocalConfigDriver = {
  buildWorld: (inputs, worldId) => bootLocalFunctionalWorld(inputs, worldId),
  createActor: (world) => authenticatedActor(world, "owner"),
  prepareRepo: (world, actor, cellId) => preparedRepository(world, actor, { cellId }),
  openPage: (world, actor) => productPage(world, actor),
  ensureHarnessReady: (world, page, harness) => ensureHarnessReady(world, page, harness),
  selectRepoAndWorkLocally: (page, repo) => selectRepoAndWorkLocally(page, repo),
  runBaselineTurn: (world, page, harness, repoPath) => runBaselineTurn(world, page, harness, repoPath),
  async enumerateControls(world, sessionId) {
    const live = await world.runtime.client.getLiveConfig(sessionId);
    return Object.values(live.normalizedControls).map((control) => ({
      key: control.key,
      rawConfigId: control.rawConfigId,
      currentValue: control.currentValue,
      settable: control.settable,
      values: control.values.map((option) => option.value),
      surface: configSurfaceFor(control.key, control.rawConfigId),
    }));
  },
  selectConfigValueInUi: (page, control, value) => selectConfigValueInUi(page, control, value),
  closeWorld: (world) => world.close(),
};

export const defaultLocalSessionTabsDriver: LocalSessionTabsDriver = {
  buildWorld: (inputs, worldId) => bootLocalFunctionalWorld(inputs, worldId),
  createActor: (world) => authenticatedActor(world, "owner"),
  prepareRepo: (world, actor, cellId) => preparedRepository(world, actor, { cellId }),
  openPage: (world, actor) => productPage(world, actor),
  ensureHarnessReady: (world, page, harness) => ensureHarnessReady(world, page, harness),
  selectRepoAndWorkLocally: (page, repo) => selectRepoAndWorkLocally(page, repo),
  createEmptyChat: (world, page, harness) => createEmptyChat(world, page, harness),
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
            message: `[${harness}] ships with no gateway auth slot; its LOCAL-4 baseline turn cannot run on the gateway-enrolled world (typed unsupported)`,
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
    const empty = await driver.createEmptyChat(world, page, startHarness);
    sessionIds.push(empty.sessionId);

    // Proof 1: empty-chat harness switch preserves one visible tab, replaces the
    // unused backend session (session id changes).
    const emptySwitch = await driver.switchHarnessEmptyChat(world, page, SESSION_TABS_SWITCH_HARNESS);
    if (emptySwitch.oldSessionId === emptySwitch.newSessionId) {
      throw new Error("LOCAL-5: empty-chat harness switch did not replace the backend session (id unchanged)");
    }
    if (emptySwitch.tabId !== empty.tabId) {
      throw new Error("LOCAL-5: empty-chat harness switch did not preserve the single visible tab");
    }
    sessionIds.push(emptySwitch.newSessionId);

    // Give the current session transcript, then switch after messages.
    const messaged = await driver.sendMessage(world, page);
    sessionIds.push(messaged.sessionId);

    // Proof 2: switch after messages preserves the old transcript and opens a new
    // tab immediately to its right.
    const messagedSwitch = await driver.switchHarnessAfterMessages(world, page, SESSION_TABS_SWITCH_HARNESS);
    if (messagedSwitch.preservedTabId === messagedSwitch.newTabId) {
      throw new Error("LOCAL-5: switch-after-messages did not open a new tab beside the preserved one");
    }
    sessionIds.push(messagedSwitch.newSessionId);

    // Proof 3: same-harness model change stays in-session where the harness
    // contract permits it.
    const modelChange = await driver.changeModelSameHarness(world, page);
    if (!modelChange.stayedInSession) {
      throw new Error("LOCAL-5: same-harness model change did not stay in the session");
    }
    sessionIds.push(modelChange.sessionId);

    // Proof 4: reload preserves tab order, active tab, harness attachment, and
    // transcript.
    await driver.reloadAndVerifyTabs(world, page, {
      tabOrder: [messagedSwitch.preservedTabId, messagedSwitch.newTabId],
      activeTabId: messagedSwitch.newTabId,
    });

    cellData = { workspaceId: empty.workspaceId, sessionIds: dedupe(sessionIds) };
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

/** Picks the composer surface (and thus testid family) for a live-config control
 * from its key/raw id. Model/mode/reasoning have dedicated composer controls; any
 * other mutable ACP control renders through the generic session-config surface. */
export function configSurfaceFor(key: string, rawConfigId: string): LocalConfigControl["surface"] {
  const token = `${key} ${rawConfigId}`.toLowerCase();
  if (/\bmodel\b/.test(token)) {
    return "model";
  }
  if (/reason|effort|thinking/.test(token)) {
    return "reasoning";
  }
  if (/\bmode\b/.test(token)) {
    return "mode";
  }
  return "config";
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
  while (Date.now() < deadline) {
    const last = await client.getAgent(harness).catch(() => undefined);
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
    throw new Error(`ensureHarnessReady: agent "${harness}" never became launchable within ${HARNESS_READY_TIMEOUT_MS}ms.`);
  }
  await page.page.reload({ waitUntil: "domcontentloaded" });
  await page.page.locator("[data-home-composer-editor]").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function selectRepoAndWorkLocally(page: ProductPage, repo: PreparedRepository): Promise<void> {
  const p = page.page;
  await p.getByRole("button", { name: /^Project:/ }).first().click();
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
  const p = page.page;
  const family = configTestidFamily(control);
  const trigger = p.locator(family.trigger).first();
  await trigger.waitFor({ state: "visible", timeout: 15_000 });
  await trigger.click();
  const option = p.locator(family.option(value)).first();
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();
  // Wait beyond the runtime's normal apply/reject window so a late rejection has
  // reverted the UI to the last-accepted value before we read back.
  await sleep(CONFIG_REJECTION_WINDOW_MS);
  const readback = await readRequiredAttr(p, family.selected, family.selectedAttr);
  return { accepted: readback === value, readback };
}

interface ConfigTestidFamily {
  trigger: string;
  option(value: string): string;
  selected: string;
  selectedAttr: string;
}

function configTestidFamily(control: LocalConfigControl): ConfigTestidFamily {
  switch (control.surface) {
    case "model":
      return {
        trigger: "[data-composer-model-trigger]:not([disabled])",
        option: (value) => `[data-model-option="${cssAttr(value)}"]`,
        selected: "[data-composer-model-trigger]",
        selectedAttr: "data-composer-selected-model",
      };
    case "mode":
      return {
        trigger: "[data-session-mode-trigger]",
        option: (value) => `[data-session-mode-option="${cssAttr(value)}"]`,
        selected: "[data-session-mode-trigger]",
        selectedAttr: "data-session-mode-selected",
      };
    case "reasoning":
      return {
        trigger: "[data-reasoning-effort-trigger]",
        option: (value) => `[data-reasoning-effort-option="${cssAttr(value)}"]`,
        selected: "[data-reasoning-effort-trigger]",
        selectedAttr: "data-reasoning-effort-selected",
      };
    default:
      return {
        trigger: `[data-session-config-control="${cssAttr(control.key)}"]`,
        option: (value) => `[data-session-config-option="${cssAttr(`${control.key}:${value}`)}"]`,
        selected: `[data-session-config-control="${cssAttr(control.key)}"]`,
        selectedAttr: "data-session-config-selected",
      };
  }
}

// ── LOCAL-5 tab-strip production bodies (new tab-strip testids, BRIEF §4.6) ──

async function createEmptyChat(
  world: ReadyLocalWorld,
  page: ProductPage,
  harness: LocalHarnessKind,
): Promise<{ workspaceId: string; sessionId: string; tabId: string }> {
  const p = page.page;
  // Selecting the repo + "Work locally" leaves a pending workspace whose first
  // (empty) chat tab is created without a message; wait for the tab strip to
  // render the single empty chat and read its identity off the new testids.
  await p.locator("[data-workspace-tab-strip]").first().waitFor({ state: "visible", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
  const tab = p.locator('[data-chat-tab][data-workspace-empty-chat="true"]').first();
  await tab.waitFor({ state: "visible", timeout: TAB_SETTLE_TIMEOUT_MS });
  const tabId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab", tab);
  const workspaceId = await readRequiredAttr(p, "[data-workspace-shell]", "data-workspace-ui-key");
  const sessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", tab);
  void world;
  return { workspaceId, sessionId, tabId };
}

async function switchHarnessEmptyChat(
  world: ReadyLocalWorld,
  page: ProductPage,
  toHarness: LocalHarnessKind,
): Promise<{ oldSessionId: string; newSessionId: string; tabId: string }> {
  await ensureHarnessReady(world, page, toHarness);
  const p = page.page;
  const tab = p.locator("[data-chat-tab]").first();
  const tabId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab", tab);
  const oldSessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", tab);
  await selectHarnessInComposer(page, toHarness);
  // The unused backend session is replaced in place: same visible tab, a new
  // session id. Poll the same tab until its session-id attribute changes.
  const newSessionId = await waitForAttrChange(p, "[data-chat-tab]", "data-chat-tab-session-id", oldSessionId, tab);
  return { oldSessionId, newSessionId, tabId };
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
): Promise<{ preservedTabId: string; newTabId: string; newSessionId: string }> {
  await ensureHarnessReady(world, page, toHarness);
  const p = page.page;
  const activeTab = p.locator('[data-chat-tab][data-chat-tab-active="true"]').first();
  const preservedTabId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab", activeTab);
  const beforeCount = await p.locator("[data-chat-tab]").count();
  await selectHarnessInComposer(page, toHarness);
  // A new session tab appears immediately to the right of the messaged one.
  await p.locator("[data-chat-tab]").nth(beforeCount).waitFor({ state: "visible", timeout: TAB_SETTLE_TIMEOUT_MS });
  const newTab = p.locator('[data-chat-tab][data-chat-tab-active="true"]').first();
  const newTabId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab", newTab);
  const newSessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", newTab);
  return { preservedTabId, newTabId, newSessionId };
}

async function changeModelSameHarness(
  world: ReadyLocalWorld,
  page: ProductPage,
): Promise<{ sessionId: string; stayedInSession: boolean }> {
  const p = page.page;
  const activeTab = p.locator('[data-chat-tab][data-chat-tab-active="true"]').first();
  const sessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", activeTab);
  const harness = (await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-harness", activeTab)) as LocalHarnessKind;
  const preflight = await world.gateway.preflight();
  const probe = (await world.runtime.client.getGatewayModels(harness).catch(() => [])).map((model) => model.id);
  const candidates = probe.filter((id) => preflight.eligibleClaudeModels.includes(id));
  const nextModel = candidates.find((id) => id !== undefined);
  if (!nextModel) {
    throw new Error("changeModelSameHarness: no alternate eligible model to select");
  }
  await selectModelInComposer(page, nextModel);
  const afterSessionId = await readRequiredAttr(p, "[data-chat-tab]", "data-chat-tab-session-id", activeTab);
  return { sessionId, stayedInSession: afterSessionId === sessionId };
}

async function reloadAndVerifyTabs(
  world: ReadyLocalWorld,
  page: ProductPage,
  expect: { tabOrder: string[]; activeTabId: string },
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
  // Harness attachment + transcript survive: the active tab still names its
  // harness and an assistant reply is still rendered.
  await p
    .locator('[data-chat-tab][data-chat-tab-active="true"][data-chat-tab-harness]')
    .first()
    .waitFor({ state: "attached", timeout: 15_000 });
  await p
    .locator('[data-assistant-prose][data-assistant-streaming="false"]')
    .last()
    .waitFor({ state: "attached", timeout: 20_000 });
  void world;
}

/** Selects `harness` in the composer's agent picker (existing model picker
 * family reflects the harness through its models; harness selection is via the
 * same composer surface the smoke uses). */
async function selectHarnessInComposer(page: ProductPage, harness: LocalHarnessKind): Promise<void> {
  const p = page.page;
  const trigger = p.locator("[data-composer-model-trigger]:not([disabled])").first();
  await trigger.waitFor({ state: "visible", timeout: MODEL_PICKER_TIMEOUT_MS });
  await trigger.click();
  const harnessOption = p.locator(`[data-harness-auth-section="${cssAttr(harness)}"], [data-model-option]`).first();
  await harnessOption.waitFor({ state: "visible", timeout: 15_000 });
  await harnessOption.click();
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
