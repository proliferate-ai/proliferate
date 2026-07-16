import type { EnvResolution } from "../config/env-resolution.js";

/**
 * The immutable retained-production N-1 baseline a real T4-RUNTIME-1 update
 * proof updates FROM. "Retained" means the exact artifacts of the last release
 * actually qualified through this platform — never a decremented version or a
 * rebuilt-from-source approximation (tier-4-scenario-contract.md "Shared Tier 4
 * rules": "N-1 always means the last qualified production artifacts").
 *
 * The mechanism that publishes and retains such a baseline does not exist yet
 * (release-worlds-and-fixtures.md defers the retained manifest as later work),
 * so `resolveRetainedRuntimeBaseline` returns null whenever the inputs are
 * absent and the scenario reports `blocked` rather than fabricating an N-1.
 * When the inputs ARE supplied, they name a real immutable E2B template and the
 * manifest describing its component versions/digests.
 */
export interface RetainedRuntimeBaseline {
  /** Immutable provider (E2B) template id of the retained N-1 sandbox image. */
  templateId: string;
  /**
   * The retained release's component manifest, verbatim as supplied
   * (JSON string). The live proof parses it for per-component version/digest;
   * kept opaque here so this resolver stays a thin, secret-free input gate.
   */
  manifest: string;
  /**
   * The version the retained AnyHarness binary ACTUALLY reports from
   * `--version` / `/health`, not merely its release tag. The supervisor
   * health-gate and worker `--version` probe assert an exact match to the
   * requested version (R9R-001 / R9-008); a binary that is not version-stamped
   * (issue #1089) can never converge, so the proof must compare against what is
   * observably reported. Defaults to the template id's declared version when a
   * dedicated override is not supplied.
   */
  anyharnessReportedVersion: string;
}

export const RETAINED_TEMPLATE_ID_ENV = "RELEASE_E2E_RETAINED_TEMPLATE_ID";
export const RETAINED_MANIFEST_ENV = "RELEASE_E2E_RETAINED_MANIFEST";
export const RETAINED_ANYHARNESS_REPORTED_VERSION_ENV =
  "RELEASE_E2E_RETAINED_ANYHARNESS_REPORTED_VERSION";

/**
 * Resolve the retained N-1 baseline from the runner-resolved environment, or
 * null when the inputs are absent (the founder-ruled default until a real
 * qualified release is retained). Both the template id and the manifest must be
 * present and non-empty; a half-supplied baseline is treated as absent so a
 * partial environment blocks cleanly rather than running against an incoherent
 * N-1.
 *
 * The two gating inputs come from `env` — the runner's single env-resolution
 * authority (`ctx.env`), which the scenario feeds by declaring both names in
 * its `requiredEnv` (T4R-CONTROL-001). The optional reported-version override
 * is passed explicitly: it is not a gating requirement (the manifest supplies a
 * default), so it must not sit in `requiredEnv` — the scenario reads it through
 * the optional-var idiom and hands the raw value here, keeping this resolver
 * free of any second, undeclared env read.
 */
export function resolveRetainedRuntimeBaseline(
  env: EnvResolution,
  reportedVersionOverride?: string,
): RetainedRuntimeBaseline | null {
  const templateId = env.get(RETAINED_TEMPLATE_ID_ENV)?.trim() ?? "";
  const manifest = env.get(RETAINED_MANIFEST_ENV)?.trim() ?? "";
  if (templateId.length === 0 || manifest.length === 0) {
    return null;
  }
  const reportedOverride = reportedVersionOverride?.trim() ?? "";
  return {
    templateId,
    manifest,
    anyharnessReportedVersion:
      reportedOverride.length > 0 ? reportedOverride : deriveReportedVersion(manifest),
  };
}

/**
 * Best-effort read of the AnyHarness version the manifest declares, used only
 * when no explicit reported-version override is given. Never throws: an
 * unparseable manifest yields an empty string, which the scenario asserts
 * against so a malformed baseline blocks rather than proceeding on a guess.
 */
function deriveReportedVersion(manifest: string): string {
  try {
    const parsed: unknown = JSON.parse(manifest);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const anyharness = record.anyharness;
      if (anyharness && typeof anyharness === "object") {
        const version = (anyharness as Record<string, unknown>).version;
        if (typeof version === "string") {
          return version.trim();
        }
      }
      if (typeof record.anyharnessVersion === "string") {
        return record.anyharnessVersion.trim();
      }
    }
  } catch {
    return "";
  }
  return "";
}
