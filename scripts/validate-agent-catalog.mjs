#!/usr/bin/env node
// Fast structural tripwire for the distribution/presentation catalog.
// Executable launch membership must live only in target-observed state.

import fs from "node:fs";
import path from "node:path";

const CATALOG_PATH = path.resolve("catalogs/agents/catalog.json");
const DRAFT_PATH = path.resolve("scripts/agent-catalog/catalog.draft.json");
const REGISTRY_PATH = path.resolve("catalogs/agents/registry.json");
const VALID_AGENT_KINDS = new Set(["claude", "codex", "cursor", "opencode", "grok"]);
const VALID_AUTH_CARDINALITIES = new Set(["single", "multi"]);
const FORBIDDEN_AGENT_KEYS = new Set(["settings"]);
const FORBIDDEN_SESSION_KEYS = new Set([
  "unattendedModeId",
  "controls",
  "models",
  "defaults",
  "observedDefaults",
  "gatewayPolicy",
]);
const errors = [];
const fail = (message) => errors.push(message);

function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 2) fail("schemaVersion must be 2");
  if (typeof catalog.catalogVersion !== "string" || !catalog.catalogVersion.trim()) {
    fail("catalogVersion must be a non-empty string");
  }
  if (Object.hasOwn(catalog, "defaultAgentKind")) {
    fail("defaultAgentKind is executable policy and must not exist in the catalog");
  }
  if (!Array.isArray(catalog.agents) || catalog.agents.length === 0) {
    fail("agents must be a non-empty array");
    return;
  }

  const seenKinds = new Set();
  for (const agent of catalog.agents) {
    const kind = agent.kind;
    if (!VALID_AGENT_KINDS.has(kind)) fail(`agent kind '${kind}' is not supported`);
    if (seenKinds.has(kind)) fail(`agent '${kind}' is duplicated`);
    seenKinds.add(kind);
    if (typeof agent.displayName !== "string" || !agent.displayName.trim()) {
      fail(`${kind}: displayName must be a non-empty string`);
    }
    if (typeof agent.harness?.agentProcess?.version !== "string" || !agent.harness.agentProcess.version.trim()) {
      fail(`${kind}: harness.agentProcess.version must be a non-empty string`);
    }
    for (const key of FORBIDDEN_AGENT_KEYS) {
      if (Object.hasOwn(agent, key)) fail(`${kind}: forbidden executable field '${key}'`);
    }
    for (const key of FORBIDDEN_SESSION_KEYS) {
      if (Object.hasOwn(agent.session ?? {}, key)) {
        fail(`${kind}: forbidden executable session field '${key}'`);
      }
    }
    if (agent.session?.supportsGoals !== undefined && typeof agent.session.supportsGoals !== "boolean") {
      fail(`${kind}: session.supportsGoals must be boolean when present`);
    }

    const contextIds = new Set();
    for (const context of agent.authContexts ?? []) {
      if (typeof context.id !== "string" || !context.id.trim()) {
        fail(`${kind}: auth context with empty id`);
      } else if (contextIds.has(context.id)) {
        fail(`${kind}: auth context '${context.id}' is duplicated`);
      }
      contextIds.add(context.id);
      if (context.id !== "baseline" && (typeof context.authSlotId !== "string" || !context.authSlotId.trim())) {
        fail(`${kind}: auth context '${context.id}' must reference an auth slot`);
      }
    }

    const presentationIds = new Set();
    for (const model of agent.session?.presentationModels ?? []) {
      if (typeof model.id !== "string" || !model.id.trim()) {
        fail(`${kind}: presentation model with empty id`);
        continue;
      }
      if (presentationIds.has(model.id)) fail(`${kind}: presentation model '${model.id}' is duplicated`);
      presentationIds.add(model.id);
      if (typeof model.displayName !== "string" || !model.displayName.trim()) {
        fail(`${kind}.${model.id}: presentation displayName must be a non-empty string`);
      }
      const keys = Object.keys(model);
      if (keys.some((key) => !["id", "displayName", "description"].includes(key))) {
        fail(`${kind}.${model.id}: presentation model contains executable metadata`);
      }
    }
  }
}

