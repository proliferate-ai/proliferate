import type { PromptProvenance } from "@anyharness/sdk";

export type WakePromptProvenance =
  | Extract<PromptProvenance, { type: "subagentWake" }>
  | Extract<PromptProvenance, { type: "linkWake" }>;

export type ReviewFeedbackPromptProvenance = Extract<
  PromptProvenance,
  { type: "reviewFeedback" }
>;

export interface ReviewFeedbackPromptReference {
  reviewRunId: string;
  reviewRoundId: string | null;
  feedbackJobId: string | null;
  roundNumber: number | null;
  label: string | null;
}

export function isSubagentWakeProvenance(
  provenance: PromptProvenance | null | undefined,
): provenance is WakePromptProvenance {
  return provenance?.type === "subagentWake" || provenance?.type === "linkWake";
}

export function formatWakePromptQueueText(
  provenance: WakePromptProvenance,
): string {
  const label = provenance.label?.trim();
  if (label && label.length > 0) {
    return `${label} finished`;
  }
  if (provenance.type === "linkWake" && provenance.relation === "cowork_coding_session") {
    return "Coding session finished";
  }
  return "Subagent finished";
}

export function isReviewFeedbackProvenance(
  provenance: PromptProvenance | null | undefined,
): provenance is ReviewFeedbackPromptProvenance {
  return provenance?.type === "reviewFeedback";
}

export function resolveReviewFeedbackPromptReference(
  provenance: PromptProvenance | null | undefined,
  text: string | null | undefined,
): ReviewFeedbackPromptReference | null {
  if (isReviewFeedbackProvenance(provenance)) {
    return {
      reviewRunId: provenance.reviewRunId,
      reviewRoundId: provenance.reviewRoundId,
      feedbackJobId: provenance.feedbackJobId,
      roundNumber: null,
      label: provenance.label ?? null,
    };
  }
  if (provenance?.type !== "system" || provenance.label !== "review_feedback") {
    return null;
  }
  const parsed = parseLegacyReviewFeedbackPrompt(text);
  return parsed
    ? {
      ...parsed,
      reviewRoundId: null,
      feedbackJobId: null,
      label: null,
    }
    : null;
}

export function isAgentSessionProvenance(
  provenance: PromptProvenance | null | undefined,
): provenance is Extract<PromptProvenance, { type: "agentSession" }> {
  return provenance?.type === "agentSession";
}

export function formatSubagentLabel(
  label: string | null | undefined,
  ordinal: number,
): string {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `Subagent ${ordinal}`;
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

function parseLegacyReviewFeedbackPrompt(
  text: string | null | undefined,
): { reviewRunId: string; roundNumber: number | null } | null {
  if (!text?.startsWith("Review feedback is ready.")) {
    return null;
  }
  const reviewRunId = text.match(/\bReview run:\s*([^\s]+)/)?.[1]?.trim();
  if (!reviewRunId) {
    return null;
  }
  const roundValue = text.match(/\bRound:\s*(\d+)/)?.[1]?.trim();
  const roundNumber = roundValue ? Number.parseInt(roundValue, 10) : Number.NaN;
  return {
    reviewRunId,
    roundNumber: Number.isFinite(roundNumber) ? roundNumber : null,
  };
}
