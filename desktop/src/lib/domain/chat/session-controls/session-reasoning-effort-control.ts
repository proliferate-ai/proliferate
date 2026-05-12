export type SessionReasoningEffortTone =
  | "neutral"
  | "accent"
  | "primary"
  | "warning"
  | "destructive";

export interface SessionReasoningEffortPresentation {
  tone: SessionReasoningEffortTone;
  shortLabel: string | null;
}

const TITLE_CASE_SPLIT = /[^a-z0-9]+/i;

export function resolveReasoningEffortPresentation(
  value: string | null,
  label?: string | null,
): SessionReasoningEffortPresentation {
  const normalizedValue = normalizeReasoningEffortValue(value);

  return {
    tone: resolveTone(normalizedValue),
    shortLabel: resolveShortLabel(normalizedValue, label),
  };
}

function normalizeReasoningEffortValue(value: string | null): string | null {
  const normalizedValue = value?.toLowerCase() ?? null;
  return normalizedValue === "max" ? "xhigh" : normalizedValue;
}

function resolveTone(value: string | null): SessionReasoningEffortTone {
  switch (value) {
    case "medium":
      return "accent";
    case "high":
      return "primary";
    case "xhigh":
      return "warning";
    case "low":
    default:
      return "neutral";
  }
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
