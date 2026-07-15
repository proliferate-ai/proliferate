import { createHash } from "node:crypto";

import type { Page } from "playwright";

import type { ScenarioCellOutcome, ScenarioRunContext } from "../types.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import {
  bootLocalFunctionalWorld,
  resolveLocalFunctionalWorldInputs,
} from "./world-boot.js";
import { captureLocalDriverFailure } from "./debug-capture.js";
import { resolveLocalWorkspaceSessionId } from "./local-session.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";
import type { LocalWorldCleanupEvidence } from "../../worlds/local-workspace/cleanup.js";
import { authenticatedActor, type AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import { preparedRepository, type PreparedRepository } from "../../fixtures/prepared-repository.js";
import { productPage, type ProductPage } from "../../fixtures/product-page.js";
import { resolveIntegrationNamespace } from "../../fixtures/integrations.js";
import {
  enrollGatewayWorker,
  gatewayListTools,
  pickSearchTool,
  runIntegrationAuditProbe,
  writeGatewayDotfile,
  type GatewayGrant,
} from "../../fixtures/integration-gateway.js";
import { findErrorEvent, findTurnEndedEvent } from "../../fixtures/local-runtime.js";
import { selectCheapestEligibleClaudeModel } from "../../services/qualification-litellm.js";
import type {
  LocalCleanupV1,
  LocalHarnessKind,
  LocalMcpIntegrationEvidenceV1,
} from "../../evidence/schema.js";

/**
 * LOCAL-7 (Product MCP integration for every harness) under `T3-INT-1/local/
 * harness=<kind>`. Owner: integration-mcp workstream.
 *
 * Ports `t3-int-1` to the world-backed local lane: its hardcoded 5-harness list
 * is REPLACED by the catalog-derived selector (`shippedHarnessKinds()`), and its
 * DB audit-probe seam (`integration_audit_probe.py`, `cloud_integration_tool_call_event`)
 * is REUSED to read back the audit row. Per harness: connect the deterministic
 * real integration (Exa via `RELEASE_E2E_INTEGRATION_API_KEY`) through the
 * product UI, create a FRESH session so startup MCP injection is exercised, and
 * use the cheapest eligible model to make one real call through the Proliferate
 * integrations MCP. Assert the expected provider/tool operation and product
 * audit correlation → green `local_mcp_integration` evidence.
 *
 * This proves positive per-harness Product MCP translation only; it does NOT
 * assert hidden server credential state or a disconnect/failure matrix.
 */

const HARNESS_READY_TIMEOUT_MS = 300_000;
const MODEL_PICKER_TIMEOUT_MS = 60_000;
const WORKSPACE_SETTLE_TIMEOUT_MS = 90_000;
const TURN_TIMEOUT_MS = 300_000;

export interface LocalMcpDriver {
  createActor(world: ReadyLocalWorld, harness: LocalHarnessKind): Promise<AuthenticatedActor>;
  prepareRepo(world: ReadyLocalWorld, actor: AuthenticatedActor, cellId: string): Promise<PreparedRepository>;
  openPage(world: ReadyLocalWorld, actor: AuthenticatedActor): Promise<ProductPage>;
  ensureHarnessReady(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind): Promise<void>;

  /** Connect the api_key integration (default exa) through the product UI
   * (IntegrationConnectDialog), reading the key from RELEASE_E2E_INTEGRATION_API_KEY. */
  connectIntegration(page: ProductPage, namespace: string): Promise<void>;

  selectRepoAndWorkLocally(page: ProductPage, repo: PreparedRepository): Promise<void>;

  /** Create a FRESH session (so startup MCP injection runs) and drive one agent
   * turn on the cheapest eligible model, prompted to call an integration tool
   * through the `proliferate_integrations` MCP. Returns the ids + tool name. */
  runIntegrationTurn(world: ReadyLocalWorld, page: ProductPage, harness: LocalHarnessKind, namespace: string, repoPath: string): Promise<{ workspaceId: string; sessionId: string; modelId: string; toolName: string }>;

  /** Read back the `cloud_integration_tool_call_event` audit row via the reused
   * DB probe seam and assert ok=true for this namespace/tool. Returns its id. */
  assertAuditRow(actor: AuthenticatedActor, namespace: string, toolName: string): Promise<{ auditEventId: string }>;

  closeWorld(world: ReadyLocalWorld): ReturnType<ReadyLocalWorld["close"]>;
}

/**
 * Thrown when no eligible non-Fable Claude model is present in the
 * intersection of the qualification allowlist and AnyHarness's live gateway
 * probe. The collector maps this to a typed `blocked` cell, distinct from a
 * genuine turn/tool-call/audit failure.
 */
export class NoEligibleMcpModelError extends Error {}

/**
 * The actor created for a harness is cached here (module-scoped, consumed
 * synchronously within the same cell's sequential flow) so `runIntegrationTurn`
 * — whose signature is frozen by the shared driver contract and does not carry
 * an actor parameter — can reach the authenticated API client it needs to
 * provision the per-actor gateway worker grant and discover the real tool name.
 * Cells are processed one harness at a time (never concurrently) by
 * `runLocal7McpCellsAgainstWorld`, so a plain Map keyed by harness kind is safe.
 */
const actorsByHarness = new Map<LocalHarnessKind, AuthenticatedActor>();

export const defaultLocalMcpDriver: LocalMcpDriver = {
  async createActor(world, harness) {
    const actor = await authenticatedActor(world, "owner", { harnessKind: harness });
    actorsByHarness.set(harness, actor);
    return actor;
  },
  prepareRepo: (world, actor, cellId) => preparedRepository(world, actor, { cellId }),
  openPage: (world, actor) => productPage(world, actor),
  async ensureHarnessReady(world, page, harness) {
    const client = world.runtime.client;
    const deadline = Date.now() + HARNESS_READY_TIMEOUT_MS;
    let triggeredInstall = false;
    let last: Awaited<ReturnType<typeof client.getAgent>> | undefined;
    let launchable = false;
    while (Date.now() < deadline) {
      last = await client.getAgent(harness).catch(() => undefined);
      const options = await client.getAgentLaunchOptions().catch(() => []);
      const entry = options.find((agent) => agent.kind === harness);
      if (entry && entry.models.length > 0) {
        launchable = true;
        break;
      }
      if (
        !triggeredInstall &&
        last &&
        last.installState !== "installing" &&
        (last.readiness === "install_required" || last.installState === "not_installed")
      ) {
        triggeredInstall = true;
        await client.installAgent(harness).catch(() => undefined);
      }
      await sleep(2_000);
    }
    if (!launchable) {
      throw new Error(
        `ensureHarnessReady: agent "${harness}" never became launchable within ${HARNESS_READY_TIMEOUT_MS}ms ` +
          `(last: readiness=${last?.readiness}, installState=${last?.installState}).`,
      );
    }
    await page.page.reload({ waitUntil: "domcontentloaded" });
    await page.page
      .locator("[data-home-composer-editor]")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  },
  async connectIntegration(page, namespace) {
    const apiKey = process.env.RELEASE_E2E_INTEGRATION_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(`connectIntegration: RELEASE_E2E_INTEGRATION_API_KEY is not set for namespace "${namespace}".`);
    }
    const p = page.page;
    const already = p.locator(`[data-integration-connected="${cssAttr(namespace)}"]`).first();
    if (await already.count().catch(() => 0)) {
      return;
    }
    const trigger = p.locator(`[data-integration-connect-trigger="${cssAttr(namespace)}"]`).first();
    await trigger.waitFor({ state: "visible", timeout: 20_000 });
    await trigger.click();
    const dialog = p.locator("[data-integration-connect-dialog]").first();
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    await p.locator("[data-integration-api-key-input]").first().fill(apiKey);
    await p.locator("[data-integration-connect-submit]").first().click();
    await p
      .locator(`[data-integration-connected="${cssAttr(namespace)}"]`)
      .first()
      .waitFor({ state: "attached", timeout: 30_000 });
  },
  async selectRepoAndWorkLocally(page, repo) {
    const p = page.page;
    await clickByRole(p, "button", /^Project:/, "home Project picker trigger");
    const repoRow = p.locator(`[data-repo-source-root="${cssAttr(repo.path)}"]`).first();
    try {
      await repoRow.waitFor({ state: "visible", timeout: 20_000 });
      await repoRow.click();
    } catch (error) {
      const repoName = deriveRepoName(repo);
      try {
        await clickMenuItemByText(p, repoName, "prepared repository row");
      } catch {
        throw new Error(`selectRepoAndWorkLocally: prepared repo not offered by the project picker (${describeError(error)}).`);
      }
    }
    await clickByRole(p, "button", /^Runtime:/, "home Runtime picker trigger");
    await clickMenuItemByText(p, "Work locally", '"Work locally" runtime option');
  },
  async runIntegrationTurn(world, page, harness, namespace, repoPath) {
    const actor = actorsByHarness.get(harness);
    if (!actor) {
      throw new Error(`runIntegrationTurn: no actor was created for harness "${harness}" before this call.`);
    }

    // Provision a per-actor gateway worker grant and write the dotfile the
    // running AnyHarness reads at session-launch time so it injects the
    // `proliferate_integrations` MCP into the FRESH session created below —
    // mirrors the exact desktop enrollment/worker-enroll path (see
    // fixtures/integration-gateway.ts module doc).
    const grant = await enrollGatewayWorker(actor.api, {
      serverUrl: world.api.baseUrl,
      organizationId: actor.organizationId,
    });
    await writeGatewayDotfile(world.paths.runtimeHome, grant);

    const tools = await gatewayListTools(grant, namespace);
    const picked = pickSearchTool(tools, "Proliferate AI coding agents");
    if (!picked) {
      throw new Error(`runIntegrationTurn: the "${namespace}" provider exposed no callable tool through the gateway.`);
    }

    const [preflight, liveProbe] = await Promise.all([
      world.gateway.preflight(),
      world.runtime.client.getGatewayModels(harness),
    ]);
    const modelId = selectCheapestEligibleClaudeModel(
      preflight.eligibleClaudeModels,
      liveProbe.map((model) => model.id),
    );
    if (!modelId) {
      throw new NoEligibleMcpModelError(
        `[${harness}] no eligible non-Fable Claude model in the intersection of the qualification allowlist ` +
          "and AnyHarness's live gateway probe.",
      );
    }
    await selectModelInUi(page, modelId);

    const prompt =
      `You have an MCP server named "proliferate_integrations" that proxies external integrations. ` +
      `Call the tool "${picked.tool}" through it with the "${namespace}" provider — use ` +
      `"integrations.call_tool" with {"provider":"${namespace}","tool":"${picked.tool}","arguments":${JSON.stringify(
        picked.arguments,
      )}}. You MUST call integrations.call_tool. Reply with one result URL.`;

    const p = page.page;
    const editor = p.locator("[data-home-composer-editor]").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.fill(prompt);
    const send = p.locator("[data-chat-send-button]:not([disabled])").first();
    await send.waitFor({ state: "visible", timeout: 15_000 });
    await send.click();
    await p.locator("[data-workspace-shell]").first().waitFor({ state: "visible", timeout: 30_000 });
    await p
      .locator('[data-workspace-shell][data-pending-workspace="false"]')
      .first()
      .waitFor({ state: "attached", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
    // `data-workspace-ui-key` is the LOGICAL workspace id; resolve the session
    // from the CONCRETE runtime local workspace at the repo clone path (see
    // local-session.ts).
    const workspaceId = await readWorkspaceUiKey(p);
    const sessionId = await resolveLocalWorkspaceSessionId(world, repoPath, WORKSPACE_SETTLE_TIMEOUT_MS);
    const completion = await waitForTurnCompletion(world, sessionId, TURN_TIMEOUT_MS);
    if (completion.error) {
      throw new Error(`runIntegrationTurn: assistant turn errored: ${completion.error}`);
    }
    if (!completion.ended) {
      throw new Error(`runIntegrationTurn: assistant turn did not end within ${TURN_TIMEOUT_MS}ms.`);
    }

    return { workspaceId, sessionId, modelId, toolName: picked.tool };
  },
  async assertAuditRow(actor, namespace, toolName) {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const probe = await runIntegrationAuditProbe(actor.session.email, { namespace, sinceSeconds: 3600 });
      const row = probe.events.find((event) => event.ok && event.toolName === toolName);
      if (row) {
        return { auditEventId: row.id };
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `assertAuditRow: no ok=true cloud_integration_tool_call_event for "${namespace}.${toolName}" ` +
            `was found for ${actor.session.email}.`,
        );
      }
      await sleep(2_000);
    }
  },
  closeWorld: (world) => world.close(),
};

