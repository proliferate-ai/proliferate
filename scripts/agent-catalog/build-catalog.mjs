#!/usr/bin/env node
// Collate raw probe snapshots (generated/*.probe.json) into a single
// distribution/presentation catalog draft. Probes may inform labels, but the
// executable launch inventory is persisted separately as target-observed
// HarnessLaunchOptions and is never emitted here.
//
// Executable models, controls, values, defaults, availability, and gateway
// routing are intentionally excluded from the output.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = join(here, "generated");
const outPath = join(here, "catalog.draft.json");
const bundledPath = join(here, "..", "..", "catalogs", "agents", "catalog.json");
const probeStatePath = join(generatedDir, ".probe-logs", "run.state");
const resolvedCandidatePath = join(generatedDir, ".probe-logs", "resolved-candidate.json");
const allowedArgs = new Set(["--require-complete-probe"]);
for (const arg of process.argv.slice(2)) {
  if (!allowedArgs.has(arg)) throw new Error(`unexpected argument ${arg}`);
}
const requireCompleteProbe = process.argv.includes("--require-complete-probe");
let previousCatalog = null;
try { previousCatalog = JSON.parse(readFileSync(bundledPath, "utf8")); } catch {}
const previousByKind = new Map((previousCatalog?.agents ?? []).map((agent) => [agent.kind, agent]));

function normalizedNativeVersion(value) {
  if (typeof value !== "string") return null;
  return value.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? null;
}

function readCompleteProbeState() {
  let text;
  try {
    text = readFileSync(probeStatePath, "utf8");
  } catch (error) {
    throw new Error(`complete probe state is required at ${probeStatePath}: ${error.message}`);
  }
  const state = {};
  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    (state[key] ??= []).push(value);
  }
  if (state.complete?.at(-1) !== "true") {
    throw new Error("probe run is partial or failed; refusing to build a promotable catalog");
  }
  const required = new Set(state.required ?? []);
  const passed = new Set(state.passed ?? []);
  const missing = [...required].filter((id) => !passed.has(id));
  if (missing.length) {
    throw new Error(`probe state is incomplete; missing successful contexts: ${missing.join(", ")}`);
  }
  const startedAt = Date.parse(state.startedAt?.at(-1) ?? "");
  if (!Number.isFinite(startedAt)) throw new Error("probe state has no valid startedAt timestamp");
  const snapshotsByAgent = new Map();
  for (const id of passed) {
    const separator = id.indexOf(".");
    const agent = id.slice(0, separator);
    const context = id.slice(separator + 1);
    const snapshotPath = join(generatedDir, `${id}.probe.json`);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    if (snapshot.agentKind !== agent || snapshot.authContext !== context) {
      throw new Error(`${id}: probe state does not match ${snapshotPath}`);
    }
    const probedAt = Date.parse(snapshot.probedAt);
    if (!Number.isFinite(probedAt) || probedAt < startedAt) {
      throw new Error(`${id}: snapshot is missing or predates the authoritative probe run`);
    }
    if (!snapshotsByAgent.has(agent)) snapshotsByAgent.set(agent, []);
    snapshotsByAgent.get(agent).push(snapshot);
  }
  const activeAgents = new Set(state.agent ?? []);
  const candidate = JSON.parse(readFileSync(resolvedCandidatePath, "utf8"));
  const candidateByKind = new Map(candidate.agents.map((agent) => [agent.kind, agent]));
  for (const agent of snapshotsByAgent.keys()) {
    if (!activeAgents.has(agent)) {
      throw new Error(`${agent}: passed probe snapshots are not tied to a resolved agent`);
    }
  }
  for (const agent of activeAgents) {
    const agentSnapshots = snapshotsByAgent.get(agent) ?? [];
    if (!agentSnapshots.length) {
      throw new Error(`${agent}: resolved agent has no fresh successful probe context`);
    }
    const candidateAgent = candidateByKind.get(agent);
    if (!candidateAgent?.harness?.agentProcess?.source) {
      throw new Error(`${agent}: resolved candidate has no fenced agent-process source`);
    }
    const attestationVersions = agentSnapshots
      .map((snapshot) => snapshot.attestation?.version)
      .filter((version) => typeof version === "string" && version.trim());
    const observedVersions = new Set(attestationVersions);
    const sourceKind = candidateAgent.harness.agentProcess.source.kind;
    const mayUseFencedPinAttestation = sourceKind === "archive" || sourceKind === "npm";
    if (attestationVersions.length !== agentSnapshots.length && !(
      attestationVersions.length === 0 && mayUseFencedPinAttestation
    )) {
      const missingSnapshot = agentSnapshots.find((snapshot) => !snapshot.attestation?.version);
      throw new Error(
        `${agent}.${missingSnapshot?.authContext ?? "unknown"}: successful probe is missing ` +
        "agent-process attestation version",
      );
    }
    if (observedVersions.size > 1 || (
      observedVersions.size === 1 &&
      !observedVersions.has(candidateAgent.harness.agentProcess.version)
    )) {
      throw new Error(
        `${agent}: probe attestation (${[...observedVersions].join(", ") || "missing"}) ` +
        `does not match resolved candidate ${candidateAgent.harness.agentProcess.version}`,
      );
    }
    const candidateNative = candidateAgent.harness.native;
    if (candidateNative) {
      const observedNativeVersions = agentSnapshots.map((snapshot) => {
        const version = snapshot.nativeCli?.version;
        if (typeof version !== "string" || !version.trim()) {
          throw new Error(
            `${agent}.${snapshot.authContext}: successful probe is missing native CLI version ` +
            `required by resolved candidate ${candidateNative.version}`,
          );
        }
        return version;
      });
      const expected = normalizedNativeVersion(candidateNative.version);
      const observed = new Set(observedNativeVersions.map(normalizedNativeVersion));
      if (!expected || observed.has(null) || observed.size !== 1 || !observed.has(expected)) {
        throw new Error(
          `${agent}: native CLI versions (${observedNativeVersions.join(", ")}) ` +
          `do not match resolved candidate ${candidateNative.version}`,
        );
      }
    }
  }
  return { activeAgents, candidateByKind, passed };
}

