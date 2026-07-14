export interface SessionReasoningEffortPresentation {
  shortLabel: string | null;
}

export type ReasoningEffortEmphasis = "none" | "max" | "ultra";

// "max" — the session sits at the top reasoning level its model offers.
// "ultra" — that top level is the ultra tier, which only frontier models
// expose, so ultra-at-max doubles as the "top model at full capacity" signal.
// Shared by the bars chip and the composer surface so they can't disagree.
export function resolveReasoningEffortEmphasis(
  options: ReadonlyArray<{ value: string; selected: boolean }>,
): ReasoningEffortEmphasis {
  const selectedIndex = options.findIndex((option) => option.selected);
  if (options.length < 2 || selectedIndex !== options.length - 1) {
    return "none";
  }
  const topValue = options[selectedIndex]?.value.toLowerCase() ?? "";
  return topValue === "ultra" ? "ultra" : "max";
}

const TITLE_CASE_SPLIT = /[^a-z0-9]+/i;

export function resolveReasoningEffortPresentation(
  value: string | null,
  label?: string | null,
): SessionReasoningEffortPresentation {
  const normalizedValue = normalizeReasoningEffortValue(value);

  return {
    shortLabel: resolveShortLabel(normalizedValue, label),
  };
}

function normalizeReasoningEffortValue(value: string | null): string | null {
  const normalizedValue = value?.toLowerCase() ?? null;
  return normalizedValue === "max" ? "xhigh" : normalizedValue;
}

function resolveShortLabel(value: string | null, label?: string | null): string | null {
  if (value === "xhigh") {
    return "Xhigh";
  }
  if (label && label.trim().length > 0) {
    return label;
  }
  if (!value) {
    return null;
  }

  const parts = value
    .split(TITLE_CASE_SPLIT)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  return parts.join(" ") || value;
}
