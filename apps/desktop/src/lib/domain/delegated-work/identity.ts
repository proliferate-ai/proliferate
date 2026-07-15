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

export function delegatedWorkVisualIdentity(id: string): DelegatedWorkVisualIdentity {
  // Name and color come from the same seed but are decoupled: the color uses an
  // avalanche mix of the seed hash so a name collision does not also force a color
  // collision. A naive second hash stays correlated here because there are 8 colors
  // and 40 names (8 divides 40), so the color must depend on the hash's high bits.
  const seedHash = stableIndex(id);
  const generatedName = FRIENDLY_NAMES[seedHash % FRIENDLY_NAMES.length] ?? "Mary";
  const color = COLOR_IDENTITIES[mixHash(seedHash) % COLOR_IDENTITIES.length] ?? COLOR_IDENTITIES[0];
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
}: {
  id: string;
  title: string | null | undefined;
  workspaceId?: string | null;
  sessionId?: string | null;
  sessionLinkId?: string | null;
}): DelegatedAgentIdentity {
  const seed = sessionLinkId?.trim() || sessionId?.trim() || id;
  const visual = delegatedWorkVisualIdentity(seed);
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
    iconSeedHash: visual.iconSeedHash,
    openTarget: sessionId
      ? {
        workspaceId: workspaceId ?? null,
        sessionId,
        sessionLinkId: sessionLinkId ?? null,
      } satisfies DelegatedAgentOpenTarget
      : null,
  };
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