const probeState = requireCompleteProbe ? readCompleteProbeState() : null;

const AGENT_DISPLAY_NAMES = { claude: "Claude", codex: "Codex", cursor: "Cursor", opencode: "OpenCode", grok: "Grok" };
// Which registry auth slot satisfies each probe auth context (curation-owned).
// Per-agent context -> registry auth slot. Slot ids MUST be slots the
// registry declares for that agent (the runtime classifier skips contexts
// whose slot the descriptor does not know); alternative auth routes for one
// credential mount share a slot — one winner per slot, document order is
// harness precedence.
const AUTH_CONTEXT_SLOTS = {
  claude: { "anthropic-api": "anthropic", "anthropic-oauth": "anthropic", "bedrock": "anthropic" },
  codex: { "openai-api": "openai", "openai-oauth": "openai", "bedrock": "openai" },
  cursor: { "cursor-login": "cursor" },
  opencode: {
    "anthropic-api": "anthropic",
    "openai-api": "openai",
    "gemini-api": "gemini",
    "opencode-zen": "opencode-zen",
  },
  grok: { "xai-api": "xai" },
};

// Runtime-detection signals per context (the curation overlay): how the
// runtime classifier recognizes each context over the composed launch env +
// filesystem discovery facts (anyharness-credential-discovery fact kinds).
// A context WITHOUT signals is probe-only: it never activates at runtime
// (codex/bedrock until a detector exists). Vocabulary must stay a subset of
// the registry slot's envVars/discoveryKinds (validation_pairing.rs).
const AUTH_CONTEXT_SIGNALS = {
  claude: {
    // CLAUDE_CODE_USE_BEDROCK=1 is the routing switch: when set, the CLI
    // routes to Bedrock and only serves us.anthropic.* inference-profile ids,
    // whichever credential source it uses. We key bedrock on the flag alone
    // and do NOT also require aws-credential-chain — that discovery covers only
    // the passive sources (env pair, bearer token, ~/.aws profile, SSO cache)
    // and deliberately misses the exotic tail (IMDS / task-role / container
    // credentials). A production Bedrock deployment on an ECS
    // task role sets the flag but has no passively detectable creds, so an
    // allOf would misclassify it as oauth/api and then accept bare ids the
    // account 400s on. The flag is the honest, sufficient signal.
    "bedrock": { envFlag: "CLAUDE_CODE_USE_BEDROCK=1" },
    "anthropic-api": { anyOf: [{ env: "ANTHROPIC_API_KEY" }, { env: "ANTHROPIC_AUTH_TOKEN" }] },
    "anthropic-oauth": { anyOf: [{ discovery: "claude-oauth-creds" }, { discovery: "claude-keychain" }] },
  },
  codex: {
    "openai-oauth": { anyOf: [{ discovery: "codex-auth-json-oauth" }, { discovery: "codex-keychain" }] },
    "openai-api": { anyOf: [{ env: "OPENAI_API_KEY" }, { env: "CODEX_API_KEY" }, { discovery: "codex-auth-json-api-key" }] },
  },
  cursor: {
    "cursor-login": { anyOf: [{ env: "CURSOR_API_KEY" }, { discovery: "cursor-keychain" }] },
  },
  opencode: {
    "anthropic-api": { anyOf: [{ env: "ANTHROPIC_API_KEY" }, { env: "ANTHROPIC_AUTH_TOKEN" }, { discovery: "opencode-auth-json/anthropic" }] },
    "openai-api": { anyOf: [{ env: "OPENAI_API_KEY" }, { discovery: "opencode-auth-json/openai" }] },
    "gemini-api": { anyOf: [{ env: "GEMINI_API_KEY" }, { env: "GOOGLE_API_KEY" }, { discovery: "opencode-auth-json/google" }, { discovery: "opencode-auth-json/gemini" }] },
    "opencode-zen": { discovery: "opencode-auth-json/opencode" },
  },
  grok: {
    "xai-api": { anyOf: [{ env: "XAI_API_KEY" }, { env: "GROK_API_KEY" }, { discovery: "grok-auth-json-oauth" }] },
  },
};

