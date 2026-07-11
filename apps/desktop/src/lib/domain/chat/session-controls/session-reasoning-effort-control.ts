export interface SessionReasoningEffortPresentation {
  shortLabel: string | null;
}

const TITLE_CASE_SPLIT = /[^a-z0-9]+/i;

export function resolveReasoningEffortPresentation(
  value: string | null,
  label?: string | null,
): SessionReasoningEffortPresentation {
  return {
    shortLabel: resolveShortLabel(value?.toLowerCase() ?? null, label),
  };
}

function resolveShortLabel(value: string | null, label?: string | null): string | null {
  if (label && label.trim().length > 0) {
    return label.trim();
  }
  if (!value) {
    return null;
  }
  if (value === "xhigh") {
    return "Extra High";
  }
  if (value === "max") {
    return "Max";
  }
  if (value === "ultra") {
    return "Ultra";
  }

  const parts = value
    .split(TITLE_CASE_SPLIT)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  return parts.join(" ") || value;
}
