import {
  HIDDEN_MODEL_IDS,
  MODEL_DISPLAY_ALIASES,
} from "@/config/model-display";

function modelKey(agentKind: string, modelId: string): string {
  return `${agentKind}:${modelId}`;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function titleCaseToken(token: string): string {
  if (!token) {
    return "";
  }
  if (/^\d+(?:\.\d+)?$/.test(token)) {
    return token;
  }
  if (/^\d+m$/i.test(token)) {
    return token.toUpperCase();
  }
  if (token.toLowerCase() === "gpt") {
    return "GPT";
  }

  const lower = token.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function normalizeDisplayLabel(label: string): string {
  return normalizeWhitespace(
    label.replace(/GPT-(\d)/g, "GPT $1"),
  );
}

function formatGptModelId(modelId: string): string | null {
  const match = /^gpt-(\d(?:\.\d+)?)(?:-(.+))?$/.exec(modelId);
  if (!match) {
    return null;
  }

  const [, version, suffix = ""] = match;
  const suffixLabel = suffix
    .split("-")
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ");

  return normalizeWhitespace(
    `GPT ${version}${suffixLabel ? ` ${suffixLabel}` : ""}`,
  );
}

function formatClaudeModelId(modelId: string): string | null {
  const match = /^claude-([a-z]+)-(\d)-(\d)(?:-(\d+m))?$/.exec(modelId);
  if (!match) {
    return null;
  }

  const [, family, major, minor, contextHint] = match;
  return normalizeWhitespace(
    `Claude ${titleCaseToken(family)} ${major}.${minor}${contextHint ? ` (${contextHint.toUpperCase()})` : ""}`,
  );
}

export function shouldHideModel(agentKind: string, modelId: string): boolean {
  return HIDDEN_MODEL_IDS.has(modelKey(agentKind, modelId));
}

export function resolveModelDisplayName(args: {
  agentKind: string;
  modelId: string;
  sourceLabels?: Array<string | null | undefined>;
}): string | null {
  const { agentKind, modelId, sourceLabels = [] } = args;
  if (shouldHideModel(agentKind, modelId)) {
    return null;
  }

  for (const candidate of sourceLabels) {
    if (!candidate) {
      continue;
    }

    const normalized = normalizeDisplayLabel(candidate);
    if (!normalized || normalized.toLowerCase() === modelId.toLowerCase()) {
      continue;
    }
    return normalized;
  }

  const alias = MODEL_DISPLAY_ALIASES[modelKey(agentKind, modelId)];
  if (alias) {
    return alias;
  }

  return formatGptModelId(modelId)
    ?? formatClaudeModelId(modelId);
}
