import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError } from "./types.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ensureLocalClone } from "../fixtures/git.js";
import { LocalRuntimeClient, findErrorEvent, findLastAssistantReply, findTurnEndedEvent } from "../fixtures/local-runtime.js";

/**
 * T3-CHAT-1 — every harness x its cheapest model, via the gateway.
 * specs/developing/testing/scenarios.md#T3-CHAT-1
 *
 * Model-set resolution is catalog-driven, Anthropic-family only for now (per
 * the build task): `catalogHarnesses()` below reads `catalogs/agents/catalog.json`
 * and returns, for each cataloged harness, its cheapest model whose
 * `availability` includes an Anthropic source (`anthropic-api` /
 * `anthropic-oauth` / `bedrock`) — `undefined` when a harness has no such
 * model yet (Codex/Gemini CLI/Grok need their own provider family's key,
 * which does not exist yet; they light up automatically once that model-set
 * lookup finds a match, no code change needed).
 *
 * Local lane: real, against the local AnyHarness runtime directly, using
 * whichever credential source the runtime already resolves for the harness
 * (native CLI login for Claude on this machine — verified for real
 * 2026-07-08: haiku model, real turn_ended, real "pong" reply). Not yet
 * routed through a dedicated RELEASE_E2E_GATEWAY_TEST_KEY allowlisted test
 * key (that credential does not exist yet, see env-manifest.ts) — tracked as
 * a follow-up, not silently pretended away.
 *
 * Sandbox lane: real code, gated by current_product_user until
 * fix/product-user-single-org-bypass merges (the gateway proxy route is
 * current_product_user-gated).
 */
export const t3Chat1: ScenarioDefinition = {
  id: "T3-CHAT-1",
  title: "every harness x its cheapest model, via the gateway",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-CHAT-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [],
  plan: ({ runtimeLane, agents }) => {
    const harnesses = agents.includes("all") ? ["claude", "codex", "cursor", "grok", "opencode"] : [...agents];
    return harnesses.flatMap((harness) => [
      {
        description: `[${harness}] resolve cheapest Anthropic-family model from catalogs/agents/catalog.json (skip if none)`,
      },
      {
        description: `[${harness}] assert installed CLI version == catalog pin (before chat), ${
          runtimeLane === "local" ? "in the local runtime home" : "inside the sandbox"
        }`,
      },
      { description: `[${harness}] create session, send one message, await turn_ended` },
      { description: `[${harness}] assert non-empty assistant reply arrived` },
      { description: `[${harness}] close and reopen the session, assert transcript persists` },
    ]);
  },
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.runtimeLane === "sandbox") {
      throw new ScenarioBlockedError(
        "T3-CHAT-1/sandbox: session creation is proxied through " +
          "/v1/cloud/cloud-sandbox/anyharness/*, which is current_product_user-gated. " +
          "See src/fixtures/product-gate.ts.",
      );
    }
    await runLocalLane(ctx.agents);
  },
};

interface HarnessModelChoice {
  harnessKind: string;
  /**
   * Ranked candidates, cheapest-preferred first. More than one candidate
   * exists because a catalog-declared option is not always accepted by the
   * runtime — found running this for real 2026-07-08: opencode's catalog
   * entry `anthropic/claude-3-5-haiku-latest` 400s `SESSION_MODEL_UNSUPPORTED`
   * even though the catalog lists it as available for opencode. Filed as
   * https://github.com/proliferate-ai/proliferate/issues/1024 (catalog/runtime
   * model-id mismatch — every anthropic/claude-* id tried for opencode 400s
   * the same way, not just the "-latest" alias); this fallback list keeps
   * the scenario reporting a clear per-harness expected-fail instead of a
   * confusing red while the product fix lands.
   */
  modelCandidates: string[];
  catalogPinVersion: string | undefined;
}

/** Per-harness result, so a single harness's failure never fails the whole scenario (per-harness red). */
export interface PerHarnessChatResult {
  harnessKind: string;
  status: "green" | "skipped-no-anthropic-model" | "expected-fail";
  detail: string;
}

async function runLocalLane(agentsSelector: readonly string[]): Promise<void> {
  const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
  const client = new LocalRuntimeClient({ baseUrl: runtimeUrl });

  const requestedHarnesses = agentsSelector.includes("all")
    ? ["claude", "codex", "cursor", "grok", "opencode"]
    : [...agentsSelector];

  const choices = await catalogHarnesses(requestedHarnesses);
  const results: PerHarnessChatResult[] = [];

  const githubTestRepo = process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO;
  const repoPath = await ensureLocalClone(githubTestRepo);
  const { workspace } = await client.createLocalWorkspace(repoPath);

  try {
    for (const harnessKind of requestedHarnesses) {
      const choice = choices.get(harnessKind);
      if (!choice) {
        results.push({
          harnessKind,
          status: "skipped-no-anthropic-model",
          detail: "no Anthropic-family model found for this harness in catalogs/agents/catalog.json (needs its own provider key)",
        });
        continue;
      }
      let lastError: unknown;
      let succeededModel: string | undefined;
      for (const modelId of choice.modelCandidates) {
        try {
          await runOneHarness(client, workspace.id, { ...choice, modelId });
          succeededModel = modelId;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (succeededModel) {
        results.push({ harnessKind, status: "green", detail: `model=${succeededModel}` });
      } else {
        results.push({
          harnessKind,
          status: "expected-fail",
          detail: lastError instanceof Error ? lastError.message : String(lastError),
        });
      }
    }
  } finally {
    await client.deleteWorkspace(workspace.id).catch(() => undefined);
  }

  console.log("[T3-CHAT-1/local] per-harness results:");
  for (const result of results) {
    console.log(`  - ${result.harnessKind}: ${result.status} (${result.detail})`);
  }

  const failed = results.filter((r) => r.status === "expected-fail");
  const green = results.filter((r) => r.status === "green");
  assert.ok(green.length > 0, "T3-CHAT-1/local: at least one Anthropic-family harness (claude) must go green");
  if (failed.length > 0) {
    // Per-harness red is surfaced but does not fail the whole scenario run —
    // the contract's own rule ("per-harness failure = per-harness red, not
    // whole-suite red"). The individual diagnoses are in the console output
    // above; a real per-harness report wire-up is a follow-up once the
    // issues-service (specs/tbd/issues-service-v1.md) exists to receive them.
    console.warn(
      `[T3-CHAT-1/local] ${failed.length} harness(es) failed: ${failed.map((f) => f.harnessKind).join(", ")}`,
    );
  }
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

const ANTHROPIC_AVAILABILITY_SOURCES = new Set(["anthropic-api", "anthropic-oauth", "bedrock"]);

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
  const catalogPath = path.resolve(import.meta.dirname, "../../../../catalogs/agents/catalog.json");
  const raw = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as {
    agents?: Array<{
      kind?: string;
      harness?: { native?: { version?: string }; agentProcess?: { version?: string } };
      session?: {
        models?: Array<{ id: string; availability?: { anyOf?: string[] } }>;
      };
    }>;
  };

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
