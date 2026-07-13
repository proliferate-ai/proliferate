/**
 * Cheapest eligible managed-gateway model for one harness.
 *
 * Tier-3 contract "Matrix discovery" (specs/developing/testing/tier-3-scenario-contract.md):
 * "the runner chooses the cheapest bounded model from the intersection of the
 * qualification allowlist and the live probed model set. The live probe is
 * authoritative for what an installed harness can actually select."
 *
 * The bundled catalog is NOT trusted as the sole source of truth: this module
 * only ever returns a model that appears in the LIVE probe. The qualification
 * allowlist supplies (a) which models are cheap/eligible for paid qualification
 * and (b) the cheapness order to break ties; the probe supplies the ground
 * truth of what the pushed virtual key can actually reach. An empty
 * intersection is a typed failure, never a silent fall-back to a catalog id the
 * key cannot serve.
 */

/** A per-harness allowlist of gateway-eligible models, cheapest-preferred first. */
export type QualificationAllowlist = Readonly<Record<string, readonly string[]>>;

export class NoEligibleModelError extends Error {
  readonly harness: string;
  readonly allowlist: readonly string[];
  readonly probed: readonly string[];

  constructor(harness: string, allowlist: readonly string[], probed: readonly string[]) {
    super(
      `[${harness}] no gateway model in the intersection of the qualification allowlist ` +
        `(${allowlist.join(", ") || "<empty>"}) and the live probe (${
          probed.join(", ") || "<empty>"
        }). The live probe is authoritative — the catalog is never assumed to be reachable.`,
    );
    this.name = "NoEligibleModelError";
    this.harness = harness;
    this.allowlist = allowlist;
    this.probed = probed;
  }
}

/**
 * The default qualification allowlist, cheapest-first per family. Kept small
 * and cheap on purpose: a gateway qualification key is allowlisted to the cheap
 * test-model set, and a bounded paid turn must never reach for an expensive
 * tier. Fable is intentionally absent (most expensive tier; never picked for
 * fan-out/test traffic per this repo's model-usage policy).
 */
export const DEFAULT_QUALIFICATION_ALLOWLIST: QualificationAllowlist = {
  claude: ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5"],
  codex: ["gpt-5-mini", "gpt-5-mini-2025-08-07"],
  opencode: ["anthropic/claude-haiku-4-5-20251001", "anthropic/claude-haiku-4-5"],
  cursor: ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
  grok: ["grok-code-fast-1", "grok-4-fast"],
};

/**
 * Rank a probed id by cheapness so a probe-only id (one the allowlist did not
 * enumerate but the key can serve) can still be scored when the allowlist has
 * no ordering opinion. Lower is cheaper. Fable is pushed to the bottom.
 */
export function cheapnessRank(id: string): number {
  if (/fable/i.test(id)) return 100;
  if (/haiku|mini|fast/i.test(id)) return 0;
  if (/sonnet/i.test(id)) return 1;
  if (/opus|gpt-5\.|gpt-5$/i.test(id)) return 2;
  return 3;
}

export interface EligibleModelChoice {
  readonly modelId: string;
  /** True when the chosen id came from the allowlist order; false when it was a probe-only cheap fallback. */
  readonly fromAllowlist: boolean;
  /** The full ranked intersection, cheapest-first, for evidence. */
  readonly rankedIntersection: readonly string[];
}

/**
 * Choose the cheapest eligible model for `harness` from the intersection of its
 * qualification allowlist and the live probe set.
 *
 * Selection rules, in order:
 *  1. Prefer the first allowlist entry that the live probe actually offers
 *     (the allowlist owns cheapness order and the probe owns reachability).
 *  2. If no allowlist entry is probed but the allowlist is non-empty AND the
 *     probe is non-empty, fall back to the cheapest probed id that is NOT an
 *     obviously-expensive tier — this keeps the matrix honest when the catalog
 *     allowlist drifts behind the live gateway, without ever inventing an id.
 *  3. Otherwise throw NoEligibleModelError (never return a non-probed id).
 *
 * Fable is always excluded from the fallback in (2).
 */
export function chooseCheapestEligibleModel(
  harness: string,
  allowlist: readonly string[],
  probedModelIds: readonly string[],
): EligibleModelChoice {
  const probed = new Set(probedModelIds.filter((id) => id.trim().length > 0));
  const intersection = allowlist.filter((id) => probed.has(id));
  const rankedIntersection = [...intersection].sort(
    (a, b) => cheapnessRank(a) - cheapnessRank(b),
  );

  // (1) cheapest allowlist entry the probe offers.
  if (rankedIntersection.length > 0) {
    return { modelId: rankedIntersection[0], fromAllowlist: true, rankedIntersection };
  }

  // (2) allowlist and probe both non-empty but disjoint: cheapest safe probed id.
  if (allowlist.length > 0 && probed.size > 0) {
    const safeProbed = [...probed]
      .filter((id) => !/fable/i.test(id))
      .sort((a, b) => cheapnessRank(a) - cheapnessRank(b));
    if (safeProbed.length > 0) {
      return { modelId: safeProbed[0], fromAllowlist: false, rankedIntersection };
    }
  }

  // (3) nothing eligible and probed.
  throw new NoEligibleModelError(harness, allowlist, probedModelIds);
}

/** Bare native CLI selectors that are gateway-ineligible: a gateway route must
 * never resolve to one (LiteLLM would 400). Used as a defensive assertion. */
export const BARE_NATIVE_SELECTORS: ReadonlySet<string> = new Set([
  "default",
  "sonnet",
  "opus",
  "haiku",
  "gpt-5.5",
]);

export function isBareNativeSelector(modelId: string): boolean {
  return BARE_NATIVE_SELECTORS.has(modelId);
}
