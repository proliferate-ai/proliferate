import type { components } from "../generated/openapi.js";

export type PullRequestState = components["schemas"]["PullRequestState"];
export type PullRequestSummary = components["schemas"]["PullRequestSummary"];
export type CurrentPullRequestResponse = components["schemas"]["CurrentPullRequestResponse"];
export type CreatePullRequestRequest = components["schemas"]["CreatePullRequestRequest"];
export type CreatePullRequestResponse = components["schemas"]["CreatePullRequestResponse"];

// ---------------------------------------------------------------------------
// Repo-root pull-request statuses
// ---------------------------------------------------------------------------
// Hand-written mirrors of the daemon v1 hosting contract additions backing
// GET /v1/repo-roots/{repo_root_id}/hosting/pull-requests. Once the daemon
// endpoint lands and `pnpm generate` regenerates openapi.ts, these become
// aliases of the generated schemas (shapes must stay identical).

export type PullRequestChecksState = "none" | "pending" | "passing" | "failing";

export type PullRequestReviewDecision = "none" | "approved" | "changes_requested";

/**
 * PullRequestSummary as served by daemons that already reduce check rollups
 * and review decisions. Both fields are optional so new clients deserialize
 * old daemons (and vice versa); absent maps to "none" at the domain layer.
 */
export type BranchPullRequestSummary = PullRequestSummary & {
  checks?: PullRequestChecksState | null;
  reviewDecision?: PullRequestReviewDecision | null;
};

/**
 * One queried head branch. `pullRequest` null/absent means the branch WAS
 * queried and has no PR (authoritative none). Branches missing from
 * `RepoPullRequestStatusesResponse.entries` were not queried (unknown).
 */
export interface BranchPullRequestStatus {
  headBranch: string;
  pullRequest?: BranchPullRequestSummary | null;
}

export interface RepoPullRequestStatusesResponse {
  entries: BranchPullRequestStatus[];
  fetchedAt: string;
}
