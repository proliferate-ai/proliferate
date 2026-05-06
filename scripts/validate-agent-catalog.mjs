#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const CATALOG_PATH = path.resolve("catalogs/agents/v1/catalog.json");
const VALID_AGENT_KINDS = new Set(["claude", "codex", "gemini", "cursor", "opencode"]);
const VALID_STATUSES = new Set(["candidate", "active", "deprecated", "hidden"]);
const VALID_CONTROL_TYPES = new Set(["select"]);
const VALID_VALUE_SOURCES = new Set(["inline", "agentModels", "discoveredModels"]);
const VALID_POLICIES = new Set([
  "ignore_default",
  "queue_then_conflict",
  "block_prompt",
  "remediate",
]);
const VALID_CONTROL_KEYS = new Set([
  "model",
  "mode",
  "collaboration_mode",
  "access_mode",
  "reasoning",
  "effort",
  "fast_mode",
]);
const VALID_CREATE_FIELDS = new Set(["modelId", "modeId"]);
const VALID_LIVE_SETTERS = new Set(["runtime_control"]);
const VALID_REMEDIATION_KINDS = new Set(["managed_reinstall", "external_update", "restart"]);

function fail(message) {
  console.error(`agent catalog validation failed: ${message}`);
  process.exitCode = 1;
}