// Native goal support per harness (session.supportsGoals, curation-owned):
// the pinned harness version implements the GoalPort (claude >= 2.1.139,
// codex >= 0.133). The runtime capability stays ACP-advertised at initialize;
// this flag is the version-level declaration for surfaces without a live
// handshake.
const AGENT_SUPPORTS_GOALS = {
  claude: true,
  codex: true,
};

// Display-name curation: probe snapshots carry pretty names for some models
// and raw ids for others. When a display name has no uppercase at all we
// title-case it with a brand-aware token map (matching the existing
// "GPT-5.4-Mini" hyphenated style); provider-prefixed ids ("opencode-go/x")
// keep the prefix as a parenthetical. Names the probe cased itself pass
// through untouched.
// Explicit display overrides where prettifying alone is ambiguous (two
// "GPT-5.4" rows when the bedrock CMB models sit beside the API ones), or
// where the probe-reported name is a lowercase/hyphenated raw id.
// prettifyDisplayName() below skips any name that already contains an
// uppercase letter, so these raw probe names (all-lowercase) never get
// auto-prettified and need an explicit curated entry here.
const MODEL_DISPLAY_OVERRIDES = {
  claude: {
    "claude-fable-5": "Fable 5",
    "claude-opus-4-8": "Opus 4.8",
    "global.anthropic.claude-fable-5": "Fable 5",
  },
  codex: {
    "openai.gpt-5.4-cmb": "GPT-5.4 on Bedrock",
    "openai.gpt-5.4-cmb/xhigh": "GPT-5.4 (xhigh) on Bedrock",
    "openai.gpt-oss-120b": "GPT-OSS 120B",
    "gpt-5.6-sol": "GPT-5.6 Sol",
    "gpt-5.6-terra": "GPT-5.6 Terra",
    "gpt-5.6-luna": "GPT-5.6 Luna",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
  },
  cursor: {
    "composer-2.5": "Composer 2.5",
    "claude-opus-4-8": "Claude Opus 4.8",
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-opus-4-6": "Claude Opus 4.6",
    "claude-opus-4-5": "Claude Opus 4.5",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-sonnet-4-5": "Claude Sonnet 4.5",
    "claude-sonnet-4": "Claude Sonnet 4",
    "claude-haiku-4-5": "Claude Haiku 4.5",
    "claude-fable-5": "Claude Fable 5",
    "grok-build-0.1": "Grok Build 0.1",
    "grok-4.3": "Grok 4.3",
    "gpt-5.3-codex": "GPT-5.3 Codex",
    "gpt-5.2-codex": "GPT-5.2 Codex",
    "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
    "gpt-5.1-codex-mini": "GPT-5.1 Codex Mini",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "gpt-5.4-nano": "GPT-5.4 Nano",
    "gpt-5-mini": "GPT-5 Mini",
    "gemini-3.1-pro": "Gemini 3.1 Pro",
    "gemini-3-flash": "Gemini 3 Flash",
    "gemini-3.5-flash": "Gemini 3.5 Flash",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "kimi-k2.5": "Kimi K2.5",
  },
  grok: {
    "grok-4.20-0309-non-reasoning": "Grok 4.20 Non-Reasoning",
    "grok-4.20-0309-reasoning": "Grok 4.20 Reasoning",
    "grok-4.20-multi-agent-0309": "Grok 4.20 Multi-Agent",
    "grok-4.3": "Grok 4.3",
    "grok-build-0.1": "Grok Build 0.1",
    "grok-imagine-image": "Grok Imagine Image",
    "grok-imagine-image-quality": "Grok Imagine Image Quality",
    "grok-imagine-video": "Grok Imagine Video",
    "grok-imagine-video-1.5-preview": "Grok Imagine Video 1.5 Preview",
  },
};

