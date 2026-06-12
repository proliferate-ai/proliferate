#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const CATALOG_PATH = path.resolve("catalogs/agents/v1/catalog.json");
const REGISTRY_PATH = path.resolve("catalogs/agents/v1/registry.json");
const VALID_AGENT_KINDS = new Set(["claude", "codex", "gemini", "cursor", "opencode"]);
const VALID_DISCOVERY_KINDS = new Set(["none", "claude", "codex", "gemini", "opencode", "cursor"]);
const VALID_READINESS_POLICIES = new Set([
  "any_required_slot",
  "all_required_slots",
  "provider_managed",
  "none",
]);
const VALID_PROTOCOL_FACADES = new Set(["anthropic", "openai", "genai"]);
const VALID_CREDENTIAL_PROVIDER_IDS = new Set(["anthropic", "openai", "gemini", "cursor"]);
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
const VALID_CREATE_FIELDS_BY_CONTROL = new Map([
  ["model", "modelId"],
  ["mode", "modeId"],
]);
const VALID_LIVE_SETTERS = new Set(["runtime_control"]);
const VALID_REMEDIATION_KINDS = new Set(["managed_reinstall", "external_update", "restart"]);
const VALID_NATIVE_INSTALL_KINDS = new Set([
  "direct_binary",
  "tarball_release",
  "path_only",
  "manual",
]);
const VALID_AGENT_PROCESS_INSTALL_KINDS = new Set([
  "registry_backed",
  "managed_npm_package",
  "path_only",
  "manual",
]);
const VALID_AGENT_PROCESS_FALLBACK_KINDS = new Set([
  "npm_package",
  "native_subcommand",
  "binary_hint",
]);

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

function assertOptionalString(value, field) {
  if (value === undefined || value === null) {
    return;
  }
  assertString(value, field);
}

