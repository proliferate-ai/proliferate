#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const CATALOG_PATH = path.resolve("catalogs/launch/v1/catalog.json");
const VALID_AGENT_KINDS = new Set(["claude", "codex", "gemini", "cursor", "opencode"]);
const VALID_STATUSES = new Set(["candidate", "active", "deprecated", "hidden"]);
const VALID_CONTROL_KEYS = new Set([
  "mode",
  "collaboration_mode",
  "access_mode",
  "reasoning",
  "effort",
  "fast_mode",
]);
const VALID_CONTROL_PHASES = new Set(["create_session", "live_default"]);
const VALID_CREATE_FIELDS = new Set(["modeId"]);
const VALID_REMEDIATION_KINDS = new Set(["managed_reinstall", "external_update", "restart"]);

function fail(message) {
  console.error(`launch catalog validation failed: ${message}`);
  process.exitCode = 1;
}

function assertString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be a non-empty string`);
    return false;
  }
  return true;
}

function validateControl(control, owner) {
  if (!VALID_CONTROL_KEYS.has(control?.key)) {
    fail(`${owner}.launchControls key is invalid`);
  }
  assertString(control?.label, `${owner}.${control?.key ?? "control"}.label`);
  if (control?.type !== "select") {
    fail(`${owner}.${control?.key ?? "control"}.type must be select`);
  }
  assertString(control?.defaultValue, `${owner}.${control?.key ?? "control"}.defaultValue`);
  if (!VALID_CONTROL_PHASES.has(control?.phase)) {
    fail(`${owner}.${control?.key ?? "control"}.phase is invalid`);
  }
  if (control?.createField !== undefined && !VALID_CREATE_FIELDS.has(control.createField)) {
    fail(`${owner}.${control?.key ?? "control"}.createField is invalid`);
  }
  if (control?.phase === "create_session" && control.createField !== "modeId") {
    fail(`${owner}.${control.key}.create_session controls must declare createField=modeId`);
  }
  if (!Array.isArray(control?.values) || control.values.length === 0) {
    fail(`${owner}.${control?.key ?? "control"}.values must be non-empty`);
    return;
  }

  const values = new Set();
  let defaultCount = 0;
  for (const value of control.values) {
    assertString(value?.value, `${owner}.${control.key}.value`);
    assertString(value?.label, `${owner}.${control.key}.${value?.value ?? "value"}.label`);
    if (values.has(value.value)) {
      fail(`${owner}.${control.key}.${value.value} is duplicated`);
    }
    values.add(value.value);
    if (value.isDefault === true) {
      defaultCount += 1;
    } else if (value.isDefault !== false) {
      fail(`${owner}.${control.key}.${value.value}.isDefault must be boolean`);
    }
  }
  if (!values.has(control.defaultValue)) {
    fail(`${owner}.${control.key}.defaultValue does not match a value`);
  }
  if (defaultCount !== 1) {
    fail(`${owner}.${control.key} must mark exactly one default value`);
  }
}

function validateModel(model, agentKind, modelIds) {
  assertString(model.id, `${agentKind}.model.id`);
  assertString(model.displayName, `${agentKind}.${model.id}.displayName`);
  if (modelIds.has(model.id)) {
    fail(`${agentKind}.${model.id} is duplicated`);
  }
  modelIds.add(model.id);
  if (!Array.isArray(model.aliases)) {
    fail(`${agentKind}.${model.id}.aliases must be an array`);
  }
  if (!VALID_STATUSES.has(model.status)) {
    fail(`${agentKind}.${model.id}.status is invalid`);
  }
  if (model.isDefault !== true && model.isDefault !== false) {
    fail(`${agentKind}.${model.id}.isDefault must be boolean`);
  }
  if (model.launchRemediation !== null) {
    if (!model.launchRemediation || typeof model.launchRemediation !== "object") {
      fail(`${agentKind}.${model.id}.launchRemediation must be null or an object`);
    } else {
      if (!VALID_REMEDIATION_KINDS.has(model.launchRemediation.kind)) {
        fail(`${agentKind}.${model.id}.launchRemediation.kind is invalid`);
      }
      assertString(model.launchRemediation.message, `${agentKind}.${model.id}.launchRemediation.message`);
      if ([...model.launchRemediation.message].length > 160) {
        fail(`${agentKind}.${model.id}.launchRemediation.message must be 160 characters or fewer`);
      }
    }
  }
  for (const control of model.launchControls ?? []) {
    validateControl(control, `${agentKind}.${model.id}`);
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
    assertString(agent.kind, "agent.kind");
    if (!VALID_AGENT_KINDS.has(agent.kind)) {
      fail(`agent.kind '${agent.kind}' is not supported by this runtime`);
    }
    if (agents.has(agent.kind)) {
      fail(`agent.kind '${agent.kind}' is duplicated`);
    }
    agents.add(agent.kind);
    assertString(agent.displayName, `${agent.kind}.displayName`);
    assertString(agent.defaultModelId, `${agent.kind}.defaultModelId`);
    for (const control of agent.launchControls ?? []) {
      validateControl(control, agent.kind);
    }

    if (!Array.isArray(agent.models) || agent.models.length === 0) {
      fail(`${agent.kind}.models must be non-empty`);
      continue;
    }
    const modelIds = new Set();
    let defaultCount = 0;
    for (const model of agent.models) {
      validateModel(model, agent.kind, modelIds);
      if (model.isDefault) {
        defaultCount += 1;
      }
    }
    if (!modelIds.has(agent.defaultModelId)) {
      fail(`${agent.kind}.defaultModelId does not match a model id`);
    }
    if (defaultCount !== 1) {
      fail(`${agent.kind} must have exactly one isDefault=true model`);
    }
  }
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
validateCatalog(catalog);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`validated ${CATALOG_PATH}`);