const DISPLAY_TOKEN_MAP = {
  gpt: "GPT", glm: "GLM", openai: "OpenAI", claude: "Claude", opus: "Opus",
  sonnet: "Sonnet", haiku: "Haiku", codex: "Codex", gemini: "Gemini",
  grok: "Grok", composer: "Composer", deepseek: "DeepSeek", qwen: "Qwen",
  kimi: "Kimi", minimax: "MiniMax", mimo: "MiMo", nemotron: "Nemotron",
};
function prettifyToken(token) {
  if (DISPLAY_TOKEN_MAP[token]) return DISPLAY_TOKEN_MAP[token];
  if (/^[a-z]/.test(token)) return token.charAt(0).toUpperCase() + token.slice(1);
  return token;
}
function prettifyDisplayName(name) {
  if (/[A-Z]/.test(name)) return name;
  const lastSlash = name.lastIndexOf("/");
  const prefix = lastSlash === -1 ? null : name.slice(0, lastSlash);
  const subject = lastSlash === -1 ? name : name.slice(lastSlash + 1);
  const pretty = subject
    .split(" ")
    .map((word) =>
      word.startsWith("(") ? word : word.split("-").map(prettifyToken).join("-"))
    .join(" ");
  return prefix ? `${pretty} (${prefix})` : pretty;
}

