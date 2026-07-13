/**
 * Rolling-reference rejection.
 *
 * Frozen contract (contracts/artifacts.ts, release-worlds-and-fixtures.md
 * "Candidate Artifacts"): "Rolling references such as `latest` or unverified
 * `stable` cannot satisfy an artifact slot." This module is the one place
 * that decides whether a locator/template-id string counts as rolling, so
 * every manifest validator in this package applies the same rule.
 */

const ROLLING_TOKENS = ["latest", "stable"] as const;

/**
 * True when `value` is empty, or is/ends in a bare rolling-reference token as
 * a whole path segment or tag — not merely a substring. So
 * `s3://bucket/stable-branch/build.tar.gz` is NOT rolling (the token is part
 * of a longer segment), but `s3://bucket/candidate/latest`,
 * `ghcr.io/proliferate/server:stable`, and the bare string `latest` ARE.
 */
export function isRollingReference(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  for (const token of ROLLING_TOKENS) {
    if (lower === token) {
      return true;
    }
    if (lower.endsWith(`/${token}`) || lower.endsWith(`:${token}`)) {
      return true;
    }
  }
  return false;
}

/** Human-readable rejection reason, or null when `value` is not a rolling reference. */
export function rollingReferenceReason(value: string): string | null {
  if (!isRollingReference(value)) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "locator/template id is empty";
  }
  return `"${trimmed}" is a rolling reference — "latest"/"stable" can never satisfy a verifiable slot`;
}
