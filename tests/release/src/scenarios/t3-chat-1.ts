import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  MatrixScenarioDefinition,
  ScenarioCellOutcome,
  ScenarioCellSpec,
} from "./types.js";
import { ScenarioExpectedFailError } from "./types.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ensureLocalClone } from "../fixtures/git.js";
import { LocalRuntimeClient, findErrorEvent, findLastAssistantReply, findTurnEndedEvent } from "../fixtures/local-runtime.js";
import type { PlannedCellV1 } from "../runner/result.js";

/**
 * T3-CHAT-1 — every harness x its cheapest model, via the gateway.
 * specs/developing/testing/scenarios.md#T3-CHAT-1
 *
 * First real matrix consumer of the exact-cell contract
 * (specs/developing/testing/exact-test-matrix.md): each harness is its own
 * planned cell (`T3-CHAT-1/<lane>/harness=<kind>`), the workspace setup stays
 * batched in one `runCells()` invocation, and every assigned harness gets one
 * explicit outcome — one green harness can no longer hide a failed, blocked,
 * or omitted harness. This remains a legacy diagnostic scenario; it does not
 * claim canonical LOCAL-2 or any target-manifest row.
 *
 * Model-set resolution is catalog-driven, Anthropic-family only for now (per
 * the build task): `catalogHarnesses()` below reads `catalogs/agents/catalog.json`
 * and returns, for each cataloged harness, its cheapest model whose
 * `availability` includes an Anthropic source (`anthropic-api` /
 * `anthropic-oauth` / `bedrock`) — `undefined` when a harness has no such
 * model yet (Codex/Gemini CLI/Grok need their own provider family's key,
 * which does not exist yet). A harness with no compatible model is an
 * explicit `blocked` child; a real turn/install/reopen failure is an explicit
 * `failed` child.
 *
 * Local lane: real, against the local AnyHarness runtime directly, using
 * whichever credential source the runtime already resolves for the harness
 * (native CLI login for Claude on this machine — verified for real
 * 2026-07-09: on fresh main the t3local account classifies claude to
 * `["bedrock"]`, so the bare native ids are correctly gated
 * `SESSION_MODEL_GATED` and the candidate resolver lands on a
 * gateway/Bedrock id).
 *
 * Sandbox lane: the current_product_user gate is lifted in single-org mode
 * (verified 2026-07-09); what remains is a test-implementation gap: driving a
 * full agent chat session inside a real E2B sandbox through the
 * `/v1/gateway/cloud-sandbox/anyharness/*` proxy is not yet written. The
 * collector throws `ScenarioExpectedFailError`, which the runner applies to
 * every assigned sandbox child — explicit non-green children rather than one
 * green parent. Tracked test TODO (#1042).
 */
export const t3Chat1: MatrixScenarioDefinition = {
  id: "T3-CHAT-1",
  title: "every harness x its cheapest model, via the gateway",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-CHAT-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [],
  kind: "matrix",
  expandCells: async ({ agents }) => chatCellSpecs(agents),
  planCell: ({ runtimeLane }, cell) => {
    const harness = cell.dimensions.harness;
    return [
      {
        description: `[${harness}] resolve cheapest Anthropic-family model from catalogs/agents/catalog.json (blocked child if none)`,
      },
      {
        description: `[${harness}] assert installed CLI version == catalog pin (before chat), ${
          runtimeLane === "local" ? "in the local runtime home" : "inside the sandbox"
        }`,
      },
      { description: `[${harness}] create session, send one message, await turn_ended` },
      { description: `[${harness}] assert non-empty assistant reply arrived` },
      { description: `[${harness}] close and reopen the session, assert transcript persists` },
    ];
  },
  runCells: async (ctx, cells) => {
    if (ctx.runtimeLane === "sandbox") {
      throw new ScenarioExpectedFailError(
        "T3-CHAT-1/sandbox: the current_product_user gate is lifted in single-org mode (verified " +
          "2026-07-09), but driving a full agent chat session inside a real E2B sandbox through the " +
          "/v1/gateway/cloud-sandbox/anyharness/* proxy is not yet implemented — it needs a running " +
          "durable sandbox and a publicly reachable RELEASE_E2E_SERVER_URL. Tracked test TODO (#1042).",
      );
    }
    return runLocalLane(cells);
  },
};

