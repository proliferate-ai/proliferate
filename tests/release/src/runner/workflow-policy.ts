/**
 * Strict Tier-3 release-policy machinery (WS10a).
 *
 * The release runner (`src/cli/run.ts`) has two policies:
 *
 *   signal   informational nightly mode — the current behavior. Blocked and
 *            expected-fail required scenarios are permitted; the runner still
 *            fails on a genuine scenario error (its existing `failures` gate),
 *            but the required-scenario manifest is not a gate. This is the
 *            default so nothing currently green changes behavior.
 *
 *   release  strict mode — every required (id, lane) row in the manifest must
 *            be present exactly once and green. A required row that is missing,
 *            skipped, blocked, expected-fail, cancelled, failed, or DUPLICATED
 *            in the results makes the run exit nonzero.
 *
 * This module is pure and lane-agnostic: it evaluates already-collected result
 * rows against the required manifest. The CLI maps its runtime lanes onto the
 * manifest's release-lane vocabulary and calls `evaluate`. See
 * `specs/tbd/workflows-v1-completion-plan.md` §6 WS10 and
 * `specs/codebase/features/workflows.md` §14.
 *
 * The manifest CONTENT is WS10b-owned (see required-workflows.json); this file
 * owns the loader, uniqueness validation, and the comparison/verdict logic.
 */

import { readFileSync } from "node:fs";

export type ReleasePolicy = "signal" | "release";

export const RELEASE_POLICIES: readonly ReleasePolicy[] = ["signal", "release"];

/** Default policy: signal, so an un-flagged run behaves exactly as it does today. */
export const DEFAULT_RELEASE_POLICY: ReleasePolicy = "signal";

/** Environment variable selecting the policy (falls back to `signal`). */
export const RELEASE_POLICY_ENV = "RELEASE_POLICY";

/**
 * Per-row status a scenario run resolves to. `green` is the only passing
 * status; every other value is a non-green outcome the strict policy rejects
 * for a required row. `missing` and `duplicate` are not per-row statuses — they
 * are verdicts `evaluate` derives from the results set (see `RowVerdict`).
 */
export type ScenarioStatus = "green" | "skipped" | "blocked" | "expected-fail" | "cancelled" | "failed";

export const NON_GREEN_STATUSES: readonly ScenarioStatus[] = [
  "skipped",
  "blocked",
  "expected-fail",
  "cancelled",
  "failed",
];

/** A required (id, lane) row from the manifest. */
export interface RequiredRow {
  id: string;
  lane: string;
}

/** One observed scenario/lane run outcome. */
export interface ResultRow {
  id: string;
  lane: string;
  status: ScenarioStatus;
}

/** The declarative required-scenario manifest (required-workflows.json). */
export interface RequiredManifest {
  version: number;
  required: RequiredRow[];
}

/**
 * Thrown when the required manifest is itself invalid (a duplicate (id, lane)
 * pair, an empty id/lane, or a malformed file). A bad manifest is a config
 * error that fails loudly in BOTH policies — a release gate cannot trust an
 * ambiguous manifest, and a signal run should surface the misconfiguration
 * rather than silently under-checking.
 */