// Context order = harness auth precedence (first classifier match wins the
// slot). bedrock first for claude: the flag deliberately forces the route,
// so when set it must beat an ambient API key. codex: ChatGPT login is the
// harness default when auth.json exists, even with OPENAI_API_KEY set.
const AUTH_CONTEXT_PRECEDENCE = {
  claude: ["bedrock", "anthropic-api", "anthropic-oauth"],
  codex: ["bedrock", "openai-oauth", "openai-api"],
  cursor: ["cursor-login"],
  opencode: ["anthropic-api", "openai-api", "gemini-api", "opencode-zen", "baseline"],
  grok: ["xai-api"],
};

const warnings = [];

// ---- load snapshots, grouped by agent kind --------------------------------
const snapshots = readdirSync(generatedDir)
  .filter((name) => name.endsWith(".probe.json"))
  .filter((name) => {
    if (!probeState) return true;
    const id = name.slice(0, -".probe.json".length);
    return probeState.passed.has(id);
  })
  .map((name) => ({ name, data: JSON.parse(readFileSync(join(generatedDir, name), "utf8")) }));

const byAgent = new Map();
for (const { name, data } of snapshots) {
  if (!byAgent.has(data.agentKind)) byAgent.set(data.agentKind, []);
  byAgent.get(data.agentKind).push({ name, data });
}

// ---- helpers ---------------------------------------------------------------
function selectValues(option) {
  const raw = option.options;
  if (!Array.isArray(raw)) return [];
  // Untagged enum: entries are select options ({value, name}) or groups
  // ({..., options: [...]}); flatten both shapes.
  return raw.flatMap((entry) =>
    entry?.value !== undefined ? [entry.value]
    : Array.isArray(entry?.options) ? entry.options.map((v) => v.value)
    : []);
}

function isModelOption(option) {
  return option.id === "model" || option.category === "model";
}

// Extract { controlKey: { values, default } } from one model's raw config
// options, stripping the self-referential model selector.
function matrixFrom(configOptions) {
  const matrix = {};
  for (const option of configOptions ?? []) {
    if (isModelOption(option)) continue;
    matrix[option.id] = { values: selectValues(option), observedValue: option.currentValue };
  }
  return matrix;
}

