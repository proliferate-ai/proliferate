/**
 * Candidate/retained artifact resolution: canonical hashing, malformed/mutable
 * rejection, and selected-world artifact completeness.
 *
 * A hash of an invalid manifest must never exist, so validation runs before
 * hashing. Rolling references ("latest", unverified "stable") can never satisfy
 * a slot. Selected-world completeness is derived from the world dependency
 * matrix in release-worlds-and-fixtures.md: strict execution rejects an
 * unavailable slot required by a selected world.
 *
 * Imports the frozen contracts/hashing.ts and contracts/artifacts.ts.
 */

import { canonicalManifestHash } from "../contracts/hashing.js";
import type {
  AnyManifest,
  ArtifactLocator,
  CandidateManifest,
  PlatformKey,
  RetainedProductionManifest,
  Slot,
  TemplateSlot,
} from "../contracts/artifacts.js";
import type { WorldId } from "../contracts/identity.js";

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

/** Rolling references that can never satisfy an immutable artifact slot. */
const ROLLING_TOKENS = ["latest", "stable", "edge", "nightly", "main", "current"];

function isRollingLocator(locator: string): boolean {
  const lower = locator.toLowerCase();
  // Match a rolling word as a tag (`:latest`), a trailing path segment
  // (`/latest`), or the whole value — but not as a substring of a real name
  // (e.g. "latestable" or a sha that happens to contain "main").
  for (const token of ROLLING_TOKENS) {
    if (lower === token) return true;
    if (lower.endsWith(`:${token}`) || lower.endsWith(`/${token}`)) return true;
    if (lower.includes(`:${token}/`) || lower.includes(`/${token}/`)) return true;
  }
  return false;
}

function validateLocator(where: string, locator: ArtifactLocator): void {
  if (typeof locator.locator !== "string" || locator.locator.length === 0) {
    throw new ManifestValidationError(`${where}: missing immutable locator`);
  }
  if (isRollingLocator(locator.locator)) {
    throw new ManifestValidationError(
      `${where}: rolling reference "${locator.locator}" cannot satisfy an immutable artifact slot`,
    );
  }
  if (locator.algorithm !== "sha256") {
    throw new ManifestValidationError(`${where}: unsupported digest algorithm "${String(locator.algorithm)}"`);
  }
  if (typeof locator.digest !== "string" || !/^[0-9a-f]{64}$/i.test(locator.digest)) {
    throw new ManifestValidationError(`${where}: digest must be a 64-char sha256 hex string`);
  }
  if (locator.sizeBytes !== null && (!Number.isInteger(locator.sizeBytes) || locator.sizeBytes < 0)) {
    throw new ManifestValidationError(`${where}: sizeBytes must be a non-negative integer or null`);
  }
}

function validateTemplate(where: string, template: TemplateSlot): void {
  if (typeof template.templateId !== "string" || template.templateId.length === 0) {
    throw new ManifestValidationError(`${where}: missing immutable template id`);
  }
  if (isRollingLocator(template.templateId)) {
    throw new ManifestValidationError(`${where}: rolling template tag "${template.templateId}" cannot satisfy a slot`);
  }
  if (typeof template.inputHash !== "string" || template.inputHash.length === 0) {
    throw new ManifestValidationError(`${where}: template must carry a complete input hash`);
  }
}

function validateSlot<T>(where: string, slot: Slot<T> | undefined, validateValue: (where: string, v: T) => void): void {
  if (slot === undefined) {
    throw new ManifestValidationError(`${where}: slot is absent from the manifest (must be an explicit Slot)`);
  }
  if (slot.available) {
    validateValue(where, slot.value);
  } else if (typeof slot.reason !== "string" || slot.reason.length === 0) {
    throw new ManifestValidationError(`${where}: unavailable slot must carry a reason`);
  }
}

const noopValue = (): void => {};

/**
 * Validates a candidate manifest's structure and immutability. Throws on any
 * malformed or mutable artifact BEFORE a hash can be produced.
 */