function assertString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be a non-empty string`);
    return false;
  }
  return true;
}

function validateModel(model, agentKind, modelIds, aliasIds) {
  assertString(model?.id, `${agentKind}.model.id`);
  assertString(model?.displayName, `${agentKind}.${model?.id ?? "model"}.displayName`);
  if (modelIds.has(model.id)) {
    fail(`${agentKind}.${model.id} is duplicated`);
  }
  modelIds.add(model.id);
  for (const alias of model.aliases ?? []) {
    assertString(alias, `${agentKind}.${model.id}.alias`);
    if (aliasIds.has(alias) || modelIds.has(alias)) {
      fail(`${agentKind}.${model.id}.alias '${alias}' collides`);
    }
    aliasIds.add(alias);
  }
  if (!VALID_STATUSES.has(model.status)) {
    fail(`${agentKind}.${model.id}.status is invalid`);
  }
  if (model.isDefault !== true && model.isDefault !== false) {
    fail(`${agentKind}.${model.id}.isDefault must be boolean`);
  }
  if (model.launchRemediation !== null && model.launchRemediation !== undefined) {
    if (!VALID_REMEDIATION_KINDS.has(model.launchRemediation?.kind)) {
      fail(`${agentKind}.${model.id}.launchRemediation.kind is invalid`);
    }
    if (model.launchRemediation?.message !== undefined) {
      assertString(model.launchRemediation.message, `${agentKind}.${model.id}.launchRemediation.message`);
      if ([...model.launchRemediation.message.trim()].length > 160) {
        fail(`${agentKind}.${model.id}.launchRemediation.message must be 160 characters or fewer`);
      }
    }
  }
}

function validateControl(control, agentKind, modelIds) {
  if (!VALID_CONTROL_KEYS.has(control?.key)) {
    fail(`${agentKind}.control key '${control?.key}' is invalid`);
  }
  assertString(control?.label, `${agentKind}.${control?.key ?? "control"}.label`);
  if (!VALID_CONTROL_TYPES.has(control?.type)) {
    fail(`${agentKind}.${control?.key ?? "control"}.type is invalid`);
  }
  if (!VALID_VALUE_SOURCES.has(control?.valueSource)) {
    fail(`${agentKind}.${control?.key ?? "control"}.valueSource is invalid`);
  }
  if (!VALID_POLICIES.has(control?.missingLiveConfigPolicy)) {
    fail(`${agentKind}.${control?.key ?? "control"}.missingLiveConfigPolicy is invalid`);
  }
  for (const surface of ["start", "session", "automation", "settings"]) {
    if (typeof control?.surfaces?.[surface] !== "boolean") {
      fail(`${agentKind}.${control?.key ?? "control"}.surfaces.${surface} must be boolean`);
    }
  }
  if (control?.apply?.createField !== null && control?.apply?.createField !== undefined) {
    if (!VALID_CREATE_FIELDS.has(control.apply.createField)) {
      fail(`${agentKind}.${control.key}.apply.createField is invalid`);
    }
  }
  if (control?.apply?.liveSetter !== null && control?.apply?.liveSetter !== undefined) {
    if (!VALID_LIVE_SETTERS.has(control.apply.liveSetter)) {
      fail(`${agentKind}.${control.key}.apply.liveSetter is invalid`);
    }
  }
  if (control.valueSource === "inline") {
    if (!Array.isArray(control.values) || control.values.length === 0) {
      fail(`${agentKind}.${control.key}.values must be non-empty for inline controls`);
      return;
    }
    const values = new Set();
    let defaultCount = 0;
    for (const value of control.values) {
      assertString(value?.value, `${agentKind}.${control.key}.value`);
      assertString(value?.label, `${agentKind}.${control.key}.${value?.value ?? "value"}.label`);
      if (values.has(value.value)) {
        fail(`${agentKind}.${control.key}.${value.value} is duplicated`);
      }
      values.add(value.value);
      if (value.isDefault === true) {
        defaultCount += 1;
      } else if (value.isDefault !== false) {
        fail(`${agentKind}.${control.key}.${value.value}.isDefault must be boolean`);
      }
    }
    if (control.defaultValue !== null && !values.has(control.defaultValue)) {
      fail(`${agentKind}.${control.key}.defaultValue does not match a value`);
    }
    if (defaultCount !== 1) {
      fail(`${agentKind}.${control.key} must mark exactly one default value`);
    }
    return;
  }
  if (control.valueSource === "agentModels" && control.defaultValue !== null && !modelIds.has(control.defaultValue)) {
    fail(`${agentKind}.${control.key}.defaultValue does not match an agent model`);
  }
}

function validateProcess(process, agentKind) {
  assertString(process?.launch?.executableName, `${agentKind}.process.launch.executableName`);
  assertString(process?.auth?.discovery, `${agentKind}.process.auth.discovery`);
  if (!process?.agentProcess?.install?.kind) {
    fail(`${agentKind}.process.agentProcess.install.kind is required`);
  }
}

function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 1) {
    fail("schemaVersion must be 1");
  }
  assertString(catalog.catalogVersion, "catalogVersion");
  assertString(catalog.generatedAt, "generatedAt");
  if (Number.isNaN(Date.parse(catalog.generatedAt))) {
    fail("generatedAt must be an ISO timestamp");
  }
  if (!Array.isArray(catalog.agents) || catalog.agents.length === 0) {
    fail("agents must be a non-empty array");
    return;
  }

  const agents = new Set();
  for (const agent of catalog.agents) {
    assertString(agent?.kind, "agent.kind");
    if (!VALID_AGENT_KINDS.has(agent.kind)) {
      fail(`agent.kind '${agent.kind}' is not supported by this runtime`);
    }
    if (agents.has(agent.kind)) {
      fail(`agent.kind '${agent.kind}' is duplicated`);
    }
    agents.add(agent.kind);
    assertString(agent.displayName, `${agent.kind}.displayName`);
    validateProcess(agent.process, agent.kind);

    const session = agent.session;
    assertString(session?.defaultModelId, `${agent.kind}.session.defaultModelId`);
    if (!Array.isArray(session?.models) || session.models.length === 0) {
      fail(`${agent.kind}.session.models must be non-empty`);
      continue;
    }
    const modelIds = new Set();
    const aliasIds = new Set();
    let defaultCount = 0;
    for (const model of session.models) {
      validateModel(model, agent.kind, modelIds, aliasIds);
      if (model.isDefault) {
        defaultCount += 1;
      }
    }
    if (!modelIds.has(session.defaultModelId)) {
      fail(`${agent.kind}.session.defaultModelId does not match a model id`);
    }
    if (defaultCount !== 1) {
      fail(`${agent.kind}.session.models must contain exactly one default`);
    }

    const controlKeys = new Set();
    for (const control of session.controls ?? []) {
      if (controlKeys.has(control.key)) {
        fail(`${agent.kind}.session.controls '${control.key}' is duplicated`);
      }
      controlKeys.add(control.key);
      validateControl(control, agent.kind, modelIds);
    }
    if (!controlKeys.has("model")) {
      fail(`${agent.kind}.session.controls must include model`);
    }
  }
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
validateCatalog(catalog);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`validated ${CATALOG_PATH}`);
