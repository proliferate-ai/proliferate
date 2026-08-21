// Package-relative copy emitted by scripts/copy-product-client-assets.mjs from
// the repo-root catalogs/agents/registry.json (gitignored; no checked-in
// duplicate). registry.json is the single allow-list authority (agent-auth.md
// FR-4): the harness-kind allow-list, the gateway-capable set, and the
// single-vs-multi cardinality all derive from it here instead of being
// re-literalled in the client.
import bundledAgentRegistryJson from "../../../generated/agent-registry.json?raw";

interface RegistryAuthSlot {
  id: string;
}

interface RegistryAgent {
  kind: string;
  displayName?: string;
  authCardinality?: "single" | "multi";
  auth?: { slots?: RegistryAuthSlot[] } | null;
}

interface RegistryDocument {
  agents?: RegistryAgent[];
}

const REGISTRY: RegistryDocument = JSON.parse(bundledAgentRegistryJson);

const AGENTS: readonly RegistryAgent[] = REGISTRY.agents ?? [];

const HARNESS_KINDS: ReadonlySet<string> = new Set(AGENTS.map((agent) => agent.kind));

// Gateway capability is the presence of an auth slot with id "gateway" (cursor
// has none — no gateway route exists for it). A positive allow-list, so a
// future harness with no gateway recipe fails closed by default.
const GATEWAY_CAPABLE_KINDS: ReadonlySet<string> = new Set(
  AGENTS.filter((agent) => (agent.auth?.slots ?? []).some((slot) => slot.id === "gateway"))
    .map((agent) => agent.kind),
);

// Multi-source harnesses (opencode today) keep gateway + any number of api_key
// rows enabled at once; everything else is single-source (radio). Declared
// explicitly in the registry because deriving multiplicity from slot count is
// fragile.
const MULTI_SOURCE_KINDS: ReadonlySet<string> = new Set(
  AGENTS.filter((agent) => agent.authCardinality === "multi").map((agent) => agent.kind),
);

// Human-facing name per kind, straight from the same registry row that
// declares the kind. Client-side name maps were the last re-literalling of
// registry.json left in this package, and they silently degrade: an agent the
// catalog ships but the map has never heard of (grok, then whatever is sixth)
// printed its bare wire kind — "grok is ready." — in whatever surface named
// it. Sourcing the name where the kind is declared means a new catalog agent
// is named correctly with no client change at all.
const DISPLAY_NAMES: ReadonlyMap<string, string> = new Map(
  AGENTS
    .filter((agent) => typeof agent.displayName === "string" && agent.displayName.length > 0)
    .map((agent) => [agent.kind, agent.displayName as string] as const),
);

export function getRegistryHarnessKinds(): string[] {
  return [...HARNESS_KINDS];
}

export function isRegistryHarnessKind(harnessKind: string): boolean {
  return HARNESS_KINDS.has(harnessKind);
}

export function isGatewayCapableHarness(harnessKind: string): boolean {
  return GATEWAY_CAPABLE_KINDS.has(harnessKind);
}

export function isMultiSourceHarness(harnessKind: string): boolean {
  return MULTI_SOURCE_KINDS.has(harnessKind);
}

/**
 * The registry's declared display name for a harness kind, or null when the
 * kind is not in the catalog at all. Callers own the fallback for that case;
 * see getProviderDisplayName.
 */
export function getRegistryAgentDisplayName(harnessKind: string): string | null {
  return DISPLAY_NAMES.get(harnessKind) ?? null;
}