function validateRegistryPairing(catalog, registry) {
  if (typeof registry.registryVersion !== "string" || !registry.registryVersion.trim()) {
    fail("registryVersion must be a non-empty string");
  }
  if (catalog.probedAgainst?.registryVersion !== registry.registryVersion) {
    fail(
      `catalog probedAgainst.registryVersion '${catalog.probedAgainst?.registryVersion}' `
      + `does not match registryVersion '${registry.registryVersion}'`,
    );
  }
  const registryAgents = new Map((registry.agents ?? []).map((agent) => [agent.kind, agent]));
  for (const agent of catalog.agents ?? []) {
    if (!registryAgents.has(agent.kind)) fail(`catalog agent '${agent.kind}' is not in the registry`);
  }
}

function validateRegistryAuthority(registry) {
  for (const agent of registry.agents ?? []) {
    if (!VALID_AUTH_CARDINALITIES.has(agent.authCardinality)) {
      fail(`registry agent '${agent.kind}' has invalid authCardinality '${agent.authCardinality}'`);
    }
    const hasGatewaySlot = (agent.auth?.slots ?? []).some((slot) => slot.id === "gateway");
    if (agent.authCardinality === "multi" && !hasGatewaySlot) {
      fail(`registry agent '${agent.kind}' is multi-source but declares no gateway slot`);
    }
  }
}

function versionCore(value) {
  return typeof value === "string" ? value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] : undefined;
}

function validateSnapshotEvidence(catalog) {
  for (const agent of catalog.agents ?? []) {
    const processVersion = agent.harness?.agentProcess?.version;
    const processSourceKind = agent.harness?.agentProcess?.source?.kind;
    const immutableUnattestedSource = processSourceKind === "archive" || processSourceKind === "npm";
    const nativeVersion = versionCore(agent.harness?.native?.version);
    const runs = agent.provenance?.runs;
    if (!Array.isArray(runs) || runs.length === 0) {
      fail(`${agent.kind}: provenance.runs must contain committed probe evidence`);
      continue;
    }
    for (const run of runs) {
      const snapshotPath = run?.snapshotPath;
      if (typeof snapshotPath !== "string" || !snapshotPath.trim()) {
        fail(`${agent.kind}: provenance run '${run?.id}' has no snapshotPath`);
        continue;
      }
      const absoluteSnapshotPath = path.resolve("scripts/agent-catalog", snapshotPath);
      if (!fs.existsSync(absoluteSnapshotPath)) {
        fail(`${agent.kind}: probe snapshot '${snapshotPath}' does not exist`);
        continue;
      }
      let snapshot;
      try {
        snapshot = JSON.parse(fs.readFileSync(absoluteSnapshotPath, "utf8"));
      } catch (error) {
        fail(`${agent.kind}: probe snapshot '${snapshotPath}' is invalid JSON: ${error.message}`);
        continue;
      }
      if (snapshot.agentKind !== agent.kind) {
        fail(`${agent.kind}: probe snapshot '${snapshotPath}' declares '${snapshot.agentKind}'`);
      }
      const attestedVersion = snapshot.attestation?.version;
      if (typeof attestedVersion === "string" && attestedVersion.trim()) {
        if (attestedVersion !== processVersion) {
          fail(`${agent.kind}: probe snapshot '${snapshotPath}' attests '${attestedVersion}', expected '${processVersion}'`);
        }
      } else if (!immutableUnattestedSource) {
        fail(`${agent.kind}: probe snapshot '${snapshotPath}' lacks process attestation`);
      }
      if (nativeVersion && versionCore(snapshot.nativeCli?.version) !== nativeVersion) {
        fail(`${agent.kind}: probe snapshot '${snapshotPath}' native version does not match its pin`);
      }
    }
  }
}

const catalogRaw = fs.readFileSync(CATALOG_PATH, "utf8");
const draftRaw = fs.readFileSync(DRAFT_PATH, "utf8");
if (catalogRaw !== draftRaw) fail("catalog.draft.json must exactly match catalog.json");
const catalog = JSON.parse(catalogRaw);
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
validateCatalog(catalog);
validateRegistryPairing(catalog, registry);
validateRegistryAuthority(registry);
validateSnapshotEvidence(catalog);

if (errors.length > 0) {
  for (const message of errors) console.error(`agent catalog validation failed: ${message}`);
  process.exit(1);
}
console.log(`agent catalog OK: ${catalog.catalogVersion} (${catalog.agents.length} agents)`);
