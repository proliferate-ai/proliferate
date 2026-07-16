/**
 * Minimal, mobile-owned read of the `/meta` v2 capability contract.
 *
 * Mobile depends on `@proliferate/product-domain` (the readiness resolver) but
 * NOT on `@proliferate/product-client`, where PR 2 left the full
 * `parseServerCapabilities` parser. Rather than pull the whole desktop parser
 * across the package boundary, mobile reads only the two operator-status fields
 * the readiness resolver needs — consuming the SAME wire contract. Sharing the
 * parser in a common package is deliberately out of scope for this slice and
 * tracked as tech debt (see the PR 7 spec reconciliation, point 1).
 *
 * Fail-closed: any malformed / absent capability payload resolves to
 * `disabled`, so a garbled or too-old server never reads as ready.
 *
 * Pure, DOM-free, no React, no SDK — unit-tested directly.
 */

import type { OperatorCapabilityStatus } from "@proliferate/product-domain/repos/repo-readiness";

/** The subset of managed-Cloud / GitHub-access capability the resolver needs. */
export interface MobileServerCapabilities {
  /** Operator readiness of GitHub repository discovery/authority. */
  githubRepositoryAccess: OperatorCapabilityStatus;
  /** Operator readiness of managed-Cloud workspace execution. */
  managedCloud: OperatorCapabilityStatus;
  /** App/instance display name for GitHub repository access, when declared. */
  githubRepositoryAccessDisplayName: string | null;
}

/** Conservative default: every capability off until the server declares it. */
export const DISABLED_MOBILE_CAPABILITIES: MobileServerCapabilities = {
  githubRepositoryAccess: "disabled",
  managedCloud: "disabled",
  githubRepositoryAccessDisplayName: null,
};

const OPERATOR_CAPABILITY_STATUSES: readonly OperatorCapabilityStatus[] = [
  "disabled",
  "operator_configuration_required",
  "ready",
];

/** The contract version at which the split v2 capability objects appear. */
const V2_CONTRACT_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function operatorStatus(value: unknown): OperatorCapabilityStatus | null {
  return typeof value === "string"
    && OPERATOR_CAPABILITY_STATUSES.includes(value as OperatorCapabilityStatus)
    ? (value as OperatorCapabilityStatus)
    : null;
}

function safeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse the `capabilities` block from a `GET /meta` body.
 *
 * A v2+ contract carries explicit `githubRepositoryAccess` / `managedCloud`
 * objects; a malformed declared object fails closed to `disabled` for that
 * capability. A pre-v2 contract projects both from the legacy `cloudWorkspaces`
 * boolean (true -> ready, false -> disabled), matching the desktop parser.
 * A wholly absent/garbled block resolves to fully disabled.
 */
export function parseMobileServerCapabilities(
  rawCapabilities: unknown,
): MobileServerCapabilities {
  if (!isRecord(rawCapabilities)) {
    return DISABLED_MOBILE_CAPABILITIES;
  }

  const contractVersion =
    typeof rawCapabilities.contractVersion === "number"
      ? rawCapabilities.contractVersion
      : 0;

  if (contractVersion >= V2_CONTRACT_VERSION) {
    const githubRaw = rawCapabilities.githubRepositoryAccess;
    const managedRaw = rawCapabilities.managedCloud;
    const githubStatus = isRecord(githubRaw) ? operatorStatus(githubRaw.status) : null;
    const managedStatus = isRecord(managedRaw) ? operatorStatus(managedRaw.status) : null;
    return {
      githubRepositoryAccess: githubStatus ?? "disabled",
      managedCloud: managedStatus ?? "disabled",
      githubRepositoryAccessDisplayName: isRecord(githubRaw)
        ? safeDisplayName(githubRaw.displayName)
        : null,
    };
  }

  // Pre-v2 (or version-absent) contract: project from the legacy boolean.
  const cloudWorkspaces = rawCapabilities.cloudWorkspaces === true;
  const status: OperatorCapabilityStatus = cloudWorkspaces ? "ready" : "disabled";
  return {
    githubRepositoryAccess: status,
    managedCloud: status,
    githubRepositoryAccessDisplayName: null,
  };
}

/**
 * Extract and parse the `capabilities` block from a full `/meta` response body.
 * Returns fully-disabled capabilities when the body is not an object.
 */
export function parseMobileMetaCapabilities(body: unknown): MobileServerCapabilities {
  if (!isRecord(body)) {
    return DISABLED_MOBILE_CAPABILITIES;
  }
  return parseMobileServerCapabilities(body.capabilities);
}
