/**
 * Retained-production manifest loading and strict validation (Tier 4).
 *
 * "Never infer N-1 via patch arithmetic": this loader only ever parses an
 * explicit path/locator supplied by the caller — it has no notion of
 * decrementing a version or rebuilding candidate source with an older
 * version string. It applies the same rigor as the candidate loader:
 * rolling refs and missing digests are rejected.
 */

import { readFile } from "node:fs/promises";

import type { RetainedProductionManifest } from "../contracts/artifacts.js";
import { IssueCollector, ManifestValidationError } from "./errors.js";
import {
  isRecord,
  requireHexDigest,
  requireNonEmptyString,
  validateArtifactLocator,
  validateSignedArtifactLocator,
  validateSlot,
  validateTemplateSlotValue,
} from "./slot-validators.js";

const SOURCE_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const PRODUCT_VERSION_PATTERN = /^\d+\.\d+\.\d+/;

export function parseRetainedProductionManifest(raw: unknown): RetainedProductionManifest {
  const issues = new IssueCollector();

  if (!isRecord(raw)) {
    throw new ManifestValidationError("retained-production", [{ path: "$", message: "expected a JSON object" }]);
  }

  if (raw.schemaVersion !== 1) {
    issues.add("schemaVersion", "expected 1");
  }
  if (raw.kind !== "retained-production") {
    issues.add("kind", 'expected "retained-production"');
  }

  const sourceSha = requireNonEmptyString(raw.sourceSha, "sourceSha", issues);
  if (sourceSha !== undefined && !SOURCE_SHA_PATTERN.test(sourceSha)) {
    issues.add("sourceSha", "expected a 7-40 character hex git SHA");
  }

  const productVersion = requireNonEmptyString(raw.productVersion, "productVersion", issues);
  if (productVersion !== undefined && !PRODUCT_VERSION_PATTERN.test(productVersion)) {
    issues.add("productVersion", 'expected a semver-shaped version, e.g. "0.2.15"');
  }

  requireNonEmptyString(raw.qualificationEvidenceRef, "qualificationEvidenceRef", issues);

  validateSlot(raw.desktopApp, "desktopApp", issues, validateArtifactLocator);
  validateSlot(raw.desktopUpdater, "desktopUpdater", issues, validateSignedArtifactLocator);
  validateSlot(raw.desktopUpdaterTrustIdentity, "desktopUpdaterTrustIdentity", issues, (v, p, i) =>
    requireNonEmptyString(v, p, i),
  );
  validateSlot(raw.bundledAnyharnessVersion, "bundledAnyharnessVersion", issues, (v, p, i) =>
    requireNonEmptyString(v, p, i),
  );
  validateSlot(raw.bundledWorkerVersion, "bundledWorkerVersion", issues, (v, p, i) => requireNonEmptyString(v, p, i));
  validateSlot(raw.seedHash, "seedHash", issues, (v, p, i) => requireHexDigest(v, p, i, false));
  validateSlot(raw.catalogHash, "catalogHash", issues, (v, p, i) => requireHexDigest(v, p, i, false));
  validateSlot(raw.registryHash, "registryHash", issues, (v, p, i) => requireHexDigest(v, p, i, false));
  validateSlot(raw.e2bTemplate, "e2bTemplate", issues, validateTemplateSlotValue);

  validateSlot(raw.templateComponents, "templateComponents", issues, (value, path, innerIssues) => {
    if (!isRecord(value)) {
      innerIssues.add(path, "expected {anyharness, worker, supervisor}");
      return;
    }
    validateArtifactLocator(value.anyharness, `${path}.anyharness`, innerIssues);
    validateArtifactLocator(value.worker, `${path}.worker`, innerIssues);
    validateArtifactLocator(value.supervisor, `${path}.supervisor`, innerIssues);
  });

  validateSlot(raw.installedAgentPins, "installedAgentPins", issues, (value, path, innerIssues) => {
    if (!isRecord(value)) {
      innerIssues.add(path, "expected an object of agent id -> pinned version");
      return;
    }
    for (const [agentId, version] of Object.entries(value)) {
      requireNonEmptyString(version, `${path}.${agentId}`, innerIssues);
    }
  });

  issues.throwIfAny("retained-production");
  return raw as unknown as RetainedProductionManifest;
}

/**
 * Loads the retained N-1 manifest from an explicit path. There is no default
 * location and no "current minus one" inference — the caller (release
 * pipeline or a developer) must name the exact receipt for the last
 * qualified production release.
 */
export async function loadRetainedProductionManifest(path: string): Promise<RetainedProductionManifest> {
  const text = await readFile(path, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ManifestValidationError("retained-production", [
      { path: "$", message: `${path} is not valid JSON: ${(error as Error).message}` },
    ]);
  }
  return parseRetainedProductionManifest(json);
}