// Harnesses with floating model ids (claude: 'sonnet' = whatever Sonnet is
// today) report unversioned display names and put the version in the
// description ("Sonnet 4.6 · ..."). Lift the version into the display name so
// the catalog never shows a bare "Sonnet". Curation can still override.
function versionedDisplayName(name, description, modelId) {
  if (!name) return modelId;
  // Already versioned ("Opus 4.8", "Fable 5") — but "1M context" is not a version.
  if (/\d+\.\d+/.test(name) || /\b\d+(?!\w)/.test(name)) return name;
  const fromDescription = description?.match(/\b(\d+(?:\.\d+)+)\b/)?.[1];
  const fromId = modelId.match(/(\d+(?:[-.]\d+)*)\s*(?:\[|$)/)?.[1]?.replaceAll("-", ".");
  const version = fromDescription ?? fromId;
  if (!version) return name;
  const paren = name.indexOf(" (");
  return paren === -1
    ? `${name} ${version}`
    : `${name.slice(0, paren)} ${version}${name.slice(paren)}`;
}

// Derive a `mode` control from the legacy ACP modes block (some harnesses
// report modes there and have no config options at all).
function modesBlockMatrix(modes) {
  if (!modes?.availableModes?.length) return {};
  return {
    mode: {
      values: modes.availableModes.map((m) => m.id),
      observedValue: modes.currentModeId,
    },
  };
}

// ── variant-family normalization ────────────────────────────────────────────
// Some harnesses encode per-model options INSIDE model ids, producing variant
// rows instead of controls:
//   codex : gpt-5.5/low … gpt-5.5/xhigh        (slash + effort suffix)
//   cursor: claude-opus-4-8[thinking=true,…]   (bracket key=value params)
// Collapse each family to one base row; variant params become per-model
// control values; the launch layer re-composes variant ids via the recorded
// syntax. Slash collapse triggers ONLY when the suffix is one of the
// harness's observed effort values — opencode's provider/model ids never
// match (its baseline model has no effort control), so they pass through.

function effortValuesFromRun(run) {
  const options = run.data.baselineConfigOptions ?? [];
  const effort = options.find((o) => o.category === "thought_level" || /effort/i.test(o.id));
  return new Set(effort ? selectValues(effort) : []);
}

function parseVariant(modelId, effortValues) {
  const bracket = modelId.match(/^(.*?)\[(.*)\]$/);
  if (bracket) {
    const pairs = bracket[2] ? bracket[2].split(",") : [];
    // Only key=value params count as a variant encoding — claude's
    // sonnet[1m] context tag is part of the model id, not a param list.
    if (pairs.every((pair) => pair.includes("="))) {
      return {
        base: bracket[1],
        // split on the FIRST '=' only — values may themselves contain '='
        params: Object.fromEntries(pairs.map((pair) => {
          const eq = pair.indexOf("=");
          return [pair.slice(0, eq), pair.slice(eq + 1)];
        })),
        syntax: "bracket-params",
      };
    }
  }
  const slash = modelId.lastIndexOf("/");
  if (slash > 0) {
    const suffix = modelId.slice(slash + 1);
    if (effortValues.has(suffix)) {
      return { base: modelId.slice(0, slash), params: { reasoning_effort: suffix }, syntax: "slash-effort" };
    }
  }
  return null;
}

function commonDescription(descriptions) {
  const list = descriptions.filter(Boolean);
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  let prefix = list[0];
  for (const d of list.slice(1)) {
    while (prefix && !d.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const cut = prefix.lastIndexOf(". ");
  return cut > 0 ? prefix.slice(0, cut + 1) : list[0];
}

// → { models: [collapsed or passthrough], syntax: detected variant syntax | null }
function normalizeVariantModels(models, effortValues) {
  const families = new Map();
  const out = [];
  let syntax = null;
  for (const model of models) {
    const variant = parseVariant(model.modelId, effortValues);
    if (!variant) { out.push(model); continue; }
    syntax = variant.syntax;
    if (!families.has(variant.base)) families.set(variant.base, []);
    families.get(variant.base).push({ ...variant, model });
  }
  for (const [base, variants] of families) {
    // params → per-model control values (union of observed combos)
    const paramControls = {};
    for (const { params } of variants) {
      for (const [key, value] of Object.entries(params)) {
        (paramControls[key] ??= new Set()).add(value);
      }
    }
    const first = variants[0].model;
    const effortValues = [...(paramControls.reasoning_effort ?? [])];
    const suffixPattern = effortValues.length
      ? new RegExp("\\s*\\((" + effortValues.join("|") + ")\\)$")
      : null;
    out.push({
      modelId: base,
      name: suffixPattern ? (first.name ?? base).replace(suffixPattern, "") : (first.name ?? base),
      description: commonDescription(variants.map((v) => v.model.description)),
      configOptions: first.configOptions,
      variantParamControls: Object.fromEntries(
        Object.entries(paramControls).map(([k, v]) => [k, [...v]])),
      variantIds: variants.map((v) => v.model.modelId),
    });
  }
  return { models: out, syntax };
}

function matrixKey(matrix) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(matrix).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.values])),
  );
}

// The same model id can legitimately expose different controls per auth
// context: bedrock omits `fast_mode` and the `auto` permission mode, and a
// floating id like `default` resolves to a different underlying model per
// context (whose per-model option capture is also noisy — a context may
// truncate a value set the baseline reported in full, e.g. dropping `xhigh`).
// Collapse to the per-id superset: union the axes, then union each axis's
// values in first-seen order. Per-context gating stays expressed at the model
// level via `availability`; the harness rejects any value not valid in the
// live context. Callers still warn on divergence so a genuine regression stays
// visible in the build log rather than being silently absorbed.
function mergeMatrices(matrices) {
  const merged = {};
  for (const matrix of Object.values(matrices)) {
    for (const [axis, control] of Object.entries(matrix)) {
      const into = (merged[axis] ??= { values: [], observedValue: control.observedValue });
      for (const value of control.values) {
        if (!into.values.includes(value)) into.values.push(value);
      }
      if (into.observedValue == null) into.observedValue = control.observedValue;
    }
  }
  return merged;
}

