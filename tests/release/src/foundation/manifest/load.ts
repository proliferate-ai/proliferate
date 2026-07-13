/**
 * Load and strictly validate core-release-scenario-manifest.json.
 *
 * The runner MUST load this file before any --cells selection can be trusted:
 * an unknown scenario id, a dangling journey reference, or a malformed policy
 * is a hard, typed error — never a silently-accepted plan. A hash of an invalid
 * manifest must never exist, so validation completes (collecting every issue)
 * before the canonical hash is computed.
 */

import { readFileSync } from "node:fs";

import { canonicalManifestHash } from "../contracts/hashing.js";
import { ALL_WORLDS, type WorldId } from "../contracts/identity.js";
import { IssueCollector, ManifestValidationError } from "../artifacts/errors.js";
import {
  JOURNEY_HOSTS,
  type ComposedJourneyRow,
  type CoreReleaseManifest,
  type ImplementationStatus,
  type JourneyHost,
  type ManifestScenarioRow,
  type ManifestTier,
  type ParsedManifest,
  type QualificationPolicy,
} from "./types.js";

export { ManifestValidationError } from "../artifacts/errors.js";

/** Schema versions this loader understands. A bump must be a deliberate change. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [4];

const VALID_TIERS: ReadonlySet<number> = new Set([2, 3, 4]);
const VALID_STATUSES: ReadonlySet<string> = new Set([
  "planned",
  "collected",
  "enforced",
]);
const WORLD_SET: ReadonlySet<string> = new Set(ALL_WORLDS as readonly string[]);
const HOST_SET: ReadonlySet<string> = new Set(JOURNEY_HOSTS as readonly string[]);

const KIND = "core-release-scenario";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseImplementation(
  raw: unknown,
  path: string,
  issues: IssueCollector,
): ImplementationStatus {
  if (!isObject(raw)) {
    issues.add(path, "implementation must be an object with a status");
    return "planned";
  }
  const status = raw.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    issues.add(
      `${path}.status`,
      `status must be one of ${[...VALID_STATUSES].join(", ")}, got ${JSON.stringify(status)}`,
    );
    return "planned";
  }
  return status as ImplementationStatus;
}

function parseScenarioRows(
  raw: unknown,
  issues: IssueCollector,
): ManifestScenarioRow[] {
  if (!Array.isArray(raw)) {
    issues.add("requiredScenarios", "must be an array");
    return [];
  }
  const rows: ManifestScenarioRow[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const at = `requiredScenarios[${i}]`;
    if (!isObject(entry)) {
      issues.add(at, "row must be an object");
      return;
    }
    const id = entry.id;
    if (typeof id !== "string" || id.length === 0) {
      issues.add(`${at}.id`, "id must be a non-empty string");
      return;
    }
    if (seen.has(id)) {
      issues.add(`${at}.id`, `duplicate scenario id "${id}"`);
    }
    seen.add(id);
    const tier = entry.tier;
    if (typeof tier !== "number" || !VALID_TIERS.has(tier)) {
      issues.add(`${at}.tier`, `tier must be 2, 3, or 4, got ${JSON.stringify(tier)}`);
    }
    const status = parseImplementation(entry.implementation, `${at}.implementation`, issues);
    rows.push({ id, tier: tier as ManifestTier, implementation: { status } });
  });
  return rows;
}

function parseJourneys(
  raw: unknown,
  scenarioIds: ReadonlySet<string>,
  issues: IssueCollector,
): ComposedJourneyRow[] {
  if (!Array.isArray(raw)) {
    issues.add("composedJourneys", "must be an array");
    return [];
  }
  const rows: ComposedJourneyRow[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const at = `composedJourneys[${i}]`;
    if (!isObject(entry)) {
      issues.add(at, "journey must be an object");
      return;
    }
    const id = entry.id;
    if (typeof id !== "string" || id.length === 0) {
      issues.add(`${at}.id`, "id must be a non-empty string");
      return;
    }
    if (seen.has(id)) {
      issues.add(`${at}.id`, `duplicate journey id "${id}"`);
    }
    seen.add(id);
    const tier = entry.tier;
    if (typeof tier !== "number" || !VALID_TIERS.has(tier)) {
      issues.add(`${at}.tier`, `tier must be 2, 3, or 4, got ${JSON.stringify(tier)}`);
    }
    const world = entry.world;
    if (typeof world !== "string" || !WORLD_SET.has(world)) {
      issues.add(`${at}.world`, `world must be one of ${[...WORLD_SET].join(", ")}, got ${JSON.stringify(world)}`);
    }
    const requiredHosts = parseHosts(entry.requiredHosts, `${at}.requiredHosts`, issues);
    const targetScenarioRefs = parseRefs(entry.targetScenarioRefs, scenarioIds, `${at}.targetScenarioRefs`, issues);
    const status = parseImplementation(entry.implementation, `${at}.implementation`, issues);
    rows.push({
      id,
      tier: tier as ManifestTier,
      world: world as WorldId,
      requiredHosts,
      targetScenarioRefs,
      implementation: { status },
    });
  });
  return rows;
}

function parseHosts(raw: unknown, path: string, issues: IssueCollector): JourneyHost[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.add(path, "requiredHosts must be a non-empty array");
    return [];
  }
  const hosts: JourneyHost[] = [];
  raw.forEach((host, i) => {
    if (typeof host !== "string" || !HOST_SET.has(host)) {
      issues.add(`${path}[${i}]`, `host must be one of ${[...HOST_SET].join(", ")}, got ${JSON.stringify(host)}`);
      return;
    }
    hosts.push(host as JourneyHost);
  });
  return hosts;
}

function parseRefs(
  raw: unknown,
  scenarioIds: ReadonlySet<string>,
  path: string,
  issues: IssueCollector,
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.add(path, "targetScenarioRefs must be a non-empty array");
    return [];
  }
  const refs: string[] = [];
  raw.forEach((ref, i) => {
    if (typeof ref !== "string" || ref.length === 0) {
      issues.add(`${path}[${i}]`, "reference must be a non-empty string");
      return;
    }
    if (!scenarioIds.has(ref)) {
      issues.add(`${path}[${i}]`, `references unknown scenario id "${ref}"`);
    }
    refs.push(ref);
  });
  return refs;
}

function parsePolicy(
  raw: unknown,
  scenarioById: ReadonlyMap<string, ManifestScenarioRow>,
  issues: IssueCollector,
): QualificationPolicy {
  const fallback: QualificationPolicy = {
    tier3StandingSelection: {
      includeComposedJourneyReferences: true,
      standaloneScenarioIds: [],
      unreferencedDisposition: "deferred",
      fullCoreQualificationRequiresNoDeferred: true,
    },
  };
  if (!isObject(raw)) {
    issues.add("qualificationPolicy", "must be an object");
    return fallback;
  }
  const sel = raw.tier3StandingSelection;
  if (!isObject(sel)) {
    issues.add("qualificationPolicy.tier3StandingSelection", "must be an object");
    return fallback;
  }
  const base = "qualificationPolicy.tier3StandingSelection";
  if (typeof sel.includeComposedJourneyReferences !== "boolean") {
    issues.add(`${base}.includeComposedJourneyReferences`, "must be a boolean");
  }
  if (typeof sel.fullCoreQualificationRequiresNoDeferred !== "boolean") {
    issues.add(`${base}.fullCoreQualificationRequiresNoDeferred`, "must be a boolean");
  }
  if (sel.unreferencedDisposition !== "deferred") {
    issues.add(`${base}.unreferencedDisposition`, `must be "deferred", got ${JSON.stringify(sel.unreferencedDisposition)}`);
  }
  const standaloneRaw = sel.standaloneScenarioIds;
  const standalone: string[] = [];
  if (!Array.isArray(standaloneRaw)) {
    issues.add(`${base}.standaloneScenarioIds`, "must be an array");
  } else {
    standaloneRaw.forEach((id, i) => {
      if (typeof id !== "string") {
        issues.add(`${base}.standaloneScenarioIds[${i}]`, "must be a string");
        return;
      }
      const row = scenarioById.get(id);
      if (!row) {
        issues.add(`${base}.standaloneScenarioIds[${i}]`, `references unknown scenario id "${id}"`);
      } else if (row.tier !== 3) {
        issues.add(`${base}.standaloneScenarioIds[${i}]`, `standalone standing selection must be Tier 3, "${id}" is Tier ${row.tier}`);
      }
      standalone.push(id);
    });
  }
  return {
    tier3StandingSelection: {
      includeComposedJourneyReferences: sel.includeComposedJourneyReferences === true,
      standaloneScenarioIds: standalone,
      unreferencedDisposition: "deferred",
      fullCoreQualificationRequiresNoDeferred: sel.fullCoreQualificationRequiresNoDeferred === true,
    },
  };
}

/**
 * Validate a parsed JSON value as a core-release scenario manifest and return
 * the typed, hashed, indexed result. Throws {@link ManifestValidationError}
 * (aggregating every issue) on malformed input.
 */