/** LOCAL-7 collector (T3-INT-1/local/harness=<kind>, world-backed, UI-driven). */
export async function collectLocal7McpCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: LocalMcpDriver = defaultLocalMcpDriver,
): Promise<ScenarioCellOutcome[]> {
  const inputs = resolveLocalFunctionalWorldInputs(ctx);
  if (!inputs.ok) {
    return cells.map((cell) => blockedOutcome(cell, inputs.reason));
  }

  let world: ReadyLocalWorld;
  try {
    // One world per scenario, keyed by scenario id for its isolated subdir.
    world = await bootLocalFunctionalWorld(inputs.value, cells[0]?.scenario_id ?? "T3-INT-1");
  } catch (error) {
    return cells.map((cell) => failedOutcome(cell, `world construction failed: ${describeError(error)}`));
  }

  return runLocal7McpCellsAgainstWorld(world, cells, driver);
}

/**
 * The real per-batch orchestration against an already-booted world, factored
 * out from `collectLocal7McpCells` so it is directly unit-testable against a
 * fake `ReadyLocalWorld` + fake `LocalMcpDriver` — the world-boot glue above
 * (owned by builders-ci) is never exercised by this workstream's tests.
 *
 * One world for the whole assigned-cell batch; each cell gets its own actor,
 * repository, page, and gateway worker grant (per-harness isolation), closed
 * exactly once in `finally` after every cell has run. The single cleanup
 * receipt folds into every green cell's evidence `cleanup` block; a cleanup
 * failure fails every cell that would otherwise have been green.
 */
