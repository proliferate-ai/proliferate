import {
  clampRounds,
  MAX_REVIEWERS_PER_RUN,
  type StoredReviewDefaultsByKind,
  type StoredReviewKindDefaults,
  type StoredReviewKindReviewers,
} from "@/lib/domain/reviews/review-config";
import type {
  ReviewPersonalityPreference,
  StoredReviewPersonalitiesByKind,
} from "@/lib/domain/reviews/review-personas";

type ReviewDefaultKind = "plan" | "code";

export interface ReviewPersonaPreference {
  id: string;
  label: string;
  prompt: string;
  agentKind: string;
  modelId: string;
  modeId: string;
}

export type ReviewKindPreference = StoredReviewKindDefaults;
export type ReviewDefaultsByKind = StoredReviewDefaultsByKind;
export type ReviewPersonalitiesByKind = StoredReviewPersonalitiesByKind;

export function sanitizeReviewDefaultsByKind(value: unknown): ReviewDefaultsByKind {
  const defaults: ReviewDefaultsByKind = { plan: null, code: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  return {
    plan: sanitizeReviewKindPreference((value as Partial<ReviewDefaultsByKind>).plan),
    code: sanitizeReviewKindPreference((value as Partial<ReviewDefaultsByKind>).code),
  };
}

export function sanitizeReviewPersonalitiesByKind(value: unknown): ReviewPersonalitiesByKind {
  const defaults: ReviewPersonalitiesByKind = { plan: [], code: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const raw = value as Partial<Record<ReviewDefaultKind, unknown>>;
  return {
    plan: sanitizeReviewPersonalityPreferences(raw.plan),
    code: sanitizeReviewPersonalityPreferences(raw.code),
  };
}

function sanitizeReviewPersonalityPreferences(value: unknown): ReviewPersonalityPreference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeReviewPersonalityPreferences(
    value.flatMap(sanitizeReviewPersonalityPreference),
  );
}

function sanitizeReviewPersonalityPreference(value: unknown): ReviewPersonalityPreference[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = value as Partial<ReviewPersonalityPreference>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!id || !label || !prompt) {
    return [];
  }
  return [{ id, label, prompt }];
}

function sanitizeReviewKindPreference(value: unknown): ReviewKindPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<ReviewKindPreference> & {
    autoSendFeedback?: unknown;
    reviewers?: unknown;
  };
  const maxRounds = typeof raw.maxRounds === "number"
    && Number.isFinite(raw.maxRounds)
    ? clampRounds(raw.maxRounds)
    : 2;
  const reviewers = sanitizeReviewKindReviewers(raw.reviewers);
  return {
    maxRounds,
    autoIterate: typeof raw.autoIterate === "boolean"
      ? raw.autoIterate
      : typeof raw.autoSendFeedback === "boolean"
        ? raw.autoSendFeedback
        : true,
    agentKind: typeof raw.agentKind === "string" ? raw.agentKind.trim() : "",
    modelId: typeof raw.modelId === "string" ? raw.modelId.trim() : "",
    modeId: typeof raw.modeId === "string" ? raw.modeId.trim() : "",
    reviewers,
  };
}

function sanitizeReviewKindReviewers(value: unknown): StoredReviewKindReviewers {
  if (Array.isArray(value)) {
    const reviewers = dedupeReviewPersonaPreferences(
      value.flatMap(sanitizeReviewPersonaPreference),
    ).slice(0, MAX_REVIEWERS_PER_RUN);
    return reviewers.length > 0
      ? { mode: "custom", items: reviewers }
      : { mode: "inherit" };
  }

  if (!value || typeof value !== "object") {
    return { mode: "inherit" };
  }

  const raw = value as {
    mode?: unknown;
    items?: unknown;
  };
  if (raw.mode === "custom") {
    const reviewers = Array.isArray(raw.items)
      ? dedupeReviewPersonaPreferences(raw.items.flatMap(sanitizeReviewPersonaPreference))
        .slice(0, MAX_REVIEWERS_PER_RUN)
      : [];
    return { mode: "custom", items: reviewers };
  }
  return { mode: "inherit" };
}

function sanitizeReviewPersonaPreference(value: unknown): ReviewPersonaPreference[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = value as Partial<ReviewPersonaPreference>;
  const id = typeof raw.id === "string" && raw.id.trim()
    ? raw.id.trim()
    : typeof raw.label === "string" && raw.label.trim()
      ? raw.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!id || !label || !prompt) {
    return [];
  }
  return [{
    id,
    label,
    prompt,
    agentKind: typeof raw.agentKind === "string" ? raw.agentKind.trim() : "",
    modelId: typeof raw.modelId === "string" ? raw.modelId.trim() : "",
    modeId: typeof raw.modeId === "string" ? raw.modeId.trim() : "",
  }];
}

function dedupeReviewPersonaPreferences(
  reviewers: ReviewPersonaPreference[],
): ReviewPersonaPreference[] {
  const seen = new Set<string>();
  return reviewers.filter((reviewer) => {
    if (seen.has(reviewer.id)) {
      return false;
    }
    seen.add(reviewer.id);
    return true;
  });
}

function dedupeReviewPersonalityPreferences(
  personalities: ReviewPersonalityPreference[],
): ReviewPersonalityPreference[] {
  const seen = new Set<string>();
  return personalities.filter((personality) => {
    if (seen.has(personality.id)) {
      return false;
    }
    seen.add(personality.id);
    return true;
  });
}
