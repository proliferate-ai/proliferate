/**
 * Shared field-level validators for CandidateManifest / RetainedProductionManifest.
 * Every validator appends issues to an IssueCollector rather than throwing, so
 * a manifest with several problems reports all of them at once.
 */

import type { PlatformKey } from "../contracts/artifacts.js";
import type { IssueCollector } from "./errors.js";
import { rollingReferenceReason } from "./rolling-refs.js";

export const PLATFORM_KEYS: readonly PlatformKey[] = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
  "linux-aarch64",
];

const HEX_DIGEST_64 = /^[0-9a-f]{64}$/i;
/** Looser hex check for hashes whose algorithm/width isn't pinned by the contract (e.g. template input hashes). */
const HEX_ANY = /^[0-9a-f]{16,}$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireNonEmptyString(value: unknown, path: string, issues: IssueCollector): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.add(path, "expected a non-empty string");
    return undefined;
  }
  return value;
}

export function requireHexDigest(value: unknown, path: string, issues: IssueCollector, strict64 = true): void {
  const str = requireNonEmptyString(value, path, issues);
  if (str === undefined) {
    return;
  }
  const pattern = strict64 ? HEX_DIGEST_64 : HEX_ANY;
  if (!pattern.test(str)) {
    issues.add(
      path,
      strict64
        ? "expected a 64-character hex sha256 digest"
        : "expected a hex digest string of at least 16 characters",
    );
  }
}

export function requireNotRollingReference(value: string, path: string, issues: IssueCollector): void {
  const reason = rollingReferenceReason(value);
  if (reason) {
    issues.add(path, reason);
  }
}

/** Validates one `ArtifactLocator`. Rejects rolling refs and missing/malformed digests. */
export function validateArtifactLocator(value: unknown, path: string, issues: IssueCollector): void {
  if (!isRecord(value)) {
    issues.add(path, "expected an ArtifactLocator object");
    return;
  }
  const locator = requireNonEmptyString(value.locator, `${path}.locator`, issues);
  if (locator !== undefined) {
    requireNotRollingReference(locator, `${path}.locator`, issues);
  }
  requireHexDigest(value.digest, `${path}.digest`, issues, true);
  if (value.algorithm !== "sha256") {
    issues.add(`${path}.algorithm`, 'expected "sha256"');
  }
  if (value.sizeBytes !== null && (typeof value.sizeBytes !== "number" || !Number.isFinite(value.sizeBytes) || value.sizeBytes < 0)) {
    issues.add(`${path}.sizeBytes`, "expected a non-negative finite number or null");
  }
}

/** Validates an `ArtifactLocator & { signature }` (the desktop updater slot shape). */
export function validateSignedArtifactLocator(value: unknown, path: string, issues: IssueCollector): void {
  validateArtifactLocator(value, path, issues);
  if (isRecord(value)) {
    requireNonEmptyString(value.signature, `${path}.signature`, issues);
  }
}

/** Validates one `TemplateSlot`: immutable template id plus a complete input hash. */
export function validateTemplateSlotValue(value: unknown, path: string, issues: IssueCollector): void {
  if (!isRecord(value)) {
    issues.add(path, "expected a TemplateSlot object");
    return;
  }
  const templateId = requireNonEmptyString(value.templateId, `${path}.templateId`, issues);
  if (templateId !== undefined) {
    requireNotRollingReference(templateId, `${path}.templateId`, issues);
  }
  requireHexDigest(value.inputHash, `${path}.inputHash`, issues, false);
}

/**
 * Validates a `Slot<T>` union: `{available:true, value}` or
 * `{available:false, reason}`. `validateValue` is only invoked for the
 * available branch.
 */
export function validateSlot(
  value: unknown,
  path: string,
  issues: IssueCollector,
  validateValue: (value: unknown, path: string, issues: IssueCollector) => void,
): void {
  if (!isRecord(value)) {
    issues.add(path, "expected a Slot object ({available:true,value:...} or {available:false,reason:...})");
    return;
  }
  if (value.available === true) {
    if (!("value" in value)) {
      issues.add(`${path}.value`, "available slot must carry a value");
      return;
    }
    validateValue(value.value, `${path}.value`, issues);
    return;
  }
  if (value.available === false) {
    requireNonEmptyString(value.reason, `${path}.reason`, issues);
    return;
  }
  issues.add(`${path}.available`, "expected boolean true or false");
}

/** Validates a `Partial<Record<PlatformKey, Slot<ArtifactLocator>>>` map. */
export function validatePlatformSlotMap(value: unknown, path: string, issues: IssueCollector): void {
  if (value === undefined) {
    return; // Partial<> — absent entirely is valid; per-platform absence is expressed via omission.
  }
  if (!isRecord(value)) {
    issues.add(path, "expected an object keyed by platform");
    return;
  }
  for (const [key, slot] of Object.entries(value)) {
    if (!PLATFORM_KEYS.includes(key as PlatformKey)) {
      issues.add(`${path}.${key}`, `"${key}" is not a recognized platform key (${PLATFORM_KEYS.join(", ")})`);
      continue;
    }
    validateSlot(slot, `${path}.${key}`, issues, validateArtifactLocator);
  }
}
