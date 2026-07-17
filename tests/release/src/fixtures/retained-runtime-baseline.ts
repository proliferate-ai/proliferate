import type { EnvResolution } from "../config/env-resolution.js";
import {
  assertIndexReceiptsBound,
  loadIndexedRetainedReceipt,
  loadRetainedReleaseIndex,
  qualifiedReceiptExists,
  RETAINED_RELEASE_INDEX_PATH,
  RetainedReleaseError,
  validateRetainedRelease,
  type RetainedReleaseReceiptV1,
} from "../artifacts/retained-release-set.js";

/**
 * The immutable retained-production N-1 baseline a real T4-RUNTIME-1 update
 * proof updates FROM. "Retained" means the exact artifacts of the retained
 * production release — never a decremented version or a rebuilt-from-source
 * approximation (tier-4-scenario-contract.md "Artifact Identity").
 *
 * Resolution is receipt-backed (replacing the former env-only assembly):
 * `RELEASE_E2E_RETAINED_RELEASE_ID` selects a committed retained-release
 * receipt (tests/release/retained-releases/) via the append-only index; the
 * receipt is schema-validated, digest-checked, and policy-checked
 * (bootstrap_unqualified fails closed once a qualified receipt exists) before
 * any world side effect. Local runs and GitHub Actions resolve the identical
 * committed receipt — the same logical retained set with no
 * environment-specific representation. Absent a release id, the scenario
 * reports `blocked` rather than fabricating an N-1.
 */
export interface RetainedRuntimeBaseline {
  /** Immutable provider (E2B) template id of the retained N-1 sandbox image. */
  templateId: string;
  /**
   * The retained release's component manifest (JSON string): the receipt's
   * managed_runtime block plus release identity. The live proof parses it for
   * per-component version/digest.
   */
  manifest: string;
  /**
   * The version the retained AnyHarness binary ACTUALLY reports from
   * `--version` / `/health`, not merely its release tag (issue #1089: an
   * unstamped binary can never converge, so the proof compares against what
   * is observably reported). Defaults to the receipt's anyharness version
   * when a dedicated override is not supplied.
   */
  anyharnessReportedVersion: string;
  /** The full validated receipt backing this baseline. */
  receipt: RetainedReleaseReceiptV1;
  /** SHA-256 of the exact receipt file bytes (the evidence identity). */
  receiptSha256: string;
}

export const RETAINED_RELEASE_ID_ENV = "RELEASE_E2E_RETAINED_RELEASE_ID";
export const RETAINED_ANYHARNESS_REPORTED_VERSION_ENV =
  "RELEASE_E2E_RETAINED_ANYHARNESS_REPORTED_VERSION";

/** Injectable index root and policy inputs so tests never depend on committed data. */
export interface RetainedBaselineSource {
  indexPath?: string;
  /**
   * The candidate N source SHA for the N-1 != N policy check. Required
   * whenever a release id is selected: a receipt-backed baseline without a
   * known candidate identity fails closed (RR-CONTROL-003).
   */
  currentCandidateSourceSha?: string;
}

/**
 * Resolve the retained N-1 baseline, or null when no release id names one
 * (the founder-ruled default until a retained release is selected — the
 * scenario blocks honestly). A NAMED baseline that cannot be validated
 * (unknown id, unreadable/invalid receipt, index digest mismatch,
 * bootstrap-after-qualified, N-1 == N) throws RetainedReleaseError — an
 * error, never a silent block, and never a fallback.
 *
 * The release id comes from `env` — the runner's single env-resolution
 * authority (`ctx.env`), fed by the scenario's `requiredEnv`
 * (T4R-CONTROL-001). The optional reported-version override is passed
 * explicitly: it is not a gating requirement (the receipt supplies a
 * default), so it must not sit in `requiredEnv` — the scenario reads it
 * through the optional-var idiom and hands the raw value here.
 */
export function resolveRetainedRuntimeBaseline(
  env: EnvResolution,
  reportedVersionOverride?: string,
  source: RetainedBaselineSource = {},
): RetainedRuntimeBaseline | null {
  const releaseId = env.get(RETAINED_RELEASE_ID_ENV)?.trim() ?? "";
  if (releaseId.length === 0) {
    return null;
  }

  // A real update proof must know the candidate N it updates TO: without the
  // candidate source SHA the N-1 != N invariant cannot be enforced, so a
  // receipt-backed baseline fails closed rather than silently skipping it.
  const candidateSha = source.currentCandidateSourceSha?.trim() ?? "";
  if (candidateSha.length === 0) {
    throw new RetainedReleaseError(
      `Retained release "${releaseId}" was selected but no candidate source SHA was supplied; ` +
        `the N-1 != N invariant cannot be enforced without it.`,
    );
  }

  const indexPath = source.indexPath ?? RETAINED_RELEASE_INDEX_PATH;
  const index = loadRetainedReleaseIndex(indexPath);
  // Bind EVERY entry (bytes + identity/state) before deriving bootstrap
  // policy from index metadata: a mislabeled sibling entry could otherwise
  // hide an existing qualified receipt (RR-CONTROL-005).
  assertIndexReceiptsBound(index, indexPath);
  const { receipt, receiptSha256 } = loadIndexedRetainedReceipt(index, indexPath, releaseId);
  validateRetainedRelease(receipt, {
    requiredTargets: ["managed-runtime"],
    currentCandidateSourceSha: candidateSha,
    qualifiedReceiptExists: qualifiedReceiptExists(index),
  });

  const reportedOverride = reportedVersionOverride?.trim() ?? "";
  return {
    templateId: receipt.managed_runtime.immutable_template_id,
    manifest: JSON.stringify({
      release_id: receipt.release.release_id,
      source_sha: receipt.release.source_sha,
      qualification_state: receipt.release.qualification_state,
      ...receipt.managed_runtime,
    }),
    anyharnessReportedVersion:
      reportedOverride.length > 0 ? reportedOverride : receipt.managed_runtime.anyharness_version,
    receipt,
    receiptSha256,
  };
}
