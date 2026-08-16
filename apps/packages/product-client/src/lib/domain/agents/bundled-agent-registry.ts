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
