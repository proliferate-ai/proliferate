#!/usr/bin/env node
// Collate raw probe snapshots (generated/*.probe.json) into a single
// catalog-v2 draft. Probe owns facts (ids, names, matrices, availability);
// curation owns taste (display overrides, visibility) — curation hooks are
// stubbed here and applied last.
//
// Core rules implemented (see catalog-v2 schema spec):
//  - availability = OBSERVED SET: exactly the contexts (incl. 'baseline')
//    whose runs contained the model. No inference — availability is not
//    monotone (credentials can REMOVE models; proven by OpenCode free tier).
//  - per-model matrices: strip self-referential model option, then assert
//    matrix equality across contexts for the same model id (invariant [e])
//  - controls universe = union of per-model control keys/values, plus a
//    values-less `model` mapping control recording switchVia
//  - probe emits observedDefaults/observedValue; `defaults`/`default` are
//    curation-owned and not fabricated here

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = join(here, "generated");
const outPath = join(here, "catalog.draft.json");

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
    "bedrock": { allOf: [{ envFlag: "CLAUDE_CODE_USE_BEDROCK=1" }, { discovery: "aws-credential-chain" }] },
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

// Curated per-context launch defaults (session.defaults): the classifier's
// winning context picks its default; the runtime default ladder still
// requires the model to be AVAILABLE under the active contexts, so a stale
// entry degrades to the first-visible fallback instead of failing.
const AGENT_SESSION_DEFAULTS = {
  claude: {
    "anthropic-api": "sonnet",
    "anthropic-oauth": "opus",
    "bedrock": "us.anthropic.claude-sonnet-4-6",
  },
  codex: {
    "openai-api": "gpt-5.5",
    "openai-oauth": "gpt-5.5",
    "bedrock": "openai.gpt-5.5",
  },
  cursor: { "cursor-login": "default" },
  opencode: { "baseline": "opencode/big-pickle" },
  grok: { "xai-api": "grok-4.20-0309-non-reasoning" },
};

// Display-name curation: probe snapshots carry pretty names for some models
// and raw ids for others. When a display name has no uppercase at all we
// title-case it with a brand-aware token map (matching the existing
// "GPT-5.4-Mini" hyphenated style); provider-prefixed ids ("opencode-go/x")
// keep the prefix as a parenthetical. Names the probe cased itself pass
// through untouched.
// Application paths for non-model session controls (curation, carried over
// from the v1 catalog's hand-curated apply blocks): which create field or
// live config id applies each control. A control WITHOUT a mapping is a
// probe-observed matrix dimension only (e.g. cursor's bracket-param
// effort/reasoning/thinking/context) — real data, but nothing the desktop
// can apply, so consumers must not project it as a composer control.
const CONTROL_MAPPINGS = {
  claude: {
    mode: { createField: "modeId", liveConfigId: "mode" },
    effort: { liveConfigId: "effort" },
    fast_mode: { liveConfigId: "fast_mode" },
  },
  codex: {
    mode: { createField: "modeId", liveConfigId: "mode" },
    collaboration_mode: { liveConfigId: "collaboration_mode" },
    reasoning_effort: { liveConfigId: "reasoning_effort" },
    fast_mode: { liveConfigId: "fast_mode" },
  },
  cursor: { mode: { createField: "modeId", liveConfigId: "mode" } },
  opencode: { mode: { createField: "modeId", liveConfigId: "mode" } },
  grok: { mode: { createField: "modeId", liveConfigId: "mode" } },
};

// Visibility policy: every PROVEN model (harness menu or accepted trial)
// is advertised by default — trial-proven models appear without waiting
// for a curation PR. Opt-outs exist only to suppress duplicate ids for
// the same underlying model. Availability itself is never curated — only
// the probe can prove a model launches.
const MODEL_VISIBILITY_OPT_OUTS = {
  claude: [
    // Only opt out GENUINE same-context duplicates. The bare current-gen ids
    // (claude-fable-5, claude-opus-4-8) are oauth/api-only — never gateway-
    // reachable — so they are NOT duplicates of the us.anthropic.* Bedrock
    // entries and must stay visible on the native/api surfaces (that's the
    // only form of those models an OAuth/API login can use). Only the
    // global-region id duplicates its us.anthropic.* sibling WITHIN the
    // bedrock context, so it alone stays opted out.
    "global.anthropic.claude-fable-5",
  ],
  grok: [
    // image/video generation models — not coding models, hidden from the picker
    "grok-imagine-image",
    "grok-imagine-image-quality",
    "grok-imagine-video",
    "grok-imagine-video-1.5-preview",
  ],
};