export function validateCandidateManifest(manifest: CandidateManifest): void {
  if (manifest.schemaVersion !== 1 || manifest.kind !== "candidate") {
    throw new ManifestValidationError("candidate manifest: wrong schemaVersion/kind");
  }
  if (!nonEmptyString(manifest.sourceSha)) throw new ManifestValidationError("candidate manifest: missing sourceSha");
  if (!nonEmptyString(manifest.sourceContentHash)) {
    throw new ManifestValidationError("candidate manifest: missing sourceContentHash");
  }
  validateSlot("serverImage", manifest.serverImage, validateLocator);
  validateSlot("webBuild", manifest.webBuild, validateLocator);
  validateSlot("desktopApp", manifest.desktopApp, validateLocator);
  validateSlot("desktopUpdater", manifest.desktopUpdater, (w, v) => {
    validateLocator(w, v);
    if (!nonEmptyString(v.signature)) throw new ManifestValidationError(`${w}: missing updater signature`);
  });
  validatePlatformMap("anyharness", manifest.anyharness);
  validatePlatformMap("worker", manifest.worker);
  validatePlatformMap("supervisor", manifest.supervisor);
  validateSlot("catalogHash", manifest.catalogHash, requireNonEmptyString);
  validateSlot("registryHash", manifest.registryHash, requireNonEmptyString);
  validateSlot("e2bTemplate", manifest.e2bTemplate, validateTemplate);
  validateSlot("selfHostBundle", manifest.selfHostBundle, validateLocator);
  validateSlot("litellm", manifest.litellm, (w, v) => {
    validateLocator(`${w}.image`, v.image);
    if (!nonEmptyString(v.configHash)) throw new ManifestValidationError(`${w}: missing configHash`);
  });
}

export function validateRetainedManifest(manifest: RetainedProductionManifest): void {
  if (manifest.schemaVersion !== 1 || manifest.kind !== "retained-production") {
    throw new ManifestValidationError("retained manifest: wrong schemaVersion/kind");
  }
  if (!nonEmptyString(manifest.sourceSha)) throw new ManifestValidationError("retained manifest: missing sourceSha");
  if (!nonEmptyString(manifest.productVersion)) {
    throw new ManifestValidationError("retained manifest: missing productVersion");
  }
  if (!nonEmptyString(manifest.qualificationEvidenceRef)) {
    throw new ManifestValidationError("retained manifest: missing qualificationEvidenceRef (N-1 must bind to its evidence)");
  }
  validateSlot("desktopApp", manifest.desktopApp, validateLocator);
  validateSlot("desktopUpdater", manifest.desktopUpdater, (w, v) => {
    validateLocator(w, v);
    if (!nonEmptyString(v.signature)) throw new ManifestValidationError(`${w}: missing updater signature`);
  });
  validateSlot("desktopUpdaterTrustIdentity", manifest.desktopUpdaterTrustIdentity, requireNonEmptyString);
  validateSlot("bundledAnyharnessVersion", manifest.bundledAnyharnessVersion, requireNonEmptyString);
  validateSlot("bundledWorkerVersion", manifest.bundledWorkerVersion, requireNonEmptyString);
  validateSlot("seedHash", manifest.seedHash, requireNonEmptyString);
  validateSlot("catalogHash", manifest.catalogHash, requireNonEmptyString);
  validateSlot("registryHash", manifest.registryHash, requireNonEmptyString);
  validateSlot("e2bTemplate", manifest.e2bTemplate, validateTemplate);
  validateSlot("templateComponents", manifest.templateComponents, (w, v) => {
    validateLocator(`${w}.anyharness`, v.anyharness);
    validateLocator(`${w}.worker`, v.worker);
    validateLocator(`${w}.supervisor`, v.supervisor);
  });
  validateSlot("installedAgentPins", manifest.installedAgentPins, noopValue);
}

function validatePlatformMap(
  where: string,
  map: Partial<Readonly<Record<PlatformKey, Slot<ArtifactLocator>>>>,
): void {
  for (const [platform, slot] of Object.entries(map)) {
    if (slot === undefined) continue;
    validateSlot(`${where}[${platform}]`, slot, validateLocator);
  }
}

/**
 * Validates then hashes a manifest. Because validation runs first, a malformed
 * or mutable manifest throws and never yields a hash.
 */
export function resolveManifestHash(manifest: AnyManifest): string {
  if (manifest.kind === "candidate") {
    validateCandidateManifest(manifest);
  } else {
    validateRetainedManifest(manifest);
  }
  return canonicalManifestHash(manifest);
}

