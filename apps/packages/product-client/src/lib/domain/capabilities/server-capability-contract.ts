/**
 * The server-declared self-host capability contract, as it arrives on the
 * public `GET /meta` `capabilities` block.
 *
 * This is the source of truth for what the desktop renders. The desktop must
 * not infer Cloud/billing/gateway from mere reachability — a self-managed
 * server declares only the capabilities its operator configured. An older
 * server omits this block entirely; the parser returns `null` for anything
 * that is not a well-formed contract, and the derivation layer degrades
 * conservatively.
 *
 * Pure domain: no React, no access, no platform APIs.
 */

export type DeploymentMode = "local_dev" | "self_managed" | "hosted_product";

export type SupportKind = "vendor" | "operator" | "none";

export interface DeploymentIdentity {
  mode: DeploymentMode;
  /** Operator instance name; empty means "use the connected origin". */
  displayName: string;
  logoUrl: string | null;
}

export interface WebAppCapability {
  available: boolean;
  baseUrl: string | null;
}

export interface SupportCapability {
  kind: SupportKind;
  email: string | null;
  url: string | null;
}

export interface PricingCapability {
  available: boolean;
  url: string | null;
}

/**
 * Operator readiness of a deployment capability. Mirrors the v2 wire enum
 * (`OperatorCapabilityStatus`) so the resolver can consume it directly.
 */
export type OperatorCapabilityStatus =
  | "disabled"
  | "operator_configuration_required"
  | "ready";

/** Operator readiness of GitHub repository discovery/authority (v2). */
export interface GitHubRepositoryAccessCapability {
  status: OperatorCapabilityStatus;
  provider: "github_app" | null;
  displayName: string | null;
}

/**
 * Operator readiness of managed-Cloud workspace execution.
 *
 * `source` records how the status was derived so downstream owners can tell an
 * explicit v2 declaration apart from a v1/absent "legacy-ready" projection.
 */
export interface ManagedCloudCapability {
  status: OperatorCapabilityStatus;
  repositoryAuthority: "github_app" | null;
  source: "v2" | "legacy";
}

export interface ServerCapabilityContract {
  contractVersion: number;
  deployment: DeploymentIdentity;
  billing: boolean;
  usageMetering: boolean;
  cloudWorkspaces: boolean;
  agentGateway: boolean;
  webApp: WebAppCapability;
  support: SupportCapability;
  pricing: PricingCapability;
  githubRepositoryAccess: GitHubRepositoryAccessCapability;
  managedCloud: ManagedCloudCapability;
}

const DEPLOYMENT_MODES: readonly DeploymentMode[] = [
  "local_dev",
  "self_managed",
  "hosted_product",
];

const SUPPORT_KINDS: readonly SupportKind[] = ["vendor", "operator", "none"];

const OPERATOR_CAPABILITY_STATUSES: readonly OperatorCapabilityStatus[] = [
  "disabled",
  "operator_configuration_required",
  "ready",
];

/** The contract version at which the split GitHub-access / managed-Cloud
 * capability objects first appear on the wire. */
const V2_CONTRACT_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A trimmed non-empty https(s)/mailto string, or null. Blocks unsafe schemes. */
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("mailto:")
  ) {
    return trimmed;
  }
  return null;
}

function safeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.includes("@") ? trimmed : null;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function operatorStatus(value: unknown): OperatorCapabilityStatus | null {
  return typeof value === "string"
    && OPERATOR_CAPABILITY_STATUSES.includes(value as OperatorCapabilityStatus)
    ? (value as OperatorCapabilityStatus)
    : null;
}

function repositoryAuthority(value: unknown): "github_app" | null {
  return value === "github_app" ? "github_app" : null;
}

function safeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse the explicit v2 `githubRepositoryAccess` object. Returns `null` when
 * the object is absent or its status is malformed, so the caller can fail
 * closed (a v2/future server that declares the field but garbles it must not be
 * read as ready).
 */
function parseGitHubRepositoryAccess(
  raw: unknown,
): GitHubRepositoryAccessCapability | null {
  if (!isRecord(raw)) return null;
  const status = operatorStatus(raw.status);
  if (!status) return null;
  return {
    status,
    provider: repositoryAuthority(raw.provider),
    displayName: safeDisplayName(raw.displayName),
  };
}

/**
 * Parse the explicit v2 `managedCloud` object. Returns `null` when the object
 * is absent or its status is malformed so the caller can fail closed.
 */
function parseManagedCloud(raw: unknown): ManagedCloudCapability | null {
  if (!isRecord(raw)) return null;
  const status = operatorStatus(raw.status);
  if (!status) return null;
  return {
    status,
    repositoryAuthority: repositoryAuthority(raw.repositoryAuthority),
    source: "v2",
  };
}

