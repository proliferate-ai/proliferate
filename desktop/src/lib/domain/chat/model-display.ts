import {
  HIDDEN_MODEL_IDS,
  MODEL_DISPLAY_ALIASES,
} from "@/lib/domain/chat/models/model-display";

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

function hasOneMillionContextHint(labels: Array<string | null | undefined>): boolean {
  return labels.some((label) => /\b1m\b|1m context/i.test(label ?? ""));
}

function withContextHint(
  label: string,
  sourceLabels: Array<string | null | undefined>,
): string {
  if (!hasOneMillionContextHint(sourceLabels) || /\b1m\b|1m context/i.test(label)) {
    return label;
  }
  return `${label} (1M context)`;
}

type ModelControlLabelSource = {
  currentValue?: string | null;
  values: Array<{
    value: string;
    label: string;
  }>;
} | null | undefined;

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
  const match = /claude-([a-z]+)-(\d)-(\d)(?:-[\d-]+)?/.exec(modelId);
  if (!match) {
    return null;
  }

  const [, family, major, minor] = match;
  const contextHint = /\[1m\]|-1m\b|\b1m\b/i.test(modelId) ? " (1M context)" : "";
  return normalizeWhitespace(`${titleCaseToken(family)} ${major}.${minor}${contextHint}`);
}

export function shouldHideModel(agentKind: string, modelId: string): boolean {
  if (HIDDEN_MODEL_IDS.has(modelKey(agentKind, modelId))) {
    return true;
  }

  if (agentKind !== "claude") {
    return false;
  }

  return /^claude-opus-4-(?:1|5)(?:-|$|\[)/.test(modelId)
    || modelId === "claude-opus-4-6-1m"
    || modelId === "claude-opus-4-6[1m]";
}

export function resolveMatchingModelControlLabel(args: {
  modelId: string | null | undefined;
  control: ModelControlLabelSource;
  displayedModelValue?: string | null;
}): string | null {
  const displayedModelValue = args.displayedModelValue ?? args.control?.currentValue ?? null;
  if (!args.modelId || displayedModelValue !== args.modelId) {
    return null;
  }

  return args.control?.values.find((value) => value.value === args.modelId)?.label ?? null;
}

export function resolveModelDisplayName(args: {
  agentKind: string;
  modelId: string;
  sourceLabels?: Array<string | null | undefined>;
  preferKnownAlias?: boolean;
}): string | null {
  const { agentKind, modelId, sourceLabels = [], preferKnownAlias = false } = args;
  if (shouldHideModel(agentKind, modelId)) {
    return null;
  }

  const alias = MODEL_DISPLAY_ALIASES[modelKey(agentKind, modelId)];
  if (preferKnownAlias && alias) {
    return withContextHint(alias, sourceLabels);
  }

  if (preferKnownAlias && agentKind === "claude") {
    const formatted = formatClaudeModelId(modelId);
    if (formatted) {
      return withContextHint(formatted, sourceLabels);
    }
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

  if (alias) {
    return withContextHint(alias, sourceLabels);
  }

  return formatGptModelId(modelId)
    ?? formatClaudeModelId(modelId);
}
