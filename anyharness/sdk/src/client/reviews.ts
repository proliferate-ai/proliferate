import type {
  MarkReviewRevisionReadyRequest,
  ReviewCritiqueResponse,
  ReviewRunResponse,
  RetryReviewAssignmentRequest,
  SessionReviewsResponse,
  StartCodeReviewRequest,
  StartPlanReviewRequest,
} from "../types/reviews.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class ReviewsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async listForSession(
    sessionId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<SessionReviewsResponse> {
    return this.transport.get<SessionReviewsResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/reviews`,
      options,
    );
  }

  async getAssignmentCritique(
    reviewRunId: string,
    assignmentId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ReviewCritiqueResponse> {
    return this.transport.get<ReviewCritiqueResponse>(
      `/v1/reviews/${encodeURIComponent(reviewRunId)}/assignments/${encodeURIComponent(assignmentId)}/critique`,
      options,
    );
  }

  async retryAssignment(
    reviewRunId: string,
    assignmentId: string,
    input: RetryReviewAssignmentRequest = {},
    options?: AnyHarnessRequestOptions,
  ): Promise<ReviewRunResponse> {
    return this.transport.post<ReviewRunResponse>(
      `/v1/reviews/${encodeURIComponent(reviewRunId)}/assignments/${encodeURIComponent(assignmentId)}/retry`,
      input,
      options,
    );
  }

  async startPlanReview(
    workspaceId: string,
    planId: string,
    input: StartPlanReviewRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<ReviewRunResponse> {
    return this.transport.post<ReviewRunResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plans/${encodeURIComponent(planId)}/review`,
      input,
      options,
    );
  }

  async startCodeReview(
    workspaceId: string,
    input: StartCodeReviewRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<ReviewRunResponse> {
    return this.transport.post<ReviewRunResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/reviews/code`,
      input,
      options,
    );
  }

  async stop(
    reviewRunId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ReviewRunResponse> {
    return this.transport.post<ReviewRunResponse>(
      `/v1/reviews/${encodeURIComponent(reviewRunId)}/stop`,
      {},
      options,
    );
  }

  async sendFeedback(
    reviewRunId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ReviewRunResponse> {
    return this.transport.post<ReviewRunResponse>(
      `/v1/reviews/${encodeURIComponent(reviewRunId)}/send-feedback`,
      {},
      options,
    );
  }

  async markRevisionReady(
    reviewRunId: string,
    input: MarkReviewRevisionReadyRequest = {},
    options?: AnyHarnessRequestOptions,
  ): Promise<ReviewRunResponse> {
    return this.transport.post<ReviewRunResponse>(
      `/v1/reviews/${encodeURIComponent(reviewRunId)}/revision-ready`,
      input,
      options,
    );
  }
}