/** Slot names available in a validated candidate manifest (for preflight source). */
export function availableCandidateSlots(
  manifest: CandidateManifest,
  hostPlatform?: PlatformKey,
): Set<string> {
  const available = new Set<string>();
  const mark = (name: string, slot: Slot<unknown>): void => {
    if (slot.available) available.add(name);
  };
  mark("serverImage", manifest.serverImage);
  mark("webBuild", manifest.webBuild);
  mark("desktopApp", manifest.desktopApp);
  mark("desktopUpdater", manifest.desktopUpdater);
  mark("catalogHash", manifest.catalogHash);
  mark("registryHash", manifest.registryHash);
  mark("e2bTemplate", manifest.e2bTemplate);
  mark("selfHostBundle", manifest.selfHostBundle);
  mark("litellm", manifest.litellm);
  // Platform-keyed families are "available" when the host platform slot is
  // available (or, when host is unspecified, any platform is available).
  markPlatform("anyharness", manifest.anyharness);
  markPlatform("worker", manifest.worker);
  markPlatform("supervisor", manifest.supervisor);
  return available;

  function markPlatform(name: string, map: Partial<Readonly<Record<PlatformKey, Slot<ArtifactLocator>>>>): void {
    const slots = hostPlatform ? [map[hostPlatform]] : Object.values(map);
    if (slots.some((slot) => slot?.available)) available.add(name);
  }
}

export interface ArtifactCompletenessResult {
  readonly complete: boolean;
  /** Slot names required by a selected world but unavailable/absent. */
  readonly missing: readonly string[];
}

/** Required candidate slots per world (from the world dependency matrix). */
const WORLD_REQUIRED_SLOTS: Record<WorldId, readonly string[]> = {
  "tier-2": ["serverImage", "webBuild"],
  "local-runtime": ["serverImage", "anyharness", "catalogHash", "registryHash", "litellm"],
  "managed-cloud": ["serverImage", "e2bTemplate", "anyharness", "worker", "supervisor", "litellm"],
  "self-host": ["serverImage", "selfHostBundle"],
  "desktop-upgrade": ["desktopApp", "desktopUpdater", "catalogHash"],
  "managed-cloud-upgrade": ["anyharness", "worker", "supervisor"],
};

/** Required retained slots per Tier-4 world. */
const WORLD_REQUIRED_RETAINED_SLOTS: Partial<Record<WorldId, readonly string[]>> = {
  "desktop-upgrade": ["desktopApp", "desktopUpdater", "desktopUpdaterTrustIdentity", "bundledAnyharnessVersion"],
  "managed-cloud-upgrade": ["e2bTemplate", "templateComponents"],
};

/**
 * Verifies the candidate (and, for Tier 4, retained) manifest carries every slot
 * the selected worlds require as available. Strict execution rejects an
 * unavailable required slot.
 */
export function assertSelectedWorldArtifacts(
  candidate: CandidateManifest,
  retained: RetainedProductionManifest | null,
  worlds: readonly WorldId[],
  hostPlatform?: PlatformKey,
): ArtifactCompletenessResult {
  const availableCandidate = availableCandidateSlots(candidate, hostPlatform);
  const availableRetained = retained ? availableRetainedSlots(retained) : new Set<string>();
  const missing = new Set<string>();

  for (const world of worlds) {
    for (const slot of WORLD_REQUIRED_SLOTS[world] ?? []) {
      if (!availableCandidate.has(slot)) missing.add(`candidate.${slot}`);
    }
    const retainedSlots = WORLD_REQUIRED_RETAINED_SLOTS[world];
    if (retainedSlots) {
      if (!retained) {
        missing.add(`retained-manifest-absent-for-${world}`);
      } else {
        for (const slot of retainedSlots) {
          if (!availableRetained.has(slot)) missing.add(`retained.${slot}`);
        }
      }
    }
  }
  return { complete: missing.size === 0, missing: [...missing].sort() };
}

function availableRetainedSlots(manifest: RetainedProductionManifest): Set<string> {
  const available = new Set<string>();
  const entries: Array<[string, Slot<unknown>]> = [
    ["desktopApp", manifest.desktopApp],
    ["desktopUpdater", manifest.desktopUpdater],
    ["desktopUpdaterTrustIdentity", manifest.desktopUpdaterTrustIdentity],
    ["bundledAnyharnessVersion", manifest.bundledAnyharnessVersion],
    ["bundledWorkerVersion", manifest.bundledWorkerVersion],
    ["seedHash", manifest.seedHash],
    ["catalogHash", manifest.catalogHash],
    ["registryHash", manifest.registryHash],
    ["e2bTemplate", manifest.e2bTemplate],
    ["templateComponents", manifest.templateComponents],
    ["installedAgentPins", manifest.installedAgentPins],
  ];
  for (const [name, slot] of entries) {
    if (slot.available) available.add(name);
  }
  return available;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function requireNonEmptyString(where: string, value: unknown): void {
  if (!nonEmptyString(value)) throw new ManifestValidationError(`${where}: expected a non-empty string`);
}