export async function runLocal7McpCellsAgainstWorld(
  world: ReadyLocalWorld,
  cells: readonly PlannedCellV1[],
  driver: LocalMcpDriver = defaultLocalMcpDriver,
): Promise<ScenarioCellOutcome[]> {
  const namespace = resolveIntegrationNamespace();

  type CellEntry =
    | { cell: PlannedCellV1; ok: true; harness: LocalHarnessKind; modelId: string; workspaceId: string; sessionId: string; toolName: string; auditEventId: string }
    | { cell: PlannedCellV1; ok: false; status: "blocked" | "failed"; message: string };

  const entries: CellEntry[] = [];

  for (const cell of cells) {
    const harness = (cell.dimensions.harness ?? "claude") as LocalHarnessKind;
    try {
      const actor = await driver.createActor(world, harness);
      await world.trackActorSubjects?.(actor.gatewayKey);
      const repo = await driver.prepareRepo(world, actor, cell.cell_id);
      const page = await driver.openPage(world, actor);
      try {
        await driver.ensureHarnessReady(world, page, harness);
        await driver.connectIntegration(page, namespace);
        await driver.selectRepoAndWorkLocally(page, repo);
        const turn = await driver.runIntegrationTurn(world, page, harness, namespace, repo.path);
        const audit = await driver.assertAuditRow(actor, namespace, turn.toolName);
        entries.push({
          cell,
          ok: true,
          harness,
          modelId: turn.modelId,
          workspaceId: turn.workspaceId,
          sessionId: turn.sessionId,
          toolName: turn.toolName,
          auditEventId: audit.auditEventId,
        });
      } catch (uiError) {
        await captureLocalDriverFailure(page, `${cell.cell_id}-ui-failure`);
        throw uiError;
      } finally {
        await page.close().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof NoEligibleMcpModelError) {
        entries.push({ cell, ok: false, status: "blocked", message: error.message });
      } else {
        entries.push({ cell, ok: false, status: "failed", message: describeError(error) });
      }
    }
  }

  let cleanup: LocalWorldCleanupEvidence | undefined;
  let cleanupError: unknown;
  try {
    cleanup = await driver.closeWorld(world);
  } catch (error) {
    cleanupError = error;
  }

  const artifactIds = [
    world.artifacts.server.artifact_id,
    world.artifacts.anyharness.artifact_id,
    world.artifacts.desktopRenderer.artifact_id,
  ];
  const serverVersion = world.artifacts.server.version;
  const anyharnessVersion = world.artifacts.anyharness.version;

  return entries.map((entry) => {
    if (!entry.ok) {
      return entry.status === "blocked" ? blockedOutcome(entry.cell, entry.message) : failedOutcome(entry.cell, entry.message);
    }
    if (cleanupError) {
      return failedOutcome(entry.cell, `world cleanup failed: ${describeError(cleanupError)}`);
    }
    if (!cleanup || cleanup.failed > 0 || !allCleanupBooleansTrue(cleanup)) {
      return failedOutcome(entry.cell, `cleanup did not fully reconcile (failed=${cleanup?.failed ?? "unknown"})`);
    }
    const evidence = buildLocalMcpIntegrationEvidence({
      harness: entry.harness,
      artifactIds,
      serverVersion,
      anyharnessVersion,
      modelId: entry.modelId,
      workspaceId: entry.workspaceId,
      sessionId: entry.sessionId,
      integrationNamespace: namespace,
      toolName: entry.toolName,
      auditEventId: entry.auditEventId,
      cleanup: mapCleanup(cleanup),
    });
    return { cellId: entry.cell.cell_id, status: "green", evidence };
  });
}

