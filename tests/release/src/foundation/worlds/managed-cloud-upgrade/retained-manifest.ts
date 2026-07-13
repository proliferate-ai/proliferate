/**
 * Retained production N-1 manifest loading and validation for the
 * managed-cloud upgrade world (T4-RUNTIME-1).
 *
 * The world provisions the EXACT immutable production N-1 E2B template. Per
 * the tier-4 contract, N-1 is resolved from the retained production manifest —
 * never inferred by patch arithmetic, never rebuilt from candidate source, and
 * never taken from a rolling `stable` tag without digest proof. This module
 * loads that receipt from disk and validates that the slots this world needs
 * are present and immutable before the provisioner will touch any provider.
 *
 * `scripts/capture-retained-production-manifest.mjs` produces the file this
 * loads by snapshotting the current production rolling tag into an immutable
 * build id + component versions.
 */

import { readFileSync } from "node:fs";

import type {
  ArtifactLocator,
  RetainedProductionManifest,
  Slot,
  TemplateSlot,
} from "../../contracts/artifacts.js";
import { canonicalManifestHash } from "../../contracts/hashing.js";

/** A validation failure that names exactly which slot/field is wrong. */
export class RetainedManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetainedManifestError";
  }
}

/** Substrings that mark a locator as a forbidden rolling reference. */
const ROLLING_TOKENS = ["latest", "rolling", "/stable", ":stable", "stable-"];

function isRollingLocator(locator: string): boolean {
  const lower = locator.toLowerCase();
  return ROLLING_TOKENS.some((token) => lower.includes(token));
}

function requireAvailable<T>(slot: Slot<T> | undefined, field: string): T {
  if (slot === undefined) {
    throw new RetainedManifestError(`retained manifest is missing required slot "${field}"`);
  }
  if (!slot.available) {
    throw new RetainedManifestError(
      `retained manifest slot "${field}" is unavailable: ${slot.reason}. Strict execution ` +
        `cannot provision the managed-cloud upgrade world without it — capture it into the ` +
        `retained-production manifest first.`,
    );
  }
  return slot.value;
}

function validateTemplateSlot(slot: TemplateSlot, field: string): void {
  if (!slot.templateId || slot.templateId.trim().length === 0) {
    throw new RetainedManifestError(`retained manifest "${field}".templateId is empty`);
  }
  if (isRollingLocator(slot.templateId)) {
    throw new RetainedManifestError(
      `retained manifest "${field}".templateId "${slot.templateId}" looks like a rolling tag; ` +
        `a retained N-1 template must be an immutable build id with a complete input hash.`,
    );
  }
  if (!slot.inputHash || slot.inputHash.trim().length === 0) {
    throw new RetainedManifestError(`retained manifest "${field}".inputHash is empty`);
  }
}

function validateLocator(locator: ArtifactLocator, field: string): void {
  if (!locator.locator || locator.locator.trim().length === 0) {
    throw new RetainedManifestError(`retained manifest "${field}".locator is empty`);
  }
  if (isRollingLocator(locator.locator)) {
    throw new RetainedManifestError(
      `retained manifest "${field}".locator "${locator.locator}" is a rolling reference; ` +
        `only an immutable, digest-verified locator can satisfy a retained artifact slot.`,
    );
  }
  if (!locator.digest || locator.digest.trim().length === 0) {
    throw new RetainedManifestError(`retained manifest "${field}".digest is empty`);
  }
}

/**
 * Validate a candidate object is a well-formed RetainedProductionManifest with
 * every slot THIS world needs available and immutable. Throws
 * RetainedManifestError naming the first problem; returns the typed manifest on
 * success. Fields not consumed by this world (e.g. Desktop artifacts) are not
 * required to be available here.
 */
export function validateRetainedManifest(value: unknown): RetainedProductionManifest {
  if (value === null || typeof value !== "object") {
    throw new RetainedManifestError("retained manifest is not an object");
  }
  const m = value as Partial<RetainedProductionManifest>;
  if (m.kind !== "retained-production") {
    throw new RetainedManifestError(`retained manifest kind must be "retained-production", got ${String(m.kind)}`);
  }
  if (m.schemaVersion !== 1) {
    throw new RetainedManifestError(`retained manifest schemaVersion must be 1, got ${String(m.schemaVersion)}`);
  }
  if (!m.sourceSha || !m.productVersion) {
    throw new RetainedManifestError("retained manifest must carry sourceSha and productVersion");
  }
  if (!m.qualificationEvidenceRef) {
    throw new RetainedManifestError(
      "retained manifest must bind qualificationEvidenceRef — the trusted evidence that promoted N-1. " +
        "A production release with no promoting evidence is not a valid N-1.",
    );
  }

  // The E2B template + its component versions are the load-bearing slots for
  // this world: the sandbox is built from the exact immutable N-1 template.
  const template = requireAvailable(m.e2bTemplate, "e2bTemplate");
  validateTemplateSlot(template, "e2bTemplate");

  const components = requireAvailable(m.templateComponents, "templateComponents");
  validateLocator(components.anyharness, "templateComponents.anyharness");
  validateLocator(components.worker, "templateComponents.worker");
  validateLocator(components.supervisor, "templateComponents.supervisor");

  // Baseline component versions used to assert the sandbox actually booted N-1.
  requireAvailable(m.bundledAnyharnessVersion, "bundledAnyharnessVersion");
  requireAvailable(m.installedAgentPins, "installedAgentPins");

  return value as RetainedProductionManifest;
}

/** Read + validate a retained-production manifest JSON file. */
export function loadRetainedManifest(path: string): RetainedProductionManifest {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new RetainedManifestError(
      `could not read retained-production manifest at ${path}: ${error instanceof Error ? error.message : String(error)}. ` +
        `Capture it with scripts/capture-retained-production-manifest.mjs.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RetainedManifestError(
      `retained-production manifest at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateRetainedManifest(parsed);
}

/** The immutable N-1 template slot; throws if it is not available. */
export function requireRetainedTemplate(manifest: RetainedProductionManifest): TemplateSlot {
  return requireAvailable(manifest.e2bTemplate, "e2bTemplate");
}

/** Canonical hash of the retained manifest, matching RunIdentity.retainedManifestHash. */
export function retainedManifestHash(manifest: RetainedProductionManifest): string {
  return canonicalManifestHash(manifest);
}
