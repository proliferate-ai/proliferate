#!/usr/bin/env node
// CI tripwire for the agent catalog (schemaVersion 2) + registry documents.
// The authoritative validator is the Rust one
// (anyharness-lib/src/domains/agents/catalog/validation.rs, enforced by
// `cargo test` against the bundled document); this script mirrors the key
// structural invariants so server CI fails fast on a bad checked-in doc
// without a Rust toolchain.

import fs from "node:fs";
import path from "node:path";

const CATALOG_PATH = path.resolve("catalogs/agents/catalog.json");
const REGISTRY_PATH = path.resolve("catalogs/agents/registry.json");
const VALID_AGENT_KINDS = new Set(["claude", "codex", "cursor", "opencode", "grok"]);
const VALID_STATUSES = new Set(["candidate", "active", "deprecated", "hidden"]);
const VALID_SETTING_TYPES = new Set(["boolean"]);
const VALID_SETTING_SURFACES = new Set(["local", "cloud"]);
const VALID_SETTING_MAPPING_KINDS = new Set(["cli_flag", "env"]);
const BASELINE_CONTEXT_ID = "baseline";
// The gateway auth context is route-engaged (its models/default are resolved by
// the runtime gateway probe, not authored as catalog model rows), so its default
// legitimately names a gateway-served model that is not a `session.models` entry.
const GATEWAY_CONTEXT_ID = "gateway";

const errors = [];
const fail = (message) => errors.push(message);

function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 2) fail("schemaVersion must be 2");
  if (typeof catalog.catalogVersion !== "string" || !catalog.catalogVersion.trim()) {
    fail("catalogVersion must be a non-empty string");
  }
  if (!Array.isArray(catalog.agents) || catalog.agents.length === 0) {
    fail("agents must be a non-empty array");
    return;
  }

  const seenKinds = new Set();

  // defaultAgentKind is optional; when present it must name a declared agent.
  if (catalog.defaultAgentKind !== undefined) {
    if (typeof catalog.defaultAgentKind !== "string" || !catalog.defaultAgentKind.trim()) {
      fail("defaultAgentKind must be a non-empty string when present");
    }
  }

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

    const contextIds = new Set();
    for (const context of agent.authContexts ?? []) {
      if (typeof context.id !== "string" || !context.id.trim()) {
        fail(`${kind}: auth context with empty id`);
        continue;
      }
      if (contextIds.has(context.id)) fail(`${kind}: auth context '${context.id}' is duplicated`);
      contextIds.add(context.id);
      if (context.id !== BASELINE_CONTEXT_ID && (typeof context.authSlotId !== "string" || !context.authSlotId.trim())) {
        fail(`${kind}: auth context '${context.id}' must reference an auth slot`);
      }
    }

    if (
      agent.session?.supportsGoals !== undefined &&
      typeof agent.session.supportsGoals !== "boolean"
    ) {
      fail(`${kind}: session.supportsGoals must be boolean when present`);
    }

    const models = agent.session?.models;
    if (!Array.isArray(models) || models.length === 0) {
      fail(`${kind}: session.models must be a non-empty array`);
      continue;
    }
    const modelIds = new Set();
    // Gateway-tagged rows: ids whose availability unlocks under the gateway
    // route. The seedModels invariant (decisions ledger 14) checks against this.
    const gatewayRowIds = new Set();
    for (const model of models) {
      const id = model.id;
      if (typeof id !== "string" || !id.trim()) {
        fail(`${kind}: model with empty id`);
        continue;
      }
      if (modelIds.has(id)) fail(`${kind}: model '${id}' is duplicated`);
      modelIds.add(id);
      if (Array.isArray(model.availability?.anyOf) && model.availability.anyOf.includes(GATEWAY_CONTEXT_ID)) {
        gatewayRowIds.add(id);
      }
      if (typeof model.displayName !== "string" || !model.displayName.trim()) {
        fail(`${kind}.${id}: displayName must be a non-empty string`);
      }
      if (!VALID_STATUSES.has(model.status)) {
        fail(`${kind}.${id}: status '${model.status}' is invalid`);
      }
      if (typeof model.defaultVisible !== "boolean") {
        fail(`${kind}.${id}: defaultVisible must be boolean`);
      }
      const anyOf = model.availability?.anyOf;
      if (!Array.isArray(anyOf) || anyOf.length === 0) {
        fail(`${kind}.${id}: availability.anyOf must be a non-empty array`);
      } else {
        for (const contextId of anyOf) {
          if (!contextIds.has(contextId)) {
            fail(`${kind}.${id}: availability references unknown auth context '${contextId}'`);
          }
        }
      }
    }

    for (const [contextId, modelId] of Object.entries(agent.session?.defaults ?? {})) {
      if (!contextIds.has(contextId)) {
        fail(`${kind}: defaults references unknown auth context '${contextId}'`);
      }
      // Gateway defaults resolve against probe-supplied gateway models, so they
      // are not required to be authored `session.models` rows.
      if (contextId !== GATEWAY_CONTEXT_ID && !modelIds.has(modelId)) {
        fail(`${kind}: defaults['${contextId}'] references unknown model '${modelId}'`);
      }
    }

    validateGatewayPolicy(kind, agent.session?.gatewayPolicy, gatewayRowIds);
    validateAgentSettings(kind, agent.settings);
  }

  // Cross-reference: defaultAgentKind must name a declared agent.
  if (typeof catalog.defaultAgentKind === "string" && catalog.defaultAgentKind.trim()) {
    if (!seenKinds.has(catalog.defaultAgentKind)) {
      fail(`defaultAgentKind '${catalog.defaultAgentKind}' is not a declared agent`);
    }
  }
}

