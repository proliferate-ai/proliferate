export const HIDDEN_MODEL_IDS = new Set([
  "claude:default",
]);

export const MODEL_DISPLAY_ALIASES: Record<string, string> = {
  "claude:sonnet": "Sonnet 4.6",
  "claude:sonnet[1m]": "Sonnet 4.6",
  "claude:claude-sonnet-4-6": "Sonnet 4.6",
  "claude:claude-sonnet-4-6-1m": "Sonnet 4.6",
  "claude:opus": "Opus 4.8",
  "claude:opus[1m]": "Opus 4.8",
  "claude:claude-opus-4-8": "Opus 4.8",
  "claude:claude-opus-4-8-1m": "Opus 4.8",
  "claude:claude-opus-4-7": "Opus 4.7",
  "claude:claude-opus-4-7-1m": "Opus 4.7",
  "claude:claude-opus-4-6": "Opus 4.6",
  "claude:haiku": "Haiku 4.5",
  "claude:claude-haiku-4-5": "Haiku 4.5",
  "codex:gpt-5.5": "GPT 5.5",
  "codex:gpt-5.4": "GPT 5.4",
  "codex:gpt-5.4-mini": "GPT 5.4 Mini",
  "codex:gpt-5.3-codex": "GPT 5.3 Codex",
  "codex:gpt-5.3-codex-spark": "GPT 5.3 Codex Spark",
  "codex:gpt-5.2-codex": "GPT 5.2 Codex",
  "codex:gpt-5.1-codex-max": "GPT 5.1 Codex Max",
  "codex:gpt-5.2": "GPT 5.2",
  "codex:gpt-5.1-codex-mini": "GPT 5.1 Codex Mini",
  "cursor:composer-2.5": "Composer 2.5",
  "cursor:composer-2.5-fast": "Composer 2.5 Fast",
};

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

// Vendor family word the product never prints: the harness already names the
// vendor (the provider badge / harness group), so repeating it in the model
// name is noise — "Claude Sonnet 5" and "Claude-Sonnet-5" both read as
// "Sonnet 5". Stripped per "/"-separated segment so provider-scoped catalog
// labels ("Anthropic/Claude Sonnet 5") keep their provider prefix and only
// lose the redundant family word.
const REDUNDANT_MODEL_FAMILY_PREFIX = /^claude[-\s]+(.+)$/i;

function stripRedundantFamilyPrefix(segment: string): string {
  const match = REDUNDANT_MODEL_FAMILY_PREFIX.exec(segment.trim());
  if (!match) {
    return segment;
  }

  const remainder = match[1]!.trim();
  // A remainder that still has no spaces was an all-hyphen label
  // ("Claude-Sonnet-5"), so its hyphens are word separators and get
  // normalized. Anything already spaced is a real label and keeps its
  // punctuation verbatim — dashes there belong to date suffixes like
  // "Sonnet 4.5 (2025-09-29)".
  if (/\s/.test(remainder)) {
    return remainder;
  }

  return remainder
    .split("-")
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ");
}

function normalizeDisplayLabel(label: string): string {
  return normalizeWhitespace(
    label
      .replace(/GPT-(\d)/g, "GPT $1")
      .split("/")
      .map(stripRedundantFamilyPrefix)
      .join("/"),
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

function formatGeminiModelId(modelId: string): string | null {
  const match = /^gemini-(\d+(?:\.\d+)?)-(.+)$/.exec(modelId);
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
    `Gemini ${version}${suffixLabel ? ` ${suffixLabel}` : ""}`,
  );
}

// The minor component is optional: a generation that ships without one
// ("claude-sonnet-5") is named "Sonnet 5", not left to fall through to the raw
// catalog id. The optional trailing `-<digits>` still absorbs date/revision
// suffixes. The minor digit's negative lookahead (`(?![\dm])`) requires the
// candidate minor digit to end a version component, so it isn't fooled by
// the leading digit of a longer suffix: a `-1m` context marker on a bare id
// ("claude-sonnet-5-1m") or a full date stamp on a bare id
// ("claude-sonnet-5-20260101") would otherwise be misread as ".1" or ".2".
//
// Both components accept more than one digit. Matching a single digit did not
// merely mislabel a two-digit version, it did so silently: on "claude-opus-4-10"
// the minor group failed the lookahead and the pattern fell back to the
// bare-major branch, so a ".10" release would render as "Opus 4" — the same
// label as its own ".0", with distinct models collapsed onto one name and
// nothing to signal it. The minor stays capped at two digits so a date stamp
// can never be read as a version.
function formatClaudeModelId(modelId: string): string | null {
  const match = /claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?![\dm]))?(?:-[\d-]+)?/.exec(
    modelId,
  );
  if (!match) {
    return null;
  }

  const [, family, major, minor] = match;
  const version = minor === undefined ? major : `${major}.${minor}`;
  const contextHint = /\[1m\]|-1m\b|\b1m\b/i.test(modelId) ? " (1M context)" : "";
  return normalizeWhitespace(`${titleCaseToken(family)} ${version}${contextHint}`);
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

  if (preferKnownAlias) {
    const formatted = formatClaudeModelId(modelId) ?? formatGeminiModelId(modelId);
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
    ?? formatClaudeModelId(modelId)
    ?? formatGeminiModelId(modelId);
}