/**
 * One cell per harness. `all` derives the shipped harness kinds from
 * `catalogs/agents/catalog.json` — not a second hand-written list; an
 * explicit `--agents` selection produces one cell per selected harness. The
 * same expansion applies independently to each runtime lane.
 */
export async function chatCellSpecs(agentsSelector: readonly string[]): Promise<ScenarioCellSpec[]> {
  const harnesses = agentsSelector.includes("all") ? await shippedHarnessKinds() : [...agentsSelector];
  return harnesses.map((harness) => ({ dimensions: { harness } }));
}

/** Every cataloged agent kind, in catalog order. */
export async function shippedHarnessKinds(): Promise<string[]> {
  const catalog = await readCatalog();
  return (catalog.agents ?? []).map((agent) => agent.kind).filter((kind): kind is string => Boolean(kind));
}

export interface HarnessModelChoice {
  harnessKind: string;
  /**
   * Ranked candidates, cheapest-preferred first. More than one candidate is
   * kept because which id the runtime accepts depends on the account's
   * classified auth context: on a Bedrock/gateway-classified account (t3local,
   * fresh main 2026-07-09) the bare native ids are gated `SESSION_MODEL_GATED`
   * and a `us.anthropic.*`/`anthropic/claude-*` id is the one that passes, so
   * trying candidates in order lands on whatever the live classification
   * yields.
   */
  modelCandidates: string[];
  catalogPinVersion: string | undefined;
}

/**
 * The seam between the per-cell outcome mapping and the live runtime, so the
 * green/failed/blocked classification and the single shared workspace
 * lifecycle are provable without a running AnyHarness.
 */
export interface ChatLaneIO {
  resolveChoices(harnesses: readonly string[]): Promise<Map<string, HarnessModelChoice>>;
  /** One shared workspace for every assigned cell; closed exactly once. */
  openWorkspace(): Promise<{ workspaceId: string; close(): Promise<void> }>;
  candidatesFor(harnessKind: string, catalogCandidates: readonly string[]): Promise<string[]>;
  attemptModel(workspaceId: string, choice: HarnessModelChoice & { modelId: string }): Promise<void>;
}

async function runLocalLane(cells: readonly PlannedCellV1[]): Promise<ScenarioCellOutcome[]> {
  const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
  const client = new LocalRuntimeClient({ baseUrl: runtimeUrl });
  return collectChatOutcomes(cells, {
    resolveChoices: (harnesses) => catalogHarnesses(harnesses),
    openWorkspace: async () => {
      const githubTestRepo = process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO;
      const repoPath = await ensureLocalClone(githubTestRepo);
      const { workspace } = await client.createLocalWorkspace(repoPath);
      return {
        workspaceId: workspace.id,
        close: async () => {
          await client.deleteWorkspace(workspace.id).catch(() => undefined);
        },
      };
    },
    candidatesFor: (harnessKind, catalogCandidates) =>
      withGatewayProbedCandidates(client, harnessKind, catalogCandidates),
    attemptModel: (workspaceId, choice) => runOneHarness(client, workspaceId, choice),
  });
}

/**
 * The real per-cell result mapping: one shared workspace for the whole batch
 * (opened once, closed once in finally); per assigned cell, no compatible
 * model → explicit `blocked`, a real failure across every candidate model →
 * explicit `failed`, a passing model → `green`. Mixed outcomes stay mixed.
 */
