/**
 * Policy-aware secret/capability preflight.
 *
 * Runs after cell/artifact selection, before any world provisioning, account
 * mutation, or provider spend. Checks only local availability and safe basic
 * shape. Never prints values; never substitutes for provider auth or health.
 * Diagnostic behavior marks only affected cells blocked; strict behavior
 * fails before any external mutation.
 */

export type RequirementKind =
  | "env-var"
  | "file"
  | "host-platform"
  | "artifact-slot";

export interface CapabilityRequirement {
  readonly kind: RequirementKind;
  /** e.g. "E2B_API_KEY", "~/.proliferate-local/dev/release-e2e.env", "darwin". */
  readonly name: string;
  /**
   * Optional safe shape check, named not inlined so evidence can cite it
   * without echoing values: "sk_test_prefix", "public_https_url", "non_empty".
   */
  readonly shape: string | null;
  /** Cell keys that require this capability. */
  readonly requiredByCellKeys: readonly string[];
}

export type RequirementStatus = "satisfied" | "missing" | "malformed";

export interface RequirementResult {
  readonly requirement: CapabilityRequirement;
  readonly status: RequirementStatus;
  /** Redacted detail — never a value. e.g. "present (56 chars)", "wrong prefix". */
  readonly detail: string;
}

export interface PreflightReport {
  readonly results: readonly RequirementResult[];
  /** Cell keys blocked by at least one unsatisfied requirement. */
  readonly blockedCellKeys: readonly string[];
  /** True when every requirement of every selected cell is satisfied. */
  readonly complete: boolean;
}