// The per-harness gateway curation block (schemaVersion 2): providers is the
// compat group (empty/omitted = all providers), roles pins model-role ids
// (e.g. small_fast) that used to live in Rust consts, seedModels is the
// pre-probe fallback model list. All optional; validated structurally only.
function validateGatewayPolicy(kind, gatewayPolicy, gatewayRowIds) {
  if (gatewayPolicy === undefined) return;
  if (typeof gatewayPolicy !== "object" || gatewayPolicy === null || Array.isArray(gatewayPolicy)) {
    fail(`${kind}: gatewayPolicy must be an object`);
    return;
  }
  const stringArray = (value, field) => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
      fail(`${kind}: gatewayPolicy.${field} must be an array of non-empty strings`);
    }
  };
  stringArray(gatewayPolicy.providers, "providers");
  stringArray(gatewayPolicy.seedModels, "seedModels");
  // Build invariant (decisions ledger 14): every seedModel must be a
  // first-class session.models row tagged with gateway availability.
  if (Array.isArray(gatewayPolicy.seedModels)) {
    for (const seed of gatewayPolicy.seedModels) {
      if (typeof seed === "string" && seed.trim() && !gatewayRowIds.has(seed)) {
        fail(`${kind}: gatewayPolicy.seedModels entry '${seed}' has no session.models row tagged with gateway availability`);
      }
    }
  }
  if (gatewayPolicy.roles !== undefined) {
    const roles = gatewayPolicy.roles;
    if (typeof roles !== "object" || roles === null || Array.isArray(roles)) {
      fail(`${kind}: gatewayPolicy.roles must be an object`);
    } else {
      for (const [role, modelId] of Object.entries(roles)) {
        if (typeof modelId !== "string" || !modelId.trim()) {
          fail(`${kind}: gatewayPolicy.roles['${role}'] must be a non-empty string`);
        }
      }
    }
  }
}

function validateAgentSettings(kind, settings) {
  if (settings === undefined || settings === null) return;
  if (!Array.isArray(settings)) {
    fail(`${kind}: settings must be an array`);
    return;
  }
  const seenKeys = new Set();
  for (const setting of settings) {
    if (typeof setting.key !== "string" || !setting.key.trim()) {
      fail(`${kind}: setting with empty key`);
      continue;
    }
    if (seenKeys.has(setting.key)) {
      fail(`${kind}: setting key '${setting.key}' is duplicated`);
    }
    seenKeys.add(setting.key);
    if (!VALID_SETTING_TYPES.has(setting.type)) {
      fail(`${kind}.settings.${setting.key}: type '${setting.type}' is not supported (must be one of: ${[...VALID_SETTING_TYPES].join(", ")})`);
    }
    if (typeof setting.label !== "string" || !setting.label.trim()) {
      fail(`${kind}.settings.${setting.key}: label must be a non-empty string`);
    }
    if (!Array.isArray(setting.surfaces) || setting.surfaces.length === 0) {
      fail(`${kind}.settings.${setting.key}: surfaces must be a non-empty array`);
    } else {
      for (const surface of setting.surfaces) {
        if (!VALID_SETTING_SURFACES.has(surface)) {
          fail(`${kind}.settings.${setting.key}: surface '${surface}' is not valid (must be one of: ${[...VALID_SETTING_SURFACES].join(", ")})`);
        }
      }
    }
    if (typeof setting.mapping !== "object" || setting.mapping === null || Array.isArray(setting.mapping)) {
      fail(`${kind}.settings.${setting.key}: mapping must be an object`);
    } else {
      if (!VALID_SETTING_MAPPING_KINDS.has(setting.mapping.kind)) {
        fail(`${kind}.settings.${setting.key}: mapping.kind '${setting.mapping.kind}' is not supported (must be one of: ${[...VALID_SETTING_MAPPING_KINDS].join(", ")})`);
      }
      if (setting.mapping.kind === "cli_flag") {
        if (typeof setting.mapping.flag !== "string" || !setting.mapping.flag.trim()) {
          fail(`${kind}.settings.${setting.key}: mapping.flag must be a non-empty string for cli_flag mapping`);
        }
      }
      if (setting.mapping.kind === "env") {
        if (typeof setting.mapping.env !== "string" || !setting.mapping.env.trim()) {
          fail(`${kind}.settings.${setting.key}: mapping.env must be a non-empty string for env mapping`);
        }
      }
    }
  }
}

function validateRegistryPairing(catalog, registry) {
  const registryAgents = new Map((registry.agents ?? []).map((agent) => [agent.kind, agent]));
  for (const agent of catalog.agents ?? []) {
    if (!registryAgents.has(agent.kind)) {
      fail(`catalog agent '${agent.kind}' is not in the registry`);
    }
  }
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
validateCatalog(catalog);
validateRegistryPairing(catalog, registry);

if (errors.length > 0) {
  for (const message of errors) console.error(`agent catalog validation failed: ${message}`);
  process.exit(1);
}
console.log(`agent catalog OK: ${catalog.catalogVersion} (${catalog.agents.length} agents)`);
