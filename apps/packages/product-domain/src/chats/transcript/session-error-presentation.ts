import type { ErrorItem } from "@anyharness/sdk";

export interface SessionErrorPresentation {
  title: string;
  description: string;
  technicalDetail: string | null;
  fallbackModelLabel: string | null;
}

const GENERIC_ERROR_TITLE = "Chat stopped";
const GENERIC_ERROR_DESCRIPTION = "The session stopped before it could continue.";
const MAX_DESCRIPTION_LENGTH = 180;

export function presentSessionError(item: ErrorItem): SessionErrorPresentation {
  // Defensively feature-detect the "network_connection" kind string — the Rust
  // contract variant may ship after this code, so we check by string value.
  if ((item.details as { kind?: string } | null)?.kind === "network_connection") {
    return {
      title: "Connection lost",
      description:
        "Your message couldn't reach the model. Your work is saved — retry when you're back online.",
      technicalDetail: normalizeTechnicalDetail(item.message),
      fallbackModelLabel: null,
    };
  }

  if (item.details?.kind === "provider_rate_limit") {
    const provider = formatProviderLabel(item.details.provider);
    const model = formatModelLabel(item.details.providerModel);
    const fallbackModelLabel = formatModelLabel(item.details.fallbackModelId);
    const retryGuidance = fallbackModelLabel
      ? `Try again later or switch to ${fallbackModelLabel}.`
      : "Try again later.";

    return {
      title: `${provider} rate limit reached`,
      description: `This chat exceeded the provider limit${model ? ` for ${model}` : ""}. ${retryGuidance}`,
      technicalDetail: normalizeTechnicalDetail(item.message),
      fallbackModelLabel,
    };
  }

  const normalizedMessage = normalizeTechnicalDetail(item.message);
  const description = normalizedMessage
    ? truncateSentence(normalizedMessage, MAX_DESCRIPTION_LENGTH)
    : GENERIC_ERROR_DESCRIPTION;
  const technicalDetail = buildGenericTechnicalDetail({
    code: item.code,
    message: normalizedMessage,
    description,
  });

  return {
    title: GENERIC_ERROR_TITLE,
    description,
    technicalDetail,
    fallbackModelLabel: null,
  };
}

export function formatModelLabel(modelId: string | null | undefined): string | null {
  const normalized = modelId?.trim();
  if (!normalized) {
    return null;
  }

  const claudeMatch = /^claude-(.+)-(\d+)-(\d+)$/i.exec(normalized);
  if (claudeMatch) {
    const family = claudeMatch[1]
      ?.split("-")
      .filter(Boolean)
      .map(capitalize)
      .join(" ");
    const major = claudeMatch[2];
    const minor = claudeMatch[3];
    return [family, major && minor ? `${major}.${minor}` : null]
      .filter(Boolean)
      .join(" ");
  }

  return normalized;
}

function formatProviderLabel(provider: string | null | undefined): string {
  const normalized = provider?.trim();
  if (!normalized) {
    return "Provider";
  }
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
}

function normalizeTechnicalDetail(message: string | null | undefined): string | null {
  const normalized = message
    ?.replace(/\s+/g, " ")
    .replace(/^(error|runtime error|anyharness error):\s*/i, "")
    .trim();
  return normalized || null;
}

function buildGenericTechnicalDetail({
  code,
  message,
  description,
}: {
  code: string | null | undefined;
  message: string | null;
  description: string;
}): string | null {
  const lines: string[] = [];
  const normalizedCode = code?.trim();
  if (normalizedCode) {
    lines.push(`Error code: ${normalizedCode}`);
  }
  if (message && (message !== description || normalizedCode)) {
    lines.push(message);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function truncateSentence(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const sentenceEnd = value.slice(0, maxLength).search(/[.!?]\s/);
  if (sentenceEnd > 40) {
    return value.slice(0, sentenceEnd + 1);
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