export function buildLocalMcpIntegrationEvidence(input: {
  harness: LocalHarnessKind;
  artifactIds: string[];
  serverVersion: string;
  anyharnessVersion: string;
  modelId: string;
  workspaceId: string;
  sessionId: string;
  integrationNamespace: string;
  toolName: string;
  auditEventId: string;
  cleanup: LocalCleanupV1;
}): LocalMcpIntegrationEvidenceV1 {
  return {
    kind: "local_mcp_integration",
    artifact_ids: input.artifactIds,
    server_version: input.serverVersion,
    anyharness_version: input.anyharnessVersion,
    harness: input.harness,
    model_id: input.modelId,
    workspace_id_hash: sha256Hex(input.workspaceId),
    session_id_hash: sha256Hex(input.sessionId),
    integration_namespace: input.integrationNamespace,
    tool_name: input.toolName,
    audit_event_id_hash: sha256Hex(input.auditEventId),
    audit_ok: true,
    cleanup: input.cleanup,
  };
}

function blockedOutcome(cell: PlannedCellV1, message: string): ScenarioCellOutcome {
  return { cellId: cell.cell_id, status: "blocked", reason: { code: "scenario_blocked", message } };
}

function failedOutcome(cell: PlannedCellV1, message: string): ScenarioCellOutcome {
  return { cellId: cell.cell_id, status: "failed", reason: { code: "scenario_failure", message } };
}

function mapCleanup(cleanup: LocalWorldCleanupEvidence): LocalCleanupV1 {
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    throw new Error(`could not find ${what} (role=${role}, name=${name}): ${describeError(error)}`);
  }
  await locator.click();
}

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
    throw new Error(`could not find ${what} (text="${text}"): ${describeError(error)}`);
  }
  await byText.click();
}

/** The repository's display name as Desktop lists it — the clone's basename. */
function deriveRepoName(repo: PreparedRepository): string {
  const fromPath = repo.path.replace(/\/+$/, "").split("/").pop();
  if (fromPath && fromPath.length > 0) {
    return fromPath;
  }
  return repo.repoUrl.split("/").pop()?.replace(/\.git$/, "") ?? repo.path;
}

async function selectModelInUi(page: ProductPage, modelId: string): Promise<void> {
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
  throw new Error(`selectModelInUi: model "${modelId}" was not offered by the composer picker within ${MODEL_PICKER_TIMEOUT_MS}ms.`);
}

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

export type { GatewayGrant };