function validateStringMap(value, field, { allowEmpty = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`);
    return;
  }
  const entries = Object.entries(value);
  if (!allowEmpty && entries.length === 0) {
    fail(`${field} must not be empty`);
  }
  for (const [key, mapValue] of entries) {
    assertString(key, `${field}.key`);
    assertString(mapValue, `${field}.${key}`);
  }
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
  if (model.defaultOptIn !== undefined && model.defaultOptIn !== null && model.defaultOptIn !== true && model.defaultOptIn !== false) {
    fail(`${agentKind}.${model.id}.defaultOptIn must be boolean or null when present`);
  }
  if (model.defaultOptIn === true && model.status !== "active") {
    fail(`${agentKind}.${model.id}.defaultOptIn is only valid for active models`);
  }
  if (model.launchRemediation !== null && model.launchRemediation !== undefined) {
    if (model.status !== "active") {
      fail(`${agentKind}.${model.id}.launchRemediation is only valid for active models`);
    }
    if (!VALID_REMEDIATION_KINDS.has(model.launchRemediation?.kind)) {
      fail(`${agentKind}.${model.id}.launchRemediation.kind is invalid`);
    }
    assertString(model.launchRemediation?.message, `${agentKind}.${model.id}.launchRemediation.message`);
    if ([...model.launchRemediation.message.trim()].length > 160) {
      fail(`${agentKind}.${model.id}.launchRemediation.message must be 160 characters or fewer`);
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
    if (VALID_CREATE_FIELDS_BY_CONTROL.get(control.key) !== control.apply.createField) {
      fail(`${agentKind}.${control.key}.apply.createField is invalid`);
    }
  }
  if (control.key === "model") {
    if (control?.apply?.createField !== "modelId") {
      fail(`${agentKind}.model.apply.createField must be modelId`);
    }
    if (control.valueSource !== "agentModels" && control.valueSource !== "discoveredModels") {
      fail(`${agentKind}.model.valueSource must use agent models or discovered models`);
    }
  }
  if (control.key === "mode") {
    if (control?.apply?.createField !== "modeId") {
      fail(`${agentKind}.mode.apply.createField must be modeId`);
    }
    if (control.valueSource !== "inline") {
      fail(`${agentKind}.mode.valueSource must be inline`);
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

function validateStringArray(values, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(values)) {
    fail(`${field} must be an array`);
    return;
  }
  if (!allowEmpty && values.length === 0) {
    fail(`${field} must not be empty`);
  }
  for (const value of values) {
    assertString(value, field);
  }
}

function validateNpmInstallFields(install, field) {
  assertString(install?.package, `${field}.package`);
  assertOptionalString(install?.packageSubdir, `${field}.packageSubdir`);
  assertOptionalString(install?.sourceBuildBinaryName, `${field}.sourceBuildBinaryName`);
  assertString(install?.executableRelpath, `${field}.executableRelpath`);
}

function validateAgentProcessFallback(fallback, field) {
  if (!VALID_AGENT_PROCESS_FALLBACK_KINDS.has(fallback?.kind)) {
    fail(`${field}.kind is invalid`);
    return;
  }
  if (fallback.kind === "npm_package") {
    validateNpmInstallFields(fallback, field);
    return;
  }
  if (fallback.kind === "native_subcommand") {
    validateStringArray(fallback.args, `${field}.args`);
    return;
  }
  if (fallback.kind === "binary_hint") {
    validateStringArray(fallback.candidateBinaries, `${field}.candidateBinaries`, { allowEmpty: false });
    validateStringArray(fallback.args, `${field}.args`);
  }
}

function validateAgentProcessInstall(install, field) {
  if (!VALID_AGENT_PROCESS_INSTALL_KINDS.has(install?.kind)) {
    fail(`${field}.kind is invalid`);
    return;
  }
  if (install.kind === "registry_backed") {
    assertString(install.registryId, `${field}.registryId`);
    validateAgentProcessFallback(install.fallback, `${field}.fallback`);
    return;
  }
  if (install.kind === "managed_npm_package") {
    validateNpmInstallFields(install, field);
    return;
  }
  if (install.kind === "path_only") {
    validateStringArray(install.candidateBinaries, `${field}.candidateBinaries`, { allowEmpty: false });
    validateStringArray(install.defaultArgs, `${field}.defaultArgs`);
    assertOptionalString(install.docsUrl, `${field}.docsUrl`);
    return;
  }
  if (install.kind === "manual") {
    assertString(install.docsUrl, `${field}.docsUrl`);
  }
}

function validateNativeInstall(install, field) {
  if (!VALID_NATIVE_INSTALL_KINDS.has(install?.kind)) {
    fail(`${field}.kind is invalid`);
    return;
  }
  if (install.kind === "direct_binary") {
    assertOptionalString(install.latestVersionUrl, `${field}.latestVersionUrl`);
    assertString(install.binaryUrlTemplate, `${field}.binaryUrlTemplate`);
    validateStringMap(install.platformMap, `${field}.platformMap`, { allowEmpty: false });
    return;
  }
  if (install.kind === "tarball_release") {
    assertString(install.latestUrlTemplate, `${field}.latestUrlTemplate`);
    assertString(install.versionedUrlTemplate, `${field}.versionedUrlTemplate`);
    assertString(install.expectedBinaryTemplate, `${field}.expectedBinaryTemplate`);
    validateStringMap(install.platformMap, `${field}.platformMap`, { allowEmpty: false });
    return;
  }
  if (install.kind === "path_only") {
    validateStringArray(install.candidateBinaries, `${field}.candidateBinaries`, { allowEmpty: false });
    assertOptionalString(install.docsUrl, `${field}.docsUrl`);
    return;
  }
  if (install.kind === "manual") {
    assertString(install.docsUrl, `${field}.docsUrl`);
  }
}

function validateRegistryProcess(agent) {
  const agentKind = agent?.kind ?? "agent";
  assertString(agent?.launch?.executableName, `${agentKind}.launch.executableName`);
  if (!Array.isArray(agent?.launch?.defaultArgs)) {
    fail(`${agentKind}.launch.defaultArgs must be an array`);
  }
  if (!agent?.agentProcess?.install?.kind) {
    fail(`${agentKind}.agentProcess.install.kind is required`);
  } else {
    validateAgentProcessInstall(agent.agentProcess.install, `${agentKind}.agentProcess.install`);
  }
  if (agent.native !== null && agent.native !== undefined && !agent.native?.install?.kind) {
    fail(`${agentKind}.native.install.kind is required when native is present`);
  } else if (agent.native !== null && agent.native !== undefined) {
    validateNativeInstall(agent.native.install, `${agentKind}.native.install`);
  }
}

function validateRegistryAuth(agent) {
  const agentKind = agent?.kind ?? "agent";
  const auth = agent?.auth;
  if (!VALID_READINESS_POLICIES.has(auth?.readinessPolicy)) {
    fail(`${agentKind}.auth.readinessPolicy is invalid`);
  }
  if (!Array.isArray(auth?.slots)) {
    fail(`${agentKind}.auth.slots must be an array`);
    return;
  }
  if (auth.readinessPolicy !== "none" && auth.slots.length === 0) {
    fail(`${agentKind}.auth.slots must be non-empty unless readinessPolicy is none`);
  }
  const slotIds = new Set();
  const requiredSlotIds = new Set();
  for (const slot of auth.slots) {
    assertString(slot?.id, `${agentKind}.auth.slot.id`);
    if (slotIds.has(slot.id)) {
      fail(`${agentKind}.auth.slot '${slot.id}' is duplicated`);
    }
    slotIds.add(slot.id);
    assertString(slot?.label, `${agentKind}.auth.${slot.id}.label`);
    validateStringArray(
      slot?.credentialProviderIds,
      `${agentKind}.auth.${slot.id}.credentialProviderIds`,
      { allowEmpty: false },
    );
    for (const providerId of slot.credentialProviderIds ?? []) {
      if (!VALID_CREDENTIAL_PROVIDER_IDS.has(providerId)) {
        fail(`${agentKind}.auth.${slot.id}.credentialProviderIds '${providerId}' is invalid`);
      }
    }
    if (typeof slot?.requiredForReadiness !== "boolean") {
      fail(`${agentKind}.auth.${slot?.id ?? "slot"}.requiredForReadiness must be boolean`);
    } else if (slot.requiredForReadiness) {
      requiredSlotIds.add(slot.id);
    }
    validateStringArray(slot?.envVars, `${agentKind}.auth.${slot.id}.envVars`);
    if (!VALID_DISCOVERY_KINDS.has(slot?.discovery)) {
      fail(`${agentKind}.auth.${slot.id}.discovery is invalid`);
    }
    if (slot.login !== null && slot.login !== undefined) {
      assertString(slot.login?.label, `${agentKind}.auth.${slot.id}.login.label`);
      assertString(slot.login?.command?.program, `${agentKind}.auth.${slot.id}.login.command.program`);
      if (!Array.isArray(slot.login?.command?.args)) {
        fail(`${agentKind}.auth.${slot.id}.login.command.args must be an array`);
      }
      if (typeof slot.login?.reusesUserState !== "boolean") {
        fail(`${agentKind}.auth.${slot.id}.login.reusesUserState must be boolean`);
      }
    }

    const gateway = slot.materialization?.gatewayEnv;
    if (gateway !== null && gateway !== undefined) {
      if (!VALID_PROTOCOL_FACADES.has(gateway.protocolFacade)) {
        fail(`${agentKind}.auth.${slot.id}.materialization.gatewayEnv.protocolFacade is invalid`);
      }
      validateStringArray(
        gateway.protectedEnvKeys,
        `${agentKind}.auth.${slot.id}.materialization.gatewayEnv.protectedEnvKeys`,
      );
      validateStringArray(
        gateway.supportEnvKeys,
        `${agentKind}.auth.${slot.id}.materialization.gatewayEnv.supportEnvKeys`,
      );
    }
    const synced = slot.materialization?.syncedFiles;
    if (synced !== null && synced !== undefined) {
      validateStringArray(
        synced.protectedEnvKeys,
        `${agentKind}.auth.${slot.id}.materialization.syncedFiles.protectedEnvKeys`,
      );
      validateStringArray(
        synced.allowedFilePaths,
        `${agentKind}.auth.${slot.id}.materialization.syncedFiles.allowedFilePaths`,
      );
      validateStringArray(
        synced.cleanupFilePaths,
        `${agentKind}.auth.${slot.id}.materialization.syncedFiles.cleanupFilePaths`,
      );
      const allowedFilePaths = new Set(synced.allowedFilePaths ?? []);
      for (const cleanupPath of synced.cleanupFilePaths ?? []) {
        if (!allowedFilePaths.has(cleanupPath)) {
          fail(
            `${agentKind}.auth.${slot.id}.materialization.syncedFiles.cleanupFilePaths `
            + `'${cleanupPath}' must also be listed in allowedFilePaths`,
          );
        }
      }
    }
  }
  if (
    (auth.readinessPolicy === "any_required_slot" || auth.readinessPolicy === "all_required_slots")
    && requiredSlotIds.size === 0
  ) {
    fail(`${agentKind}.auth.readinessPolicy requires at least one required slot`);
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
    const defaultModel = session.models.find((model) => model.id === session.defaultModelId);
    if (defaultModel?.status !== "active") {
      fail(`${agent.kind}.session.defaultModelId must reference an active model`);
    }
    if (defaultModel?.defaultOptIn !== true) {
      fail(`${agent.kind}.session.defaultModelId must have defaultOptIn true`);
    }
    if (defaultCount !== 1) {
      fail(`${agent.kind}.session.models must contain exactly one default`);
    }
    const activeModelIds = new Set(
      session.models.filter((model) => model.status === "active").map((model) => model.id),
    );
    const defaultOptInModelIds = new Set(
      session.models.filter((model) => model.defaultOptIn === true).map((model) => model.id),
    );
    for (const modelId of session.modelDisplayPolicy?.defaultVisibleModelIds ?? []) {
      if (!activeModelIds.has(modelId)) {
        fail(
          `${agent.kind}.session.modelDisplayPolicy.defaultVisibleModelIds `
          + `'${modelId}' is not an active model`,
        );
      }
      if (!defaultOptInModelIds.has(modelId)) {
        fail(
          `${agent.kind}.session.modelDisplayPolicy.defaultVisibleModelIds `
          + `'${modelId}' must have defaultOptIn true`,
        );
      }
    }
    for (const modelId of defaultOptInModelIds) {
      if (!session.modelDisplayPolicy?.defaultVisibleModelIds.includes(modelId)) {
        fail(
          `${agent.kind}.${modelId}.defaultOptIn true must be listed in `
          + "defaultVisibleModelIds",
        );
      }
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

function validateRegistry(registry, catalog) {
  if (registry.schemaVersion !== 1) {
    fail("registry.schemaVersion must be 1");
  }
  assertString(registry.registryVersion, "registryVersion");
  assertString(registry.generatedAt, "registry.generatedAt");
  if (Number.isNaN(Date.parse(registry.generatedAt))) {
    fail("registry.generatedAt must be an ISO timestamp");
  }
  if (!Array.isArray(registry.agents) || registry.agents.length === 0) {
    fail("registry.agents must be a non-empty array");
    return;
  }

  const catalogAgentsByKind = new Map((catalog.agents ?? []).map((agent) => [agent.kind, agent]));
  const registryAgents = new Set();
  for (const agent of registry.agents) {
    assertString(agent?.kind, "registry.agent.kind");
    if (!VALID_AGENT_KINDS.has(agent.kind)) {
      fail(`registry agent.kind '${agent.kind}' is not supported by this runtime`);
    }
    if (registryAgents.has(agent.kind)) {
      fail(`registry agent.kind '${agent.kind}' is duplicated`);
    }
    registryAgents.add(agent.kind);
    assertString(agent.displayName, `${agent.kind}.displayName`);
    if (!catalogAgentsByKind.has(agent.kind)) {
      fail(`registry agent '${agent.kind}' is missing from catalog`);
    } else if (catalogAgentsByKind.get(agent.kind).displayName !== agent.displayName) {
      fail(`registry agent '${agent.kind}' displayName must match catalog`);
    }
    validateRegistryProcess(agent);
    validateRegistryAuth(agent);
  }

  for (const agent of catalog.agents ?? []) {
    if (!registryAgents.has(agent.kind)) {
      fail(`catalog agent '${agent.kind}' is missing from registry`);
    }
  }
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
validateCatalog(catalog);
validateRegistry(registry, catalog);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`validated ${CATALOG_PATH}`);
console.log(`validated ${REGISTRY_PATH}`);
