/**
 * Candidate-manifest loading and strict validation.
 *
 * Consumes the frozen shapes in contracts/artifacts.ts. Rejects rolling refs
 * in any slot locator, rejects missing/malformed digests, and never returns a
 * manifest that failed validation — a hash of an invalid manifest must never
 * exist (contracts/hashing.ts).
 */

import { readFile } from "node:fs/promises";

import type { CandidateManifest } from "../contracts/artifacts.js";
import { IssueCollector, ManifestValidationError } from "./errors.js";
import {
  isRecord,
  requireHexDigest,
  requireNonEmptyString,
  validateArtifactLocator,
  validatePlatformSlotMap,
  validateSignedArtifactLocator,
  validateSlot,
  validateTemplateSlotValue,
} from "./slot-validators.js";

const SOURCE_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * Validates an already-parsed JSON value as a `CandidateManifest`. Throws
 * `ManifestValidationError` (with every issue, not just the first) when the
 * shape is wrong, a slot locator is a rolling reference, or a digest is
 * missing/malformed.
 */
export function parseCandidateManifest(raw: unknown): CandidateManifest {
  const issues = new IssueCollector();

  if (!isRecord(raw)) {
    throw new ManifestValidationError("candidate", [{ path: "$", message: "expected a JSON object" }]);
  }

  if (raw.schemaVersion !== 1) {
    issues.add("schemaVersion", "expected 1");
  }
  if (raw.kind !== "candidate") {
    issues.add("kind", 'expected "candidate"');
  }

  const sourceSha = requireNonEmptyString(raw.sourceSha, "sourceSha", issues);
  if (sourceSha !== undefined && !SOURCE_SHA_PATTERN.test(sourceSha)) {
    issues.add("sourceSha", "expected a 7-40 character hex git SHA");
  }
  requireHexDigest(raw.sourceContentHash, "sourceContentHash", issues, false);

  validateSlot(raw.serverImage, "serverImage", issues, validateArtifactLocator);
  validateSlot(raw.webBuild, "webBuild", issues, validateArtifactLocator);
  validateSlot(raw.desktopApp, "desktopApp", issues, validateArtifactLocator);
  validateSlot(raw.desktopUpdater, "desktopUpdater", issues, validateSignedArtifactLocator);
  validateSlot(raw.selfHostBundle, "selfHostBundle", issues, validateArtifactLocator);

  validatePlatformSlotMap(raw.anyharness, "anyharness", issues);
  validatePlatformSlotMap(raw.worker, "worker", issues);
  validatePlatformSlotMap(raw.supervisor, "supervisor", issues);

  validateSlot(raw.catalogHash, "catalogHash", issues, (v, p, i) => requireHexDigest(v, p, i, false));
  validateSlot(raw.registryHash, "registryHash", issues, (v, p, i) => requireHexDigest(v, p, i, false));
  validateSlot(raw.e2bTemplate, "e2bTemplate", issues, validateTemplateSlotValue);

  validateSlot(raw.litellm, "litellm", issues, (value, path, innerIssues) => {
    if (!isRecord(value)) {
      innerIssues.add(path, "expected {image, configHash}");
      return;
    }
    validateArtifactLocator(value.image, `${path}.image`, innerIssues);
    requireHexDigest(value.configHash, `${path}.configHash`, innerIssues, false);
  });

  issues.throwIfAny("candidate");
  return raw as unknown as CandidateManifest;
}

export async function loadCandidateManifest(path: string): Promise<CandidateManifest> {
  const text = await readFile(path, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ManifestValidationError("candidate", [
      { path: "$", message: `${path} is not valid JSON: ${(error as Error).message}` },
    ]);
  }
  return parseCandidateManifest(json);
}
