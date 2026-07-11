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