// Preserve exact-key display curation from the bundled presentation catalog.
function applyBundledCuration(agent) {
  const previous = previousByKind.get(agent.kind);
  if (!previous) return agent;
  for (const model of agent.session.presentationModels) {
    const presentation = previous.session?.presentationModels?.find(
      (candidate) => candidate.id === model.id,
    );
    if (presentation) {
      model.displayName = presentation.displayName;
      if (presentation.description) model.description = presentation.description;
    }
  }
  if (probeState) {
    agent.harness = structuredClone(probeState.candidateByKind.get(agent.kind).harness);
  }
  return agent;
}

// ---- per-agent collation ----------------------------------------------------
const agents = [];
for (const [kind, runs] of byAgent) {
  // attestation consistency across runs
  const versions = new Set(runs.map((r) => r.data.attestation?.version ?? "unknown"));
  if (versions.size > 1) {
    throw new Error(`${kind}: runs probed different harness versions: ${[...versions].join(", ")} — re-probe on one version`);
  }
  const attestation = runs[0].data.attestation ?? null;

  // observation table: modelId -> { name, description, observedIn[], matrices,
  //   onMenu }. Menu observations and accepted trials can contribute exact-key
  //   presentation labels, but neither becomes catalog execution authority.
  const observed = new Map();
  const note = (modelId, fields) => {
    if (!observed.has(modelId)) {
      observed.set(modelId, { name: modelId, description: undefined, observedIn: [], matrices: {}, onMenu: false });
    }
    const entry = observed.get(modelId);
    if (fields.name) entry.name = fields.name;
    if (fields.description) entry.description = fields.description;
    if (fields.onMenu) entry.onMenu = true;
    entry.observedIn.push(fields.observedIn);
    if (fields.matrix) entry.matrices[fields.matrixKey] = fields.matrix;
    if (fields.variants) entry.variants = [...new Set([...(entry.variants ?? []), ...fields.variants])];
    return entry;
  };
  let variantSyntax = null;
  for (const run of runs) {
    const ctx = run.data.authContext;
    // Harnesses that never re-emit config options on model switch (e.g.
    // cursor) leave per-model captures null — fall back to the session
    // baseline options, then to the legacy modes block, so uniform controls
    // (e.g. cursor's agent/plan/ask modes) still reach the catalog.
    const fallback = run.data.baselineConfigOptions
      ? matrixFrom(run.data.baselineConfigOptions)
      : modesBlockMatrix(run.data.modes);
    const fallbackMatrix = Object.keys(fallback).length ? fallback : undefined;
    const normalized = normalizeVariantModels(run.data.models, effortValuesFromRun(run));
    if (normalized.syntax) variantSyntax = normalized.syntax;
    for (const model of normalized.models) {
      const matrix = model.configOptions ? matrixFrom(model.configOptions) : fallbackMatrix;
      // variant params become control values; the config-option control of
      // the same axis (codex reasoning_effort) wins when both exist
      const merged = { ...(matrix ?? {}) };
      for (const [key, values] of Object.entries(model.variantParamControls ?? {})) {
        if (!merged[key]) merged[key] = { values };
      }
      note(model.modelId, {
        name: model.name,
        description: model.description,
        onMenu: true,
        observedIn: `${kind}.${ctx}`,
        matrix: Object.keys(merged).length ? merged : undefined,
        matrixKey: ctx,
        variants: model.variantIds,
      });
    }
    for (const trial of run.data.trials ?? []) {
      if (!trial.accepted) continue;
      note(trial.modelId, {
        name: trial.name,
        observedIn: `${kind}.${ctx}`,
        matrix: trial.configOptions ? matrixFrom(trial.configOptions) : undefined,
        matrixKey: `${ctx}#trial`,
      });
    }
  }

  const presentationModels = [...observed.entries()].map(([modelId, entry]) => ({
    id: modelId,
    displayName:
      MODEL_DISPLAY_OVERRIDES[kind]?.[modelId] ??
      prettifyDisplayName(versionedDisplayName(entry.name, entry.description, modelId)),
    ...(entry.description ? { description: entry.description } : {}),
  }));

  const nativeVersions = new Set(runs.map((r) => r.data.nativeCli?.version).filter(Boolean));
  if (nativeVersions.size > 1) {
    throw new Error(`${kind}: runs used different native CLI versions: ${[...nativeVersions].join(", ")}`);
  }
  const nativeVersion = [...nativeVersions][0];
  agents.push(applyBundledCuration({
    kind,
    displayName: AGENT_DISPLAY_NAMES[kind] ?? kind,
    harness: {
      agentProcess: { version: attestation?.version ?? "unknown" },
      ...(nativeVersion ? { native: { version: nativeVersion } } : {}),
    },
    authContexts: [...runs]
      .sort((a, b) => {
        const order = AUTH_CONTEXT_PRECEDENCE[kind] ?? [];
        const rank = (run) => {
          const index = order.indexOf(run.data.authContext);
          return index === -1 ? order.length : index;
        };
        return rank(a) - rank(b);
      })
      .map((run) => ({
        id: run.data.authContext,
        ...(run.data.authContext === "baseline"
          ? {}
          : {
              authSlotId:
                AUTH_CONTEXT_SLOTS[kind]?.[run.data.authContext] ?? run.data.authContext,
            }),
        ...(AUTH_CONTEXT_SIGNALS[kind]?.[run.data.authContext]
          ? { signals: AUTH_CONTEXT_SIGNALS[kind][run.data.authContext] }
          : {}),
      })),
    session: {
      supportsGoals: AGENT_SUPPORTS_GOALS[kind] ?? false,
      presentationModels,
    },
    provenance: {
      probedAt: runs.map((r) => r.data.probedAt).sort().at(-1),
      attestation,
      runs: runs.map((r) => ({ id: `${kind}.${r.data.authContext}`, snapshotPath: `generated/${r.name}` })),
    },
  }));
}

