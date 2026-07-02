import type {
  DelegatedAgentIdentity,
  DelegatedAgentOpenTarget,
} from "@/lib/domain/delegated-work/model";

const FRIENDLY_NAMES = [
  "Mary",
  "Allen",
  "Jeremy",
  "Nina",
  "Sam",
  "Priya",
  "Alex",
  "Maya",
  "Leo",
  "Vera",
  "Omar",
  "Iris",
  "Hugo",
  "Tara",
  "Ravi",
  "Elsa",
  "Cole",
  "Anya",
  "Felix",
  "Noor",
  "Dean",
  "Lena",
  "Kira",
  "Marco",
  "Sana",
  "Theo",
  "June",
  "Raj",
  "Bella",
  "Ivan",
  "Zara",
  "Luca",
  "Gwen",
  "Otto",
  "Mira",
  "Neil",
  "Rosa",
  "Emil",
  "Yuki",
  "Dora",
];

const COLOR_IDENTITIES = [
  {
    token: "delegated-agent-1",
    colorClassName: "bg-delegated-agent-1",
    textColorClassName: "text-delegated-agent-1",
    borderColorClassName: "border-delegated-agent-1",
    colorVar: "var(--color-delegated-agent-1)",
  },
  {
    token: "delegated-agent-2",
    colorClassName: "bg-delegated-agent-2",
    textColorClassName: "text-delegated-agent-2",
    borderColorClassName: "border-delegated-agent-2",
    colorVar: "var(--color-delegated-agent-2)",
  },
  {
    token: "delegated-agent-3",
    colorClassName: "bg-delegated-agent-3",
    textColorClassName: "text-delegated-agent-3",
    borderColorClassName: "border-delegated-agent-3",
    colorVar: "var(--color-delegated-agent-3)",
  },
  {
    token: "delegated-agent-4",
    colorClassName: "bg-delegated-agent-4",
    textColorClassName: "text-delegated-agent-4",
    borderColorClassName: "border-delegated-agent-4",
    colorVar: "var(--color-delegated-agent-4)",
  },
  {
    token: "delegated-agent-5",
    colorClassName: "bg-delegated-agent-5",
    textColorClassName: "text-delegated-agent-5",
    borderColorClassName: "border-delegated-agent-5",
    colorVar: "var(--color-delegated-agent-5)",
  },
  {
    token: "delegated-agent-6",
    colorClassName: "bg-delegated-agent-6",
    textColorClassName: "text-delegated-agent-6",
    borderColorClassName: "border-delegated-agent-6",
    colorVar: "var(--color-delegated-agent-6)",
  },
  {
    token: "delegated-agent-7",
    colorClassName: "bg-delegated-agent-7",
    textColorClassName: "text-delegated-agent-7",
    borderColorClassName: "border-delegated-agent-7",
    colorVar: "var(--color-delegated-agent-7)",
  },
  {
    token: "delegated-agent-8",
    colorClassName: "bg-delegated-agent-8",
    textColorClassName: "text-delegated-agent-8",
    borderColorClassName: "border-delegated-agent-8",
    colorVar: "var(--color-delegated-agent-8)",
  },
  {
    token: "delegated-agent-9",
    colorClassName: "bg-delegated-agent-9",
    textColorClassName: "text-delegated-agent-9",
    borderColorClassName: "border-delegated-agent-9",
    colorVar: "var(--color-delegated-agent-9)",
  },
  {
    token: "delegated-agent-10",
    colorClassName: "bg-delegated-agent-10",
    textColorClassName: "text-delegated-agent-10",
    borderColorClassName: "border-delegated-agent-10",
    colorVar: "var(--color-delegated-agent-10)",
  },
  {
    token: "delegated-agent-11",
    colorClassName: "bg-delegated-agent-11",
    textColorClassName: "text-delegated-agent-11",
    borderColorClassName: "border-delegated-agent-11",
    colorVar: "var(--color-delegated-agent-11)",
  },
  {
    token: "delegated-agent-12",
    colorClassName: "bg-delegated-agent-12",
    textColorClassName: "text-delegated-agent-12",
    borderColorClassName: "border-delegated-agent-12",
    colorVar: "var(--color-delegated-agent-12)",
  },
  {
    token: "delegated-agent-13",
    colorClassName: "bg-delegated-agent-13",
    textColorClassName: "text-delegated-agent-13",
    borderColorClassName: "border-delegated-agent-13",
    colorVar: "var(--color-delegated-agent-13)",
  },
  {
    token: "delegated-agent-14",
    colorClassName: "bg-delegated-agent-14",
    textColorClassName: "text-delegated-agent-14",
    borderColorClassName: "border-delegated-agent-14",
    colorVar: "var(--color-delegated-agent-14)",
  },
  {
    token: "delegated-agent-15",
    colorClassName: "bg-delegated-agent-15",
    textColorClassName: "text-delegated-agent-15",
    borderColorClassName: "border-delegated-agent-15",
    colorVar: "var(--color-delegated-agent-15)",
  },
  {
    token: "delegated-agent-16",
    colorClassName: "bg-delegated-agent-16",
    textColorClassName: "text-delegated-agent-16",
    borderColorClassName: "border-delegated-agent-16",
    colorVar: "var(--color-delegated-agent-16)",
  },
] as const;

export interface DelegatedWorkVisualIdentity {
  generatedName: string;
  initial: string;
  colorClassName: string;
  textColorClassName: string;
  borderColorClassName: string;
  colorToken: string;
  colorVar: string;
  iconSeedHash: number;
}

export const DELEGATED_AGENT_COLOR_COUNT = COLOR_IDENTITIES.length;