export class ManifestConfigError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Invalid required-scenario manifest:\n  - ${errors.join("\n  - ")}`);
    this.name = "ManifestConfigError";
    this.errors = errors;
  }
}

/** Canonical `id/lane` key used for uniqueness and result matching. */
export function requiredKey(row: RequiredRow | ResultRow): string {
  return `${row.id}/${row.lane}`;
}

/**
 * Validates manifest shape and uniqueness. Returns the list of config errors
 * (empty === valid) rather than throwing, so callers can surface every problem
 * at once; `loadRequiredManifest`/`evaluate` throw `ManifestConfigError` on a
 * non-empty result.
 */
export function validateManifest(manifest: unknown): string[] {
  const errors: string[] = [];
  if (typeof manifest !== "object" || manifest === null) {
    return ["manifest is not an object"];
  }
  const record = manifest as Record<string, unknown>;
  if (typeof record.version !== "number") {
    errors.push("`version` must be a number");
  }
  const required = record.required;
  if (!Array.isArray(required)) {
    errors.push("`required` must be an array");
    return errors;
  }
  const seen = new Set<string>();
  required.forEach((row, index) => {
    if (typeof row !== "object" || row === null) {
      errors.push(`required[${index}] is not an object`);
      return;
    }
    const { id, lane } = row as Record<string, unknown>;
    if (typeof id !== "string" || id.trim().length === 0) {
      errors.push(`required[${index}].id must be a non-empty string`);
    }
    if (typeof lane !== "string" || lane.trim().length === 0) {
      errors.push(`required[${index}].lane must be a non-empty string`);
    }
    if (typeof id === "string" && typeof lane === "string") {
      const key = `${id}/${lane}`;
      if (seen.has(key)) {
        errors.push(`duplicate required row ${key} (a manifest (id, lane) pair must be unique)`);
      }
      seen.add(key);
    }
  });
  return errors;
}

/** Path to the seeded manifest (WS10b-owned content). */
export const REQUIRED_MANIFEST_PATH = new URL("./required-workflows.json", import.meta.url);

/**
 * Reads, parses, and validates the required manifest. Throws
 * `ManifestConfigError` if the file is malformed or violates uniqueness — read
 * via fs (not a JSON import) so this stays robust across the tsx/node ESM JSON
 * import-attribute surface.
 */
export function loadRequiredManifest(pathOrUrl: URL | string = REQUIRED_MANIFEST_PATH): RequiredManifest {
  let raw: string;
  try {
    raw = readFileSync(pathOrUrl, "utf8");
  } catch (error) {
    throw new ManifestConfigError([
      `could not read manifest at ${String(pathOrUrl)}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ManifestConfigError([
      `manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  const errors = validateManifest(parsed);
  if (errors.length > 0) {
    throw new ManifestConfigError(errors);
  }
  const record = parsed as { version: number; required: RequiredRow[] };
  return { version: record.version, required: record.required.map((r) => ({ id: r.id, lane: r.lane })) };
}

/** Per-required-row verdict after comparing against the results set. */
export type RowVerdict = "green" | "missing" | "duplicate" | Exclude<ScenarioStatus, "green">;

export interface RowEvaluation {
  id: string;
  lane: string;
  verdict: RowVerdict;
  /** Human-readable detail (e.g. how many results matched). */
  detail: string;
}

export interface PolicyCounters {
  missing: number;
  skipped: number;
  blocked: number;
  expectedFail: number;
  cancelled: number;
  duplicate: number;
  failed: number;
}

export interface PolicyEvaluation {
  policy: ReleasePolicy;
  /** True when the policy is satisfied (always true in signal mode). */
  ok: boolean;
  /** Process exit code the runner should adopt for the policy gate (0 or 1). */
  exitCode: 0 | 1;
  rows: RowEvaluation[];
  counters: PolicyCounters;
  /** One line per required row that is not green (the reasons for a nonzero exit). */
  violations: string[];
}

function emptyCounters(): PolicyCounters {
  return { missing: 0, skipped: 0, blocked: 0, expectedFail: 0, cancelled: 0, duplicate: 0, failed: 0 };
}

function bumpCounter(counters: PolicyCounters, verdict: RowVerdict): void {
  switch (verdict) {
    case "missing":
      counters.missing += 1;
      break;
    case "skipped":
      counters.skipped += 1;
      break;
    case "blocked":
      counters.blocked += 1;
      break;
    case "expected-fail":
      counters.expectedFail += 1;
      break;
    case "cancelled":
      counters.cancelled += 1;
      break;
    case "duplicate":
      counters.duplicate += 1;
      break;
    case "failed":
      counters.failed += 1;
      break;
    case "green":
      break;
  }
}

/**
 * Compares the results set against the required manifest and produces a verdict
 * per required row plus policy-level counters.
 *
 * - 0 matching results for a required (id, lane) → `missing`.
 * - >1 matching results (a DUPLICATED result) → `duplicate`.
 * - exactly 1 → that result's status (green or a non-green status).
 *
 * In `release` policy the gate fails (exit 1) if any required row is not green.
 * In `signal` policy the gate is informational: `ok` is always true and the
 * exit code is 0 (the CLI keeps its own independent failure gate). Throws
 * `ManifestConfigError` if the manifest fails uniqueness/shape validation.
 */
export function evaluate(
  manifest: RequiredManifest,
  results: readonly ResultRow[],
  policy: ReleasePolicy,
): PolicyEvaluation {
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length > 0) {
    throw new ManifestConfigError(manifestErrors);
  }

  const byKey = new Map<string, ResultRow[]>();
  for (const result of results) {
    const key = requiredKey(result);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(result);
    } else {
      byKey.set(key, [result]);
    }
  }

  const rows: RowEvaluation[] = [];
  const counters = emptyCounters();
  const violations: string[] = [];

  for (const required of manifest.required) {
    const key = requiredKey(required);
    const matches = byKey.get(key) ?? [];
    let verdict: RowVerdict;
    let detail: string;
    if (matches.length === 0) {
      verdict = "missing";
      detail = "no result row for this required scenario/lane";
    } else if (matches.length > 1) {
      verdict = "duplicate";
      detail = `${matches.length} result rows for a single required scenario/lane (statuses: ${matches
        .map((m) => m.status)
        .join(", ")})`;
    } else {
      verdict = matches[0].status;
      detail = `status=${matches[0].status}`;
    }
    rows.push({ id: required.id, lane: required.lane, verdict, detail });
    bumpCounter(counters, verdict);
    if (verdict !== "green") {
      violations.push(`${key}: ${verdict} (${detail})`);
    }
  }

  if (policy === "signal") {
    return { policy, ok: true, exitCode: 0, rows, counters, violations };
  }
  const ok = violations.length === 0;
  return { policy, ok, exitCode: ok ? 0 : 1, rows, counters, violations };
}

/** Parses a policy string; empty/undefined → default (signal); unknown → throws. */
export function parseReleasePolicy(value: string | undefined | null): ReleasePolicy {
  if (value === undefined || value === null || value.trim().length === 0) {
    return DEFAULT_RELEASE_POLICY;
  }
  const normalized = value.trim();
  if (normalized === "signal" || normalized === "release") {
    return normalized;
  }
  throw new Error(
    `${RELEASE_POLICY_ENV}/--policy must be one of ${RELEASE_POLICIES.join("|")}, got "${value}"`,
  );
}
