export interface SessionReasoningEffortPresentation {
  shortLabel: string | null;
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

export function getSteppedReasoningEffortValue(
  options: ReadonlyArray<{ value: string; selected: boolean }>,
  direction: 1 | -1,
): string | null {
  if (options.length < 2) {
    return null;
  }

  const currentIndex = options.findIndex((option) => option.selected);
  const effectiveIndex = currentIndex >= 0 ? currentIndex : 0;
  const steppedIndex = (effectiveIndex + direction + options.length) % options.length;
  return options[steppedIndex]?.value ?? null;
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