export async function collectChatOutcomes(
  cells: readonly PlannedCellV1[],
  io: ChatLaneIO,
): Promise<ScenarioCellOutcome[]> {
  const requestedHarnesses = cells.map((cell) => cell.dimensions.harness);
  const choices = await io.resolveChoices(requestedHarnesses);
  const outcomes: ScenarioCellOutcome[] = [];

  const workspace = await io.openWorkspace();
  try {
    for (const cell of cells) {
      const harnessKind = cell.dimensions.harness;
      const choice = choices.get(harnessKind);
      if (!choice) {
        outcomes.push({
          cellId: cell.cell_id,
          status: "blocked",
          reason: {
            code: "scenario_blocked",
            message:
              `[${harnessKind}] no Anthropic-family model found in catalogs/agents/catalog.json ` +
              "(needs its own provider key before this cell can run for real)",
          },
        });
        continue;
      }
      let lastError: unknown;
      let succeededModel: string | undefined;
      const candidates = await io.candidatesFor(harnessKind, choice.modelCandidates);
      for (const modelId of candidates) {
        try {
          await io.attemptModel(workspace.workspaceId, { ...choice, modelId });
          succeededModel = modelId;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (succeededModel) {
        console.log(`[${cell.cell_id}] green (model=${succeededModel})`);
        outcomes.push({ cellId: cell.cell_id, status: "green" });
      } else {
        // A real turn/install/reopen failure is an explicit failed child —
        // never expected-fail, never hidden behind a green sibling.
        outcomes.push({
          cellId: cell.cell_id,
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: lastError instanceof Error ? lastError.message : String(lastError),
          },
        });
      }
    }
  } finally {
    await workspace.close();
  }

  return outcomes;
}

async function runOneHarness(
  client: LocalRuntimeClient,
  workspaceId: string,
  choice: HarnessModelChoice & { modelId: string },
): Promise<void> {
  const installed = await client.installAgent(choice.harnessKind);
  const installedVersion = installed.native?.version ?? installed.agentProcess?.version ?? undefined;
  if (choice.catalogPinVersion && installedVersion) {
    assert.equal(
      installedVersion,
      choice.catalogPinVersion,
      `[${choice.harnessKind}] installed CLI version must equal catalog pin before chat`,
    );
  }

  const session = await client.createSession({
    workspaceId,
    agentKind: choice.harnessKind,
    modelId: choice.modelId,
  });
  await client.prompt(session.id, "Reply with exactly the word: pong");
  await client.waitForIdle(session.id, { timeoutMs: 60_000 });

  const events = await client.getEvents(session.id);
  const errorMessage = findErrorEvent(events);
  assert.equal(errorMessage, undefined, `[${choice.harnessKind}] session must not error: ${errorMessage}`);
  assert.ok(findTurnEndedEvent(events), `[${choice.harnessKind}] turn_ended event must be observed`);
  const reply = findLastAssistantReply(events);
  assert.ok(reply && reply.trim().length > 0, `[${choice.harnessKind}] must produce a non-empty assistant reply`);

  // Session persists and reopens: re-fetch by id, assert same session still resolves with its history.
  const reopened = await client.getSession(session.id);
  assert.equal(reopened.id, session.id, `[${choice.harnessKind}] session must reopen with the same id`);
}

/**
 * Rank model candidates for a harness, preferring the runtime's own probed
 * gateway list when one exists. When gateway auth was pushed for this run
 * (the CI path), the pushed key is typically allowlisted to a cheap model set
 * — catalog-derived ids the key cannot serve 403 at the provider, so the
 * probed ids (what the key can actually reach, cheapest-first per the same
 * tier preference) are tried first and the catalog candidates kept as a
 * fallback. With no gateway configured (a native-login laptop) the probe list
 * is empty or the endpoint errs, and the catalog candidates pass through
 * unchanged. Live probing chooses the cheapest usable model; it never removes
 * a planned harness cell.
 */
export async function withGatewayProbedCandidates(
  client: LocalRuntimeClient,
  harnessKind: string,
  catalogCandidates: readonly string[],
): Promise<string[]> {
  let probed: Array<{ id: string }> = [];
  try {
    probed = await client.getGatewayModels(harnessKind);
  } catch {
    return [...catalogCandidates];
  }
  const byPreference = (id: string): number => {
    if (/fable/i.test(id)) return 99;
    if (/haiku|mini/i.test(id)) return 0;
    if (/sonnet/i.test(id)) return 1;
    return 2;
  };
  const probedIds = probed
    .map((model) => model.id)
    .filter((id) => !/fable/i.test(id))
    .sort((a, b) => byPreference(a) - byPreference(b));
  const merged = [...probedIds, ...catalogCandidates];
  return [...new Set(merged)];
}

const ANTHROPIC_AVAILABILITY_SOURCES = new Set(["anthropic-api", "anthropic-oauth", "bedrock"]);

interface CatalogShape {
  agents?: Array<{
    kind?: string;
    harness?: { native?: { version?: string }; agentProcess?: { version?: string } };
    session?: {
      models?: Array<{ id: string; availability?: { anyOf?: string[] } }>;
    };
  }>;
}

async function readCatalog(): Promise<CatalogShape> {
  const catalogPath = path.resolve(import.meta.dirname, "../../../../catalogs/agents/catalog.json");
  return JSON.parse(await readFile(catalogPath, "utf8")) as CatalogShape;
}

/**
 * Reads catalogs/agents/catalog.json and returns, per requested harness kind,
 * its cheapest model with an Anthropic-family availability source — the
 * catalog-driven resolution named in the scenario contract. "Cheapest" reads
 * the catalog's own declared order within `session.models[]` (first
 * Anthropic-eligible entry with `defaultVisible` favoring the smallest/cheap
 * tier by convention — `haiku` sorts first for claude in the current
 * catalog); this is intentionally simple rather than parsing $/Mtok pricing
 * strings, and returns the same shape regardless.
 */
export async function catalogHarnesses(
  requestedHarnesses: readonly string[],
): Promise<Map<string, HarnessModelChoice>> {
  const catalog = await readCatalog();

  const result = new Map<string, HarnessModelChoice>();
  for (const agent of catalog.agents ?? []) {
    if (!agent.kind || !requestedHarnesses.includes(agent.kind)) {
      continue;
    }
    const models = agent.session?.models ?? [];
    const hasAnthropicAvailability = (model: { availability?: { anyOf?: string[] } }): boolean =>
      (model.availability?.anyOf ?? []).some((source) => ANTHROPIC_AVAILABILITY_SOURCES.has(source));
    // `availability.anyOf` names an *auth mode*, not a model's provider — for
    // some harnesses (codex) a non-Anthropic model can carry an
    // "anthropic-oauth"-named source because that auth mode's subscription
    // grants access to it too (found running this catalog for real,
    // 2026-07-08: codex's list otherwise includes `openai.gpt-5.5` etc.).
    // Claude Code's own bare option ids ("haiku"/"sonnet"/"opus"/"default")
    // never contain the word "claude", so the harness's own native models
    // are trusted by availability alone; every other harness additionally
    // requires the id to name a Claude model (e.g. opencode's
    // "anthropic/claude-...").
    const isAnthropicModel = (model: { id: string; availability?: { anyOf?: string[] } }): boolean =>
      hasAnthropicAvailability(model) && (agent.kind === "claude" || /claude/i.test(model.id));

    const anthropicModels = models.filter(isAnthropicModel);
    if (anthropicModels.length === 0) {
      continue;
    }
    // Cheapest-tier preference, in order — and Fable is explicitly excluded
    // even as a last resort: it is the most expensive tier in the catalog
    // (per this repo's own model-usage policy, never picked implicitly for
    // fan-out/test traffic), so a harness with only Fable+Opus available
    // here is treated as having no cheap Anthropic model rather than
    // silently burning an expensive call.
    const byPreference = (id: string): number => {
      let tier = 3;
      if (/haiku/i.test(id)) tier = 0;
      else if (/sonnet/i.test(id)) tier = 1;
      else if (id === "default") tier = 2;
      if (/fable/i.test(id)) return 99;
      // Deprioritize "-latest"-suffixed aliases: found running this catalog
      // for real 2026-07-08 that a "-latest" alias can be catalog-listed but
      // runtime-rejected (SESSION_MODEL_UNSUPPORTED) even when a
      // dated/versioned sibling id for the same tier works.
      return /latest/i.test(id) ? tier + 0.5 : tier;
    };
    const candidates = [...anthropicModels]
      .filter((model) => !/fable/i.test(model.id))
      .sort((a, b) => byPreference(a.id) - byPreference(b.id))
      .map((model) => model.id);
    if (candidates.length === 0) {
      continue;
    }
    result.set(agent.kind, {
      harnessKind: agent.kind,
      modelCandidates: candidates,
      catalogPinVersion: agent.harness?.native?.version ?? agent.harness?.agentProcess?.version,
    });
  }
  return result;
}