// Explicit display overrides where prettifying alone is ambiguous (two
// "GPT-5.4" rows when the bedrock CMB models sit beside the API ones).
const MODEL_DISPLAY_OVERRIDES = {
  claude: {
    "claude-fable-5": "Fable 5",
    "claude-opus-4-8": "Opus 4.8",
    "global.anthropic.claude-fable-5": "Fable 5",
  },
  codex: {
    "openai.gpt-5.4-cmb": "GPT-5.4 on Bedrock",
    "openai.gpt-5.4-cmb/xhigh": "GPT-5.4 (xhigh) on Bedrock",
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
  //   onMenu } — menu observations set defaultVisible; accepted trials add
  //   available-but-hidden rows (observed via a real inference turn).
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

  // invariant [e] (relaxed to a superset merge — see mergeMatrices): the same
  // id may report different controls across auth contexts. Merge to the per-id
  // superset rather than reject, but warn when contexts diverge so a real
  // capability regression stays visible instead of being silently absorbed.
  for (const [modelId, entry] of observed) {
    const keys = new Set(Object.values(entry.matrices).map(matrixKey));
    if (keys.size > 1) {
      console.warn(`⚠ ${kind}/${modelId}: controls differ across auth contexts — merging to superset:`);
      for (const [ctx, matrix] of Object.entries(entry.matrices)) {
        console.warn(`    ${ctx}: ${matrixKey(matrix)}`);
      }
    }
    entry.mergedMatrix = mergeMatrices(entry.matrices);
  }

  const probedContexts = runs.map((r) => r.data.authContext);
  const models = [...observed.entries()].map(([modelId, entry]) => {
    const matrix = entry.mergedMatrix ?? {};
    // Observed-set semantics: exactly the contexts that saw this model.
    // 'baseline' is a first-class context; no always/anyOf inference.
    const contexts = [...new Set(entry.observedIn.map((r) => r.split(".").slice(1).join(".")))];
    return {
      id: modelId,
      displayName:
        MODEL_DISPLAY_OVERRIDES[kind]?.[modelId] ??
        prettifyDisplayName(versionedDisplayName(entry.name, entry.description, modelId)),
      ...(entry.description ? { description: entry.description } : {}),
      availability: { anyOf: contexts },
      // On a harness menu somewhere -> advertised; trial-only -> available
      // but hidden unless curation opts it in.
      defaultVisible: !(MODEL_VISIBILITY_OPT_OUTS[kind] ?? []).includes(modelId),
      controls: matrix,
      status: "active",
      provenance: {
        observedIn: [...new Set(entry.observedIn)],
        observedInAllContexts: contexts.length === probedContexts.length,
        viaTrialOnly: !entry.onMenu,
        ...(entry.variants ? { variantIds: entry.variants } : {}),
      },
    };
  });

  // controls universe = union of per-model keys/values, plus the values-less
  // `model` mapping control (how the runtime switches models on this harness,
  // discovered by the probe via modelSource)
  const universe = {};
  for (const model of models) {
    for (const [key, control] of Object.entries(model.controls)) {
      universe[key] ??= new Set();
      for (const value of control.values) universe[key].add(value);
    }
  }
  const switchVia = runs[0].data.modelSource === "modelConfigOption" ? "configOption" : "setSessionModel";
  const controls = [
    { key: "model", mapping: {
        createField: "modelId", switchVia, liveConfigId: "model",
        ...(variantSyntax ? { variantSyntax } : {}),
    } },
    ...Object.entries(universe).map(([key, values]) => ({
      key,
      values: [...values],
      ...(CONTROL_MAPPINGS[kind]?.[key]
        ? { mapping: CONTROL_MAPPINGS[kind][key] }
        : {}),
    })),
  ];

  // observedDefaults per auth context: the model the harness had selected at
  // session start (probe-owned input for curation; `defaults` is curation-owned)
  const observedDefaults = {};
  for (const run of runs) {
    const current = run.data.currentModelId
      ?? run.data.baselineConfigOptions?.find?.(isModelOption)?.currentValue
      ?? null;
    if (current) observedDefaults[run.data.authContext] = current;
  }

  const nativeVersions = new Set(runs.map((r) => r.data.nativeCli?.version).filter(Boolean));
  if (nativeVersions.size > 1) {
    throw new Error(`${kind}: runs used different native CLI versions: ${[...nativeVersions].join(", ")}`);
  }
  const nativeVersion = [...nativeVersions][0];
  agents.push({
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
    session: { controls, models, defaults: AGENT_SESSION_DEFAULTS[kind] ?? {}, observedDefaults },
    provenance: {
      probedAt: runs.map((r) => r.data.probedAt).sort().at(-1),
      attestation,
      runs: runs.map((r) => ({ id: `${kind}.${r.data.authContext}`, snapshotPath: `generated/${r.name}` })),
    },
  });
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
console.log(`agents: ${catalog.agents.map((a) => `${a.kind}(${a.session.models.length} models)`).join(", ")}`);
for (const warning of warnings) console.log(`warning: ${warning}`);
