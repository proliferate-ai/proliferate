import type {
  ReviewKind,
  StartCodeReviewRequest,
  StartPlanReviewRequest,
} from "@anyharness/sdk";
import {
  buildReviewRequest,
  createReviewSetupDraft,
  DEFAULT_REVIEW_MAX_ROUNDS,
  resolveReviewExecutionModeIdForAgent,
  type StoredReviewDefaultsByKind,
} from "@/lib/domain/reviews/review-config";
import {
  resolveReviewPersonaTemplates,
  type StoredReviewPersonalitiesByKind,
} from "@/lib/domain/reviews/review-personas";

export interface ReviewLaunchSessionSlot {
  agentKind: string;
  modelId: string | null;
  modeId: string | null;
}

export function resolveOneClickReviewRequest(args: {
  kind: ReviewKind;
  parentSessionId: string;
  parentSlot: ReviewLaunchSessionSlot;
  reviewDefaultsByKind: StoredReviewDefaultsByKind;
  reviewPersonalitiesByKind: StoredReviewPersonalitiesByKind;
}): {
  request: StartPlanReviewRequest | StartCodeReviewRequest | null;
  error: string | null;
} {
  const parentAgentKind = args.parentSlot.agentKind?.trim() ?? "";
  const sessionDefaults = {
    agentKind: parentAgentKind,
    modelId: args.parentSlot.modelId,
    modeId: resolveReviewExecutionModeIdForAgent(parentAgentKind, args.parentSlot.modeId),
  };
  const personalityTemplates = resolveReviewPersonaTemplates(
    args.kind,
    args.reviewPersonalitiesByKind[args.kind] ?? [],
  );
  const draft = createReviewSetupDraft({
    kind: args.kind,
    sessionDefaults,
    storedDefaults: args.reviewDefaultsByKind[args.kind],
    personalityTemplates,
  });
  const result = buildReviewRequest(draft, args.parentSessionId);
  if (!result.request) {
    return result;
  }
  return { request: result.request, error: null };
}

export function buildStartingReview(
  parentSessionId: string,
  kind: ReviewKind,
  request: StartPlanReviewRequest | StartCodeReviewRequest,
) {
  return {
    parentSessionId,
    kind,
    maxRounds: request.maxRounds ?? DEFAULT_REVIEW_MAX_ROUNDS,
    autoIterate: request.autoIterate ?? true,
    reviewers: request.reviewers.map((reviewer) => ({
      id: reviewer.personaId,
      label: reviewer.label,
      agentKind: reviewer.agentKind,
      modelId: reviewer.modelId ?? "",
    })),
    startedAt: Date.now(),
  };
}
