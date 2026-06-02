import type { SessionControlIconKey } from "../session-controls/presentation";

export function agentModelIcon(agentKind: string): SessionControlIconKey {
  switch (agentKind) {
    case "claude":
      return "claude";
    case "codex":
      return "openai";
    case "gemini":
      return "gemini";
    case "opencode":
      return "opencodeBuild";
    default:
      return "chat";
  }
}

export function controlDisplayLabel(key: string, label: string): string {
  switch (key) {
    case "collaboration_mode":
      return "Mode";
    case "fast_mode":
      return "Fast mode";
    case "effort":
      return "Reasoning effort";
    case "model":
      return "Model";
    case "mode":
    case "reasoning":
      return label;
    default:
      return label || key;
  }
}

export function modelMatchesSelectedValue(input: {
  displayName: string;
  id: string;
  selectedLabel: string | null;
  selectedValue: string | null;
}): boolean {
  const selectedCandidates = [
    input.selectedValue,
    input.selectedLabel,
  ].filter((value): value is string => Boolean(value));
  return selectedCandidates.some((candidate) => {
    if (candidate === input.id || candidate === input.displayName) {
      return true;
    }
    const normalizedCandidate = normalizeModelIdentity(candidate);
    const normalizedId = normalizeModelIdentity(input.id);
    const normalizedDisplay = normalizeModelIdentity(input.displayName);
    return normalizedCandidate === normalizedId
      || normalizedCandidate === normalizedDisplay
      || normalizedCandidate.includes(normalizedDisplay)
      || normalizedDisplay.includes(normalizedCandidate)
      || normalizedId.includes(normalizedCandidate);
  });
}

function normalizeModelIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(us|anthropic|claude|model|id)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