if (probeState) {
  for (const previous of previousCatalog?.agents ?? []) {
    if (!probeState.activeAgents.has(previous.kind)) {
      agents.push(structuredClone(previous));
    }
  }
}

// Pair the catalog with the registry it was probed against (catalog owns
// WHICH versions; registry owns HOW — see catalog-v2 spec).
const registryPath = join(here, "..", "..", "catalogs", "agents", "registry.json");
let registryVersion = null; // registry.json lands with PR #607; pairing activates then
try { registryVersion = JSON.parse(readFileSync(registryPath, "utf8")).registryVersion; } catch {}

// Monotonic catalogVersion: bump the same-day revision counter.
const today = new Date().toISOString().slice(0, 10);
let revision = 1;
try {
  const previous = JSON.parse(readFileSync(outPath, "utf8")).catalogVersion;
  const [prevDay, prevRev] = previous.split(".");
  if (prevDay === today) revision = Number(prevRev) + 1;
} catch { /* no previous draft */ }

const catalog = {
  schemaVersion: 2,
  catalogVersion: `${today}.${revision}`,
  probedAgainst: { registryVersion },
  generatedAt: new Date().toISOString(),
  agents: agents.sort((a, b) => a.kind.localeCompare(b.kind)),
};

writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n");
console.log(`wrote ${outPath}`);
console.log(`agents: ${catalog.agents.map((a) => `${a.kind}(${a.session.presentationModels.length} presentation models)`).join(", ")}`);
for (const warning of warnings) console.log(`warning: ${warning}`);
