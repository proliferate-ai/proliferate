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
}

const DEPLOYMENT_MODES: readonly DeploymentMode[] = [
  "local_dev",
  "self_managed",
  "hosted_product",
];

const SUPPORT_KINDS: readonly SupportKind[] = ["vendor", "operator", "none"];

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

  return {
    contractVersion,
    deployment: {
      mode: mode as DeploymentMode,
      displayName,
      logoUrl: safeUrl(deploymentRaw.logoUrl),
    },
    billing: asBool(raw.billing),
    usageMetering: asBool(raw.usageMetering),
    cloudWorkspaces: asBool(raw.cloudWorkspaces),
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
  };
}
