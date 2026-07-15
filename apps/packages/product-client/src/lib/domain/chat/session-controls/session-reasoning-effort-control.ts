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

// Ladders that top out at the ultra tier (frontier models only) present the
// tier by name in the composer — "Ultra" / "Max" / "X High" — instead of the
// icon-only bars every other model keeps.
export function reasoningLadderTopsOutAtUltra(
  options: ReadonlyArray<{ value: string }>,
): boolean {
  if (options.length < 2) {
    return false;
  }
  return options[options.length - 1]?.value.toLowerCase() === "ultra";
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
  // Authored catalog labels ("Extra High", "Max", "Ultra") win — never rewrite
  // them to internal spellings (chat-composer.md §1.1). Values only fall back
  // to a generated title-case form when the catalog gave no label.
  if (label && label.trim().length > 0) {
    return label;
  }
  if (value === "xhigh") {
    return "X High";
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
