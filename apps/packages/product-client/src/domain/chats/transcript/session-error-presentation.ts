import type { ErrorItem } from "@anyharness/sdk";
import {
  formatSeatResetTime,
  readSeatUsageLimitDetails,
} from "./seat-usage-limit";

export interface SessionErrorPresentation {
  title: string;
  description: string;
  technicalDetail: string | null;
  fallbackModelLabel: string | null;
  recoveryAction: "choose_model" | "relaunch_session" | null;
}

const GENERIC_ERROR_TITLE = "Chat stopped";
const GENERIC_ERROR_DESCRIPTION = "The session stopped before it could continue.";
const MAX_DESCRIPTION_LENGTH = 180;
const PROVIDER_MODEL_UNAVAILABLE_CODE = "provider_model_unavailable";
const PROVIDER_MODEL_CONFIGURATION_UNSUPPORTED_CODE =
  "provider_model_configuration_unsupported";

type ProviderModelFailure = "unavailable" | "configuration_unsupported";

export function presentSessionError(item: ErrorItem): SessionErrorPresentation {
  const technicalMessage = readTechnicalDetail(item.message);
  const summaryMessage = normalizeSummaryMessage(item.message);

  // Defensively feature-detect the "network_connection" kind string — the Rust
  // contract variant may ship after this code, so we check by string value.
  if ((item.details as { kind?: string } | null)?.kind === "network_connection") {
    return {
      title: "Connection interrupted",
      description:
        "The connection to the model was lost. Your work is saved. Retry to continue.",
      technicalDetail: technicalMessage,
      fallbackModelLabel: null,
      recoveryAction: null,
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
      technicalDetail: technicalMessage,
      fallbackModelLabel,
      recoveryAction: null,
    };
  }

  // Seat plan limit (agent_auth flow 5). The reader feature-detects the
  // `seat_usage_limit` kind by string value — the Rust variant ships in the
  // same slice as this arm. Plain words, never the runtime code; the trailing
  // sentence stays even for a one-seat pool (the pool size is not knowable
  // here, and under rotation the sentence is true — the next launch lands on
  // the next non-cooling login, which may be this one after its reset).
  const seatLimit = readSeatUsageLimitDetails(item.details);
  if (seatLimit) {
    const resetTime = formatSeatResetTime(seatLimit.resetAt);
    const resetClause = resetTime === null ? "" : ` It resets at ${resetTime}.`;
    return {
      title: "Claude.ai plan limit reached",
      description:
        `This session's Claude.ai login hit its plan limit.${resetClause}`
        + " The next session starts on your next login automatically.",
      technicalDetail: technicalMessage,
      fallbackModelLabel: null,
      recoveryAction: "relaunch_session",
    };
  }

  const providerModelFailure = resolveProviderModelFailure(item, summaryMessage);
  if (providerModelFailure) {
    const description = providerModelFailure === "unavailable"
      ? "The selected model isn't available from this provider. Choose another model, then try again."
      : "The provider rejected the reasoning settings for this model. Choose another model, then try again.";
    return {
      title: providerModelFailure === "unavailable"
        ? "Model unavailable"
        : "Model settings unsupported",
      description,
      technicalDetail: buildGenericTechnicalDetail({
        code: item.code,
        message: technicalMessage,
        description,
      }),
      fallbackModelLabel: null,
      recoveryAction: "choose_model",
    };
  }

  const description = summaryMessage
    ? truncateSentence(summaryMessage, MAX_DESCRIPTION_LENGTH)
    : GENERIC_ERROR_DESCRIPTION;
  const technicalDetail = buildGenericTechnicalDetail({
    code: item.code,
    message: technicalMessage,
    description,
  });

  return {
    title: GENERIC_ERROR_TITLE,
    description,
    technicalDetail,
    fallbackModelLabel: null,
    recoveryAction: null,
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

function resolveProviderModelFailure(
  item: ErrorItem,
  summaryMessage: string | null,
): ProviderModelFailure | null {
  if (item.code === PROVIDER_MODEL_UNAVAILABLE_CODE) {
    return "unavailable";
  }
  if (item.code === PROVIDER_MODEL_CONFIGURATION_UNSUPPORTED_CODE) {
    return "configuration_unsupported";
  }

  if (item.sourceAgentKind !== "opencode" || !summaryMessage) {
    return null;
  }
  const normalized = summaryMessage.toLowerCase();
  if (normalized.includes("provided model identifier is invalid")) {
    return "unavailable";
  }
  if (
    normalized.includes("the model returned the following errors")
    && normalized.includes("thinking.type.enabled")
    && normalized.includes("is not supported for this model")
    && normalized.includes("thinking.type.adaptive")
    && normalized.includes("output_config.effort")
  ) {
    return "configuration_unsupported";
  }
  return null;
}

function normalizeSummaryMessage(message: string | null | undefined): string | null {
  const normalized = message
    ?.replace(/\s+/g, " ")
    .replace(
      /^(?:(?:error|runtime error|anyharness error|internal error|undefined):\s*)+/i,
      "",
    )
    .replace(
      /\s*:\s*\{\s*"errorName"\s*:\s*"[^"]+"\s*,\s*"service"\s*:\s*"[^"]+"\s*\}\s*$/i,
      "",
    )
    .trim();
  return normalized || null;
}

function readTechnicalDetail(message: string | null | undefined): string | null {
  const detail = message?.trim();
  return detail || null;
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
