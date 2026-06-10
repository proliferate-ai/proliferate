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

const AGENT_DISPLAY_NAMES = { claude: "Claude", codex: "Codex", gemini: "Gemini", cursor: "Cursor", opencode: "OpenCode" };
// Which registry auth slot satisfies each probe auth context (curation-owned).
const AUTH_CONTEXT_SLOTS = { "anthropic-api": "anthropic" };

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

// Derive a `mode` control from the legacy ACP modes block (harnesses like
// gemini report modes there and have no config options at all).
function modesBlockMatrix(modes) {
  if (!modes?.availableModes?.length) return {};
  return {
    mode: {
      values: modes.availableModes.map((m) => m.id),
      observedValue: modes.currentModeId,
    },
  };
}

function matrixKey(matrix) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(matrix).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.values])),
  );
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
    return entry;
  };
  for (const run of runs) {
    const ctx = run.data.authContext;
    // Harnesses that never re-emit config options on model switch (cursor,
    // gemini) leave per-model captures null — fall back to the session
    // baseline options, then to the legacy modes block, so uniform controls
    // (e.g. cursor's agent/plan/ask modes) still reach the catalog.
    const fallback = run.data.baselineConfigOptions
      ? matrixFrom(run.data.baselineConfigOptions)
      : modesBlockMatrix(run.data.modes);
    const fallbackMatrix = Object.keys(fallback).length ? fallback : undefined;
    for (const model of run.data.models) {
      note(model.modelId, {
        name: model.name,
        description: model.description,
        onMenu: true,
        observedIn: `${kind}.${ctx}`,
        matrix: model.configOptions ? matrixFrom(model.configOptions) : fallbackMatrix,
        matrixKey: ctx,
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

  // invariant [e]: same id across contexts must report the same (stripped) matrix
  for (const [modelId, entry] of observed) {
    const keys = new Set(Object.values(entry.matrices).map(matrixKey));
    if (keys.size > 1) {
      throw new Error(`${kind}/${modelId}: option matrix differs across auth contexts — split ids or investigate:\n${JSON.stringify(entry.matrices, null, 2)}`);
    }
  }

  const probedContexts = runs.map((r) => r.data.authContext);
  const models = [...observed.entries()].map(([modelId, entry]) => {
    const matrix = Object.values(entry.matrices)[0] ?? {};
    // Observed-set semantics: exactly the contexts that saw this model.
    // 'baseline' is a first-class context; no always/anyOf inference.
    const contexts = [...new Set(entry.observedIn.map((r) => r.split(".").slice(1).join(".")))];
    return {
      id: modelId,
      displayName: versionedDisplayName(entry.name, entry.description, modelId),
      ...(entry.description ? { description: entry.description } : {}),
      availability: { anyOf: contexts },
      // On a harness menu somewhere -> advertised; trial-only -> available
      // but hidden unless curation opts it in.
      defaultVisible: entry.onMenu,
      controls: matrix,
      status: "active",
      provenance: {
        observedIn: [...new Set(entry.observedIn)],
        observedInAllContexts: contexts.length === probedContexts.length,
        viaTrialOnly: !entry.onMenu,
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
    { key: "model", mapping: { createField: "modelId", switchVia, liveConfigId: "model" } },
    ...Object.entries(universe).map(([key, values]) => ({ key, values: [...values] })),
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
    authContexts: runs.map((run) => ({
      id: run.data.authContext,
      ...(run.data.authContext === "baseline"
        ? {}
        : { authSlotId: AUTH_CONTEXT_SLOTS[run.data.authContext] ?? run.data.authContext }),
    })),
    session: { controls, models, observedDefaults },
    provenance: {
      probedAt: runs.map((r) => r.data.probedAt).sort().at(-1),
      attestation,
      runs: runs.map((r) => ({ id: `${kind}.${r.data.authContext}`, snapshotPath: `generated/${r.name}` })),
    },
  });
}

// Pair the catalog with the registry it was probed against (catalog owns
// WHICH versions; registry owns HOW — see catalog-v2 spec).
const registryPath = join(here, "..", "..", "catalogs", "agents", "v1", "registry.json");
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
