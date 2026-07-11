/**
 * Strict summary artifact (WS10a) — the signed release-evidence JSON described
 * in `specs/tbd/workflows-v1-completion-plan.md` §6 WS10.
 *
 * The runner emits this artifact; trusted CI signs it. User-provided JSON is
 * not release evidence. Fields the runner cannot know locally (SHAs, image and
 * artifact digests, versions, template ref, schema migration, CI/deploy run
 * ids) are read from environment variables and default to the `unknown`
 * placeholder when absent. In `release` policy `validateSummary` FAILS on any
 * `unknown`/empty identity field and on any nonzero non-green counter, so an
 * unsigned or under-populated artifact can never pass a promotion check. WS10c
 * reuses `validateSummary` as the promotion gate.
 */

import type {
  PolicyCounters,
  PolicyEvaluation,
  ReleasePolicy,
  RequiredManifest,
  ResultRow,
} from "./workflow-policy.js";
import { requiredKey } from "./workflow-policy.js";

/** Placeholder for an identity field CI has not populated. Fails release validation. */
export const UNKNOWN = "unknown";

/**
 * Environment-variable interface for the signed identity fields. WS10c wires CI
 * to export these against the exact merged-main artifacts before invoking the
 * runner in `release` policy; every one that is absent becomes `UNKNOWN` and
 * fails `validateSummary` in release mode.
 */
export const SUMMARY_ENV: Readonly<Record<string, string>> = {
  headSha: "RELEASE_WF_HEAD_SHA",
  serverSha: "RELEASE_WF_SERVER_SHA",
  serverImageDigest: "RELEASE_WF_SERVER_IMAGE_DIGEST",
  desktopArtifactDigest: "RELEASE_WF_DESKTOP_ARTIFACT_DIGEST",
  desktopUpdaterManifestDigest: "RELEASE_WF_DESKTOP_UPDATER_MANIFEST_DIGEST",
  runtimeVersion: "RELEASE_WF_RUNTIME_VERSION",
  workerVersion: "RELEASE_WF_WORKER_VERSION",
  templateRef: "RELEASE_WF_TEMPLATE_REF",
  schemaMigration: "RELEASE_WF_SCHEMA_MIGRATION",
  ciRunId: "RELEASE_WF_CI_RUN_ID",
  stagingDeployRunId: "RELEASE_WF_STAGING_DEPLOY_RUN_ID",
};

/** The identity fields sourced from env (order = artifact field order). */
export const SUMMARY_IDENTITY_FIELDS = [
  "headSha",
  "serverSha",
  "serverImageDigest",
  "desktopArtifactDigest",
  "desktopUpdaterManifestDigest",
  "runtimeVersion",
  "workerVersion",
  "templateRef",
  "schemaMigration",
  "ciRunId",
  "stagingDeployRunId",
] as const;

export type SummaryIdentityField = (typeof SUMMARY_IDENTITY_FIELDS)[number];

export interface SummaryArtifact {
  headSha: string;
  target: string;
  policy: ReleasePolicy;
  serverSha: string;
  serverImageDigest: string;
  desktopArtifactDigest: string;
  desktopUpdaterManifestDigest: string;
  runtimeVersion: string;
  workerVersion: string;
  templateRef: string;
  schemaMigration: string;
  ciRunId: string;
  stagingDeployRunId: string;
  required: string[];
  results: ResultRow[];
  missing: number;
  skipped: number;
  blocked: number;
  expectedFail: number;
  cancelled: number;
  duplicate: number;
  failed: number;
}

type EnvLike = Record<string, string | undefined>;

/** Resolves the env-sourced identity fields, defaulting each absent one to UNKNOWN. */
export function summaryIdentityFromEnv(env: EnvLike = process.env): Record<SummaryIdentityField, string> {
  const out = {} as Record<SummaryIdentityField, string>;
  for (const field of SUMMARY_IDENTITY_FIELDS) {
    const value = env[SUMMARY_ENV[field]];
    out[field] = value !== undefined && value.trim().length > 0 ? value.trim() : UNKNOWN;
  }
  return out;
}

