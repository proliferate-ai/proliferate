import type { LocalHarnessKind } from "../evidence/schema.js";

/**
 * Harness kinds that ship with NO managed-gateway auth slot in the candidate
 * catalog (audit ruling #2, registry/catalog verified). Cursor carries an
 * account key, not a provider key, so it can never take a gateway selection —
 * this is a genuine product design fact (server `selection_rules.py`'s
 * `NATIVE_ONLY_HARNESSES`), not a test gap; the server's 400 on a cursor
 * gateway-selection PUT is CORRECT by design and must never be worked around.
 *
 * Every LOCAL-* collector that drives a gateway-route cell per harness
 * (LOCAL-2/T3-CHAT-1, LOCAL-4/T3-CFG-1, LOCAL-7/T3-INT-1) must short-circuit
 * these harnesses to a typed `blocked` outcome BEFORE attempting any gateway
 * selection or gateway-enrolled actor — never green-required, never silently
 * dropped, and never a hard `failed` from the server's correct 400. Single-
 * sourced here so the set and its message stay consistent across collectors
 * instead of drifting as independent ad-hoc copies.
 */
export const GATEWAY_UNSUPPORTED_HARNESSES: ReadonlySet<LocalHarnessKind> = new Set<LocalHarnessKind>(["cursor"]);

/**
 * Capability-specific qualification cells that the product cannot currently
 * prove for an otherwise gateway-capable harness. Keep these narrower than
 * `GATEWAY_UNSUPPORTED_HARNESSES`: Grok's gateway route is supported and its
 * AUTHROUTE cell must continue to run, while only the evidence contracts below
 * are temporarily unsupported.
 */
export type GatewayQualificationCapability = "chat-spend" | "config" | "integration-audit";

const TEMPORARILY_UNSUPPORTED_CAPABILITIES: ReadonlyMap<
  LocalHarnessKind,
  ReadonlySet<GatewayQualificationCapability>
> = new Map([
  ["grok", new Set<GatewayQualificationCapability>(["chat-spend", "config", "integration-audit"])],
]);

export function isGatewayQualificationCapabilityUnsupported(
  harness: LocalHarnessKind,
  capability: GatewayQualificationCapability,
): boolean {
  return GATEWAY_UNSUPPORTED_HARNESSES.has(harness)
    || (TEMPORARILY_UNSUPPORTED_CAPABILITIES.get(harness)?.has(capability) ?? false);
}

/**
 * The shared typed-unsupported message body for a gateway-unsupported
 * harness. `context` names the specific cell/journey action that cannot run
 * (e.g. "its LOCAL-4 baseline turn cannot run on the gateway-enrolled world"),
 * so each collector's message stays truthful and specific while sharing the
 * same underlying fact and wording pattern.
 */
export function gatewayUnsupportedMessage(harness: LocalHarnessKind, context: string): string {
  return (
    `[${harness}] ships with no gateway auth slot; ${context} (typed unsupported: it carries an account key, ` +
    "not a provider key)"
  );
}

/** Returns the truthful typed-unsupported reason for one qualification cell. */
export function gatewayQualificationUnsupportedMessage(
  harness: LocalHarnessKind,
  capability: GatewayQualificationCapability,
  context: string,
): string | null {
  if (GATEWAY_UNSUPPORTED_HARNESSES.has(harness)) {
    return gatewayUnsupportedMessage(harness, context);
  }
  if (!TEMPORARILY_UNSUPPORTED_CAPABILITIES.get(harness)?.has(capability)) {
    return null;
  }

  const fact: Record<GatewayQualificationCapability, string> = {
    "chat-spend":
      "the live Grok turn succeeds, but LiteLLM currently emits no attributable token or spend totals for the cell",
    config:
      "the live Grok probe currently exposes only one model and no independently settable qualification control",
    "integration-audit":
      "the live Grok integration call currently emits no post-baseline product audit row",
  };
  return `[${harness}] ${context} (typed unsupported, temporary product policy: ${fact[capability]})`;
}