/**
 * Synthesize the split capabilities for a pre-v2 (or version-declared but
 * fields-absent) contract from the legacy `cloudWorkspaces` boolean. A legacy
 * server that advertised Cloud implicitly had GitHub repository access ready;
 * one that did not is disabled on both. Marked `source: "legacy"` so owners can
 * distinguish a real v2 declaration from this projection.
 */
function legacyCapabilities(cloudWorkspaces: boolean): {
  githubRepositoryAccess: GitHubRepositoryAccessCapability;
  managedCloud: ManagedCloudCapability;
} {
  const status: OperatorCapabilityStatus = cloudWorkspaces ? "ready" : "disabled";
  return {
    githubRepositoryAccess: {
      status,
      provider: cloudWorkspaces ? "github_app" : null,
      displayName: null,
    },
    managedCloud: {
      status,
      repositoryAuthority: cloudWorkspaces ? "github_app" : null,
      source: "legacy",
    },
  };
}

const DISABLED_CAPABILITIES = legacyCapabilities(false);

/**
 * Normalize the raw `/meta` `capabilities` object into a validated contract.
 *
 * Returns `null` when the block is absent or not a well-formed contract (older
 * servers, garbage) so callers fall back to conservative defaults. Individual
 * unknown/invalid fields default to their conservative value rather than
 * failing the whole parse, so a newer server that adds fields still parses.
 */
export function parseServerCapabilities(
  raw: unknown,
): ServerCapabilityContract | null {
  if (!isRecord(raw)) return null;

  const deploymentRaw = raw.deployment;
  if (!isRecord(deploymentRaw)) return null;

  const mode = deploymentRaw.mode;
  if (typeof mode !== "string" || !DEPLOYMENT_MODES.includes(mode as DeploymentMode)) {
    return null;
  }

  const contractVersion =
    typeof raw.contractVersion === "number" ? raw.contractVersion : 0;

  const displayName =
    typeof deploymentRaw.displayName === "string"
      ? deploymentRaw.displayName.trim()
      : "";

  const webAppRaw = isRecord(raw.webApp) ? raw.webApp : {};
  const supportRaw = isRecord(raw.support) ? raw.support : {};
  const pricingRaw = isRecord(raw.pricing) ? raw.pricing : {};

  const supportKind =
    typeof supportRaw.kind === "string" &&
    SUPPORT_KINDS.includes(supportRaw.kind as SupportKind)
      ? (supportRaw.kind as SupportKind)
      : "none";

  const cloudWorkspaces = asBool(raw.cloudWorkspaces);

  // Version-aware capability interpretation. A v2+ contract carries the split
  // GitHub-access / managed-Cloud objects; consume them exactly and ignore any
  // unknown future fields. When a declared v2 object is malformed/absent, fail
  // closed to `disabled` for that capability rather than trusting it. A pre-v2
  // contract projects the two capabilities from the legacy `cloudWorkspaces`
  // boolean (true -> legacy-ready, false -> disabled). The absent-contract
  // official-origin fallback lives one layer up in `resolveEffectiveContract`.
  const legacy = legacyCapabilities(cloudWorkspaces);
  const isV2OrLater = contractVersion >= V2_CONTRACT_VERSION;
  const githubRepositoryAccess = isV2OrLater
    ? parseGitHubRepositoryAccess(raw.githubRepositoryAccess)
      ?? DISABLED_CAPABILITIES.githubRepositoryAccess
    : legacy.githubRepositoryAccess;
  const managedCloud = isV2OrLater
    ? parseManagedCloud(raw.managedCloud) ?? DISABLED_CAPABILITIES.managedCloud
    : legacy.managedCloud;

  return {
    contractVersion,
    deployment: {
      mode: mode as DeploymentMode,
      displayName,
      logoUrl: safeUrl(deploymentRaw.logoUrl),
    },
    billing: asBool(raw.billing),
    usageMetering: asBool(raw.usageMetering),
    cloudWorkspaces,
    agentGateway: asBool(raw.agentGateway),
    webApp: {
      available: asBool(webAppRaw.available),
      baseUrl: safeUrl(webAppRaw.baseUrl),
    },
    support: {
      kind: supportKind,
      email: safeEmail(supportRaw.email),
      url: safeUrl(supportRaw.url),
    },
    pricing: {
      available: asBool(pricingRaw.available),
      url: safeUrl(pricingRaw.url),
    },
    githubRepositoryAccess,
    managedCloud,
  };
}