export interface BuildSummaryInput {
  policy: ReleasePolicy;
  target: string;
  manifest: RequiredManifest;
  results: readonly ResultRow[];
  evaluation: PolicyEvaluation;
  env?: EnvLike;
}

/** Assembles the summary artifact from the policy evaluation plus env identity fields. */
export function buildSummary(input: BuildSummaryInput): SummaryArtifact {
  const identity = summaryIdentityFromEnv(input.env ?? process.env);
  const c: PolicyCounters = input.evaluation.counters;
  return {
    headSha: identity.headSha,
    target: input.target,
    policy: input.policy,
    serverSha: identity.serverSha,
    serverImageDigest: identity.serverImageDigest,
    desktopArtifactDigest: identity.desktopArtifactDigest,
    desktopUpdaterManifestDigest: identity.desktopUpdaterManifestDigest,
    runtimeVersion: identity.runtimeVersion,
    workerVersion: identity.workerVersion,
    templateRef: identity.templateRef,
    schemaMigration: identity.schemaMigration,
    ciRunId: identity.ciRunId,
    stagingDeployRunId: identity.stagingDeployRunId,
    required: input.manifest.required.map((row) => requiredKey(row)),
    results: input.results.map((r) => ({ id: r.id, lane: r.lane, status: r.status })),
    missing: c.missing,
    skipped: c.skipped,
    blocked: c.blocked,
    expectedFail: c.expectedFail,
    cancelled: c.cancelled,
    duplicate: c.duplicate,
    failed: c.failed,
  };
}

export interface SummaryValidation {
  ok: boolean;
  errors: string[];
}

const COUNTER_FIELDS: readonly (keyof Pick<
  SummaryArtifact,
  "missing" | "skipped" | "blocked" | "expectedFail" | "cancelled" | "duplicate" | "failed"
>)[] = ["missing", "skipped", "blocked", "expectedFail", "cancelled", "duplicate", "failed"];

/**
 * Validates a summary artifact for a given policy.
 *
 * Structural checks apply in both policies (required non-empty, results present,
 * results cover every required key exactly once). The strict identity/counter
 * checks apply only in `release`: every env-sourced identity field must be a
 * real value (not `unknown`/empty) and every non-green counter must be zero.
 * WS10c reuses this as the promotion gate.
 */
export function validateSummary(summary: SummaryArtifact, policy: ReleasePolicy): SummaryValidation {
  const errors: string[] = [];

  if (!Array.isArray(summary.required) || summary.required.length === 0) {
    errors.push("`required` must be a non-empty array");
  }
  if (!Array.isArray(summary.results)) {
    errors.push("`results` must be an array");
  }

  if (policy === "release") {
    for (const field of SUMMARY_IDENTITY_FIELDS) {
      const value = summary[field];
      if (typeof value !== "string" || value.trim().length === 0 || value === UNKNOWN) {
        errors.push(`identity field \`${field}\` is missing (${SUMMARY_ENV[field]}) — release evidence must be fully populated`);
      }
    }
    if (summary.target === UNKNOWN || summary.target.trim().length === 0) {
      errors.push("`target` must be a real lane in release evidence");
    }
    for (const counter of COUNTER_FIELDS) {
      if (summary[counter] !== 0) {
        errors.push(`counter \`${counter}\` is ${summary[counter]} — release evidence requires zero non-green rows`);
      }
    }
    // Every required key must be covered by exactly one green result.
    if (Array.isArray(summary.results)) {
      const resultKeys = new Map<string, number>();
      for (const r of summary.results) {
        const key = requiredKey(r);
        resultKeys.set(key, (resultKeys.get(key) ?? 0) + 1);
      }
      for (const requiredKeyStr of summary.required) {
        const count = resultKeys.get(requiredKeyStr) ?? 0;
        if (count === 0) {
          errors.push(`required ${requiredKeyStr} has no matching result row`);
        } else if (count > 1) {
          errors.push(`required ${requiredKeyStr} has ${count} result rows (duplicate)`);
        } else {
          const match = summary.results.find((r) => requiredKey(r) === requiredKeyStr);
          if (match && match.status !== "green") {
            errors.push(`required ${requiredKeyStr} is ${match.status}, not green`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