// Hashed color index used when no sibling-assigned index is provided: an
// avalanche mix of the seed hash so a name collision does not also force a
// color collision. A naive second hash stays correlated here because the
// palette size divides the 40-name pool, so the color must depend on the
// hash's high bits.
export function delegatedColorIndexFromSeed(seed: string): number {
  return mixHash(stableIndex(seed)) % COLOR_IDENTITIES.length;
}

// Sibling-aware color assignment: the position in the ordered sibling list IS
// the color (pure index), so up to DELEGATED_AGENT_COLOR_COUNT simultaneous
// siblings never repeat a color — a guarantee per-agent hashing cannot give
// (birthday paradox). Past the palette size colors must repeat (pigeonhole);
// the identicon shape keeps those siblings distinguishable.
export function assignDistinctDelegatedColorIndices(
  orderedSeeds: readonly string[],
): Map<string, number> {
  const out = new Map<string, number>();
  orderedSeeds.forEach((seed, index) => {
    if (!out.has(seed)) {
      out.set(seed, index % COLOR_IDENTITIES.length);
    }
  });
  return out;
}

export function delegatedWorkVisualIdentity(
  id: string,
  colorIndex?: number,
): DelegatedWorkVisualIdentity {
  const seedHash = stableIndex(id);
  const generatedName = FRIENDLY_NAMES[seedHash % FRIENDLY_NAMES.length] ?? "Mary";
  // A sibling-assigned colorIndex wins: only a pass that sees the whole
  // ordered sibling list can hand out distinct colors. The hashed index is the
  // fallback for callers that know a single agent in isolation.
  const resolvedColorIndex = isAssignableColorIndex(colorIndex)
    ? colorIndex
    : delegatedColorIndexFromSeed(id);
  const color = COLOR_IDENTITIES[resolvedColorIndex] ?? COLOR_IDENTITIES[0];
  return {
    generatedName,
    initial: generatedName.slice(0, 1),
    colorClassName: color.colorClassName,
    textColorClassName: color.textColorClassName,
    borderColorClassName: color.borderColorClassName,
    colorToken: color.token,
    colorVar: color.colorVar,
    iconSeedHash: seedHash,
  };
}

export function buildDelegatedAgentIdentity({
  id,
  title,
  workspaceId,
  sessionId,
  sessionLinkId,
  colorIndex,
  shapeSalt,
}: {
  id: string;
  title: string | null | undefined;
  workspaceId?: string | null;
  sessionId?: string | null;
  sessionLinkId?: string | null;
  colorIndex?: number;
  shapeSalt?: number;
}): DelegatedAgentIdentity {
  const seed = resolveDelegatedIdentitySeed({ id, sessionId, sessionLinkId });
  const visual = delegatedWorkVisualIdentity(seed, colorIndex);
  const resolvedTitle = normalizeTitle(title);
  const shortId = shortDelegatedWorkId(seed);
  return {
    id,
    generatedName: visual.generatedName,
    initial: visual.initial,
    title: resolvedTitle,
    shortId,
    displayName: `${visual.generatedName} (${resolvedTitle} ${shortId})`,
    colorToken: visual.colorToken,
    colorClassName: visual.colorClassName,
    textColorClassName: visual.textColorClassName,
    borderColorClassName: visual.borderColorClassName,
    colorVar: visual.colorVar,
    iconSeedHash: identiconSeedFromSalt(visual.iconSeedHash, shapeSalt ?? 0),
    openTarget: sessionId
      ? {
        workspaceId: workspaceId ?? null,
        sessionId,
        sessionLinkId: sessionLinkId ?? null,
      } satisfies DelegatedAgentOpenTarget
      : null,
  };
}

// The seed every visual trait derives from; sessionLinkId is the stable
// cross-surface handle, so it wins over the session id and the raw id.
export function resolveDelegatedIdentitySeed(input: {
  id: string;
  sessionId?: string | null;
  sessionLinkId?: string | null;
}): string {
  return input.sessionLinkId?.trim() || input.sessionId?.trim() || input.id;
}

// Salt 0 is the agent's natural fingerprint seed; positive salts perturb it
// deterministically. The sibling pass probes salts to break exact identicon
// collisions while leaving non-colliding agents untouched. Lives here (not in
// identicon.ts) so the identity builder can fold the salt without a circular
// import — identicon.ts already imports from this module.
export function identiconSeedFromSalt(seedHash: number, salt: number): number {
  if (salt <= 0) {
    return seedHash >>> 0;
  }
  return mixHash((seedHash ^ Math.imul(salt, 0x9e3779b1)) >>> 0);
}

function isAssignableColorIndex(colorIndex: number | undefined): colorIndex is number {
  return colorIndex !== undefined
    && Number.isInteger(colorIndex)
    && colorIndex >= 0
    && colorIndex < COLOR_IDENTITIES.length;
}

export function shortDelegatedWorkId(id: string | null | undefined): string {
  const normalized = id?.trim() ?? "";
  const withoutPrefix = normalized
    .replace(/^(client-session|pending-session|subagent|review|cowork|session|link)[:_-]+/u, "")
    .replace(/[^a-zA-Z0-9]+/gu, "");
  const compact = withoutPrefix || normalized.replace(/[^a-zA-Z0-9]+/gu, "");
  return compact.length > 6 ? compact.slice(0, 6) : compact || "agent";
}

function normalizeTitle(title: string | null | undefined): string {
  const trimmed = title?.replace(/\s+/gu, " ").trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Agent";
}

export function stableIndex(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

// 32-bit avalanche finalizer (splitmix-style): spreads every input bit across the
// output so a value derived from it (the color index) does not stay correlated with
// the low bits that the name index already consumes.
export function mixHash(hash: number): number {
  let value = hash >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}
