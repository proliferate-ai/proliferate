/**
 * Compact token-count formatter for the composer's context-usage ring:
 * 33100 -> "33.1k", 300000 -> "300.0k", 1000000 -> "1.0M", 985 -> "985".
 * `toLocaleString()` (used for exact counts elsewhere, e.g. goal.ts) prints
 * "33,100" — too wide for the popover's header row.
 */
export function formatCompactTokenCount(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (magnitude >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return `${Math.round(value)}`;
}

/**
 * Where the context-usage ring turns destructive. Deliberately independent of
 * the worktree pressure ring's `isComposerRingDestructive` (85% of the
 * target's OWN limit): a session's context window is a hard ceiling, not a
 * target's ideal max, so this is a flat fraction of the actual budget.
 */
export const CONTEXT_USAGE_DESTRUCTIVE_THRESHOLD = 0.9;

export function isContextUsageDestructive(usedFraction: number): boolean {
  return usedFraction >= CONTEXT_USAGE_DESTRUCTIVE_THRESHOLD;
}

export interface ParsedUsageCost {
  amount: number;
  currency: string;
}

// `cost` arrives as `unknown` off the wire (reducer/reducer.ts UsageState) —
// narrowed here rather than trusted, since harnesses that emit it (claude)
// and ones that omit it (codex) share the same event shape.
export function parseUsageCost(cost: unknown): ParsedUsageCost | null {
  if (!cost || typeof cost !== "object") {
    return null;
  }
  const { amount, currency } = cost as Record<string, unknown>;
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return null;
  }
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
    return null;
  }
  return { amount, currency };
}

export function formatUsageCost(cost: ParsedUsageCost): string | null {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cost.currency })
      .format(cost.amount);
  } catch {
    // Well-formed (3-letter) but Intl still rejects it in some engines —
    // hide the row rather than crash the popover over a cosmetic number.
    return null;
  }
}