export function parseScenarioManifest(raw: unknown): ParsedManifest {
  const issues = new IssueCollector();
  if (!isObject(raw)) {
    throw new ManifestValidationError(KIND, [{ path: "$", message: "manifest root must be an object" }]);
  }

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    issues.add("schemaVersion", "must be an integer");
  } else if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    issues.add(
      "schemaVersion",
      `unsupported schemaVersion ${schemaVersion}; this loader understands ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`,
    );
  }

  const scenarios = parseScenarioRows(raw.requiredScenarios, issues);
  const scenarioIds = new Set(scenarios.map((s) => s.id));
  const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
  const journeys = parseJourneys(raw.composedJourneys, scenarioIds, issues);
  const journeyById = new Map(journeys.map((j) => [j.id, j]));
  const qualificationPolicy = parsePolicy(raw.qualificationPolicy, scenarioById, issues);

  issues.throwIfAny(KIND);

  const manifest: CoreReleaseManifest = {
    schemaVersion: schemaVersion as number,
    qualificationPolicy,
    requiredScenarios: scenarios,
    composedJourneys: journeys,
  };

  return {
    manifest,
    hash: canonicalManifestHash(raw),
    scenarioById,
    journeyById,
  };
}

/** Read, JSON-parse, and validate the manifest at `filePath`. */
export function loadScenarioManifest(filePath: string): ParsedManifest {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new ManifestValidationError(KIND, [
      { path: filePath, message: `cannot read manifest file: ${error instanceof Error ? error.message : String(error)}` },
    ]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ManifestValidationError(KIND, [
      { path: filePath, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` },
    ]);
  }
  return parseScenarioManifest(raw);
}
