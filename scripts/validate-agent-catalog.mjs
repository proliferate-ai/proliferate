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
const BASELINE_CONTEXT_ID = "baseline";

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
    for (const model of models) {
      const id = model.id;
      if (typeof id !== "string" || !id.trim()) {
        fail(`${kind}: model with empty id`);
        continue;
      }
      if (modelIds.has(id)) fail(`${kind}: model '${id}' is duplicated`);
      modelIds.add(id);
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
      if (!modelIds.has(modelId)) {
        fail(`${kind}: defaults['${contextId}'] references unknown model '${modelId}'`);
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
