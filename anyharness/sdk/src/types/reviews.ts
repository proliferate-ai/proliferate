import type { components } from "../generated/openapi.js";

export type ReviewKind = components["schemas"]["ReviewKind"];
export type ReviewRunStatus = components["schemas"]["ReviewRunStatus"];
export type ReviewRoundStatus = components["schemas"]["ReviewRoundStatus"];
export type ReviewAssignmentStatus =
  components["schemas"]["ReviewAssignmentStatus"];
export type ReviewLaunchVerificationStatus =
  "pending" | "verified" | "mismatch" | "not_checked";
export type ReviewFeedbackDeliveryState =
  components["schemas"]["ReviewFeedbackDeliveryState"];
export interface ReviewPersonaRequest {
  personaId: string;
  label: string;
  prompt: string;
  agentKind: string;
  modelId?: string | null;
  controlValues: Record<string, string>;
}
export interface StartPlanReviewRequest {
  parentSessionId: string;
  maxRounds?: number;
  autoIterate?: boolean;
  reviewers: ReviewPersonaRequest[];
}
export type StartCodeReviewRequest = StartPlanReviewRequest;
export type MarkReviewRevisionReadyRequest =
  components["schemas"]["MarkReviewRevisionReadyRequest"];
export type RetryReviewAssignmentRequest =
  components["schemas"]["RetryReviewAssignmentRequest"];
export type ReviewAssignmentDetail = Omit<
  components["schemas"]["ReviewAssignmentDetail"],
  "requestedModeId" | "actualModeId" | "modeVerificationStatus"
> & {
  controlValues: Record<string, string>;
  launchVerificationStatus: ReviewLaunchVerificationStatus;
};
export type ReviewCritiqueResponse =
  components["schemas"]["ReviewCritiqueResponse"];
export type ReviewFeedbackDeliveryDetail =
  components["schemas"]["ReviewFeedbackDeliveryDetail"];
export type ReviewRoundDetail = Omit<components["schemas"]["ReviewRoundDetail"], "assignments"> & {
  assignments: ReviewAssignmentDetail[];
};
export type ReviewRunDetail = Omit<components["schemas"]["ReviewRunDetail"], "rounds"> & {
  rounds: ReviewRoundDetail[];
};
export interface ReviewRunResponse { run: ReviewRunDetail }
export interface SessionReviewsResponse { reviews: ReviewRunDetail[] }
