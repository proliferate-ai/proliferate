import { CLOUD_COMPUTE_TEMPORARILY_DISABLED } from "./cloud-compute";
import type {
  DeploymentMode,
  PricingCapability,
  ServerCapabilityContract,
  SupportCapability,
  WebAppCapability,
} from "./server-capability-contract";

/**
 * The app-wide capability state the desktop renders from.
 *
 * Derived from the server-declared capability contract, not from mere
 * reachability. A self-managed server exposes only the capabilities its
 * operator configured; an older server (no contract) degrades conservatively.
 *
 * `cloudEnabled` intentionally stays reachability-based: a self-managed server
 * is a control plane you sign into just like Cloud, so sign-in must not be
 * gated on deployment mode. Vendor/cloud *surfaces* are gated on the more
 * specific flags below.
 */
export interface AppCapabilities {
  /** The connected control plane answered a health check. */
  reachable: boolean;
  /** Control plane usable for sign-in. True whenever reachable. */
  cloudEnabled: boolean;
  /** Vendor billing / credits / Stripe / pricing surfaces are usable. */
  billingEnabled: boolean;
  /** Consumption / usage-metering surfaces (usage bars) are meaningful. */
  usageMeteringEnabled: boolean;
  /** Cloud compute (cloud workspaces, remote access) is usable. */
  cloudComputeEnabled: boolean;
  /** The bundled agent LLM gateway is enabled on this server. */
  agentGatewayEnabled: boolean;
  /** Server-declared deployment mode. */
  deploymentMode: DeploymentMode;
  /** True when the connected server is not the hosted product. */
  isSelfManaged: boolean;
  /** Identity to show persistently for a self-managed server; null when hosted. */
  serverDisplayName: string | null;
  serverLogoUrl: string | null;
  webApp: WebAppCapability;
  support: SupportCapability;
  pricing: PricingCapability;
}

export interface DeriveAppCapabilitiesInput {
  reachable: boolean;
  /** Parsed server capability contract, or null for older/unknown servers. */
  contract: ServerCapabilityContract | null;
  /** Origin host shown as identity for a self-managed server (from apiBaseUrl). */
  connectedServerHost: string | null;
}

/** Vendor destinations used to synthesize the official-hosted fallback contract.
 * Injected (not imported) so this domain module stays config-free and testable. */
export interface OfficialHostedFallback {
  supportEmail: string;
  pricingUrl: string;
}

/**
 * Resolve the contract the desktop should render from.
 *
 * When the connected server declares a contract, that is authoritative. When
 * it does not (an older server that predates the contract), fall back on the
 * one client-side signal that is safe: whether the origin is the official
 * hosted product. An older *official* server gets the current hosted posture
 * synthesized so hosted behavior is preserved during rollout; any other origin
 * stays `null` and is treated conservatively downstream.
 */
export function resolveEffectiveContract(
  contract: ServerCapabilityContract | null,
  opts: { isOfficialOrigin: boolean; fallback: OfficialHostedFallback },
): ServerCapabilityContract | null {
  if (contract) return contract;
  if (!opts.isOfficialOrigin) return null;
  return {
    contractVersion: 0,
    deployment: { mode: "hosted_product", displayName: "", logoUrl: null },
    billing: true,
    usageMetering: true,
    cloudWorkspaces: true,
    agentGateway: true,
    webApp: { available: true, baseUrl: null },
    support: { kind: "vendor", email: opts.fallback.supportEmail, url: null },
    pricing: { available: true, url: opts.fallback.pricingUrl },
  };
}

/**
 * Pure mapping from the server capability contract (plus reachability) to the
 * app-wide capability state. No I/O — unit-tested directly.
 *
 * The official-hosted fallback for an older server that returns no contract is
 * synthesized by the hook (which knows the connected origin), so this function
 * only ever sees a real contract or `null`. A `null` contract is treated as a
 * conservative self-managed server: sign-in works, every vendor/cloud surface
 * is off until declared.
 */
export function deriveAppCapabilities(
  input: DeriveAppCapabilitiesInput,
): AppCapabilities {
  const { reachable, contract, connectedServerHost } = input;

  if (!contract) {
    return {
      reachable,
      cloudEnabled: reachable,
      billingEnabled: false,
      usageMeteringEnabled: false,
      cloudComputeEnabled: false,
      agentGatewayEnabled: false,
      deploymentMode: "self_managed",
      isSelfManaged: true,
      serverDisplayName: connectedServerHost,
      serverLogoUrl: null,
      webApp: { available: false, baseUrl: null },
      support: { kind: "none", email: null, url: null },
      pricing: { available: false, url: null },
    };
  }

  const hosted = contract.deployment.mode === "hosted_product";

  return {
    reachable,
    cloudEnabled: reachable,
    billingEnabled: reachable && contract.billing,
    usageMeteringEnabled: reachable && contract.usageMetering,
    cloudComputeEnabled:
      reachable && contract.cloudWorkspaces && !CLOUD_COMPUTE_TEMPORARILY_DISABLED,
    agentGatewayEnabled: reachable && contract.agentGateway,
    deploymentMode: contract.deployment.mode,
    isSelfManaged: !hosted,
    serverDisplayName: hosted
      ? null
      : contract.deployment.displayName || connectedServerHost,
    serverLogoUrl: hosted ? null : contract.deployment.logoUrl,
    webApp: contract.webApp,
    support: contract.support,
    pricing: contract.pricing,
  };
}
