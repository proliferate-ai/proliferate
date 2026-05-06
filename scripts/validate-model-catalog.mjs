#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const CATALOG_PATH = path.resolve("server/model-catalog/v1/catalog.json");
const VALID_STATUSES = new Set(["candidate", "active", "deprecated", "hidden"]);
const VALID_LAUNCH_REMEDIATION_KINDS = new Set([
  "managed_reinstall",
  "external_update",
  "restart",
]);
const LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS = 160;
const SUPPORTED_PROVIDER_KINDS = new Set([
  "claude",
  "codex",
  "gemini",
  "cursor",
  "opencode",
]);

function fail(message) {
  console.error(`model catalog validation failed: ${message}`);
  process.exitCode = 1;
}

function assertString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be a non-empty string`);
    return false;
  }
  return true;
}

function validateCatalog(catalog) {
  assertString(catalog.catalogVersion, "catalogVersion");
  assertString(catalog.generatedAt, "generatedAt");
  if (Number.isNaN(Date.parse(catalog.generatedAt))) {
    fail("generatedAt must be an ISO timestamp");
  }

  if (!Array.isArray(catalog.providers) || catalog.providers.length === 0) {
    fail("providers must be a non-empty array");
    return;
  }

  const providerKinds = new Set();
  for (const provider of catalog.providers) {
    assertString(provider.kind, "provider.kind");
    if (!SUPPORTED_PROVIDER_KINDS.has(provider.kind)) {
      fail(`provider.kind '${provider.kind}' is not supported by this runtime`);
    }
    if (providerKinds.has(provider.kind)) {
      fail(`provider.kind '${provider.kind}' is duplicated`);
    }
    providerKinds.add(provider.kind);

    assertString(provider.displayName, `${provider.kind}.displayName`);
    if (provider.defaultModelId !== undefined) {
      assertString(provider.defaultModelId, `${provider.kind}.defaultModelId`);
    }
    if (!Array.isArray(provider.models) || provider.models.length === 0) {
      fail(`${provider.kind}.models must be a non-empty array`);
      continue;
    }

    const modelIds = new Set();
    const selectableIds = new Set();
    let defaultCount = 0;
    for (const model of provider.models) {
      assertString(model.id, `${provider.kind}.model.id`);
      assertString(model.displayName, `${provider.kind}.${model.id}.displayName`);
      if (modelIds.has(model.id)) {
        fail(`${provider.kind}.${model.id} is duplicated`);
      }
      modelIds.add(model.id);

      if (!VALID_STATUSES.has(model.status)) {
        fail(`${provider.kind}.${model.id}.status is invalid`);
      }
      if (model.status === "active") {
        selectableIds.add(model.id);
      }
      if (model.isDefault === true) {
        defaultCount += 1;
      } else if (model.isDefault !== false) {
        fail(`${provider.kind}.${model.id}.isDefault must be boolean`);
      }
      if (model.aliases !== undefined && !Array.isArray(model.aliases)) {
        fail(`${provider.kind}.${model.id}.aliases must be an array when present`);
      }
      if (
        model.minRuntimeVersion !== undefined
        && !/^\d+\.\d+\.\d+/.test(model.minRuntimeVersion)
      ) {
        fail(`${provider.kind}.${model.id}.minRuntimeVersion must start with semver`);
      }
      if (model.launchRemediation !== undefined) {
        if (model.status !== "active") {
          fail(`${provider.kind}.${model.id}.launchRemediation is only allowed on active models`);
        }
        if (
          !model.launchRemediation
          || typeof model.launchRemediation !== "object"
          || Array.isArray(model.launchRemediation)
        ) {
          fail(`${provider.kind}.${model.id}.launchRemediation must be an object`);
          continue;
        }
        if (!VALID_LAUNCH_REMEDIATION_KINDS.has(model.launchRemediation.kind)) {
          fail(`${provider.kind}.${model.id}.launchRemediation.kind is invalid`);
        }
        if (!assertString(
          model.launchRemediation.message,
          `${provider.kind}.${model.id}.launchRemediation.message`,
        )) {
          continue;
        }
        if (
          [...model.launchRemediation.message.trim()].length
            > LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS
        ) {
          fail(
            `${provider.kind}.${model.id}.launchRemediation.message must be ${LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS} characters or fewer`,
          );
        }
      }
    }

    if (provider.defaultModelId && !modelIds.has(provider.defaultModelId)) {
      fail(`${provider.kind}.defaultModelId does not match a model id`);
    }
    if (provider.defaultModelId && !selectableIds.has(provider.defaultModelId)) {
      fail(`${provider.kind}.defaultModelId must be active`);
    }
    if (defaultCount !== 1) {
      fail(`${provider.kind} must have exactly one isDefault=true model`);
    }
  }
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
validateCatalog(catalog);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`validated ${CATALOG_PATH}`);
