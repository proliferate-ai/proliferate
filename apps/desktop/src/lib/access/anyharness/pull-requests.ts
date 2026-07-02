import {
  AnyHarnessError,
  type AnyHarnessRequestOptions,
  type BranchPullRequestStatus,
} from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";
import type { WorkspacePrStatusAvailability } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";

export interface RepoPullRequestStatusesResult {
  availability: WorkspacePrStatusAvailability;
  entries: BranchPullRequestStatus[];
  fetchedAt: string | null;
}

const EMPTY_ENTRIES: BranchPullRequestStatus[] = [];

function unavailable(availability: WorkspacePrStatusAvailability): RepoPullRequestStatusesResult {
  return { availability, entries: EMPTY_ENTRIES, fetchedAt: null };
}

// Maps daemon hosting errors to a typed availability. An older daemon without
// the route answers with a bare axum 404 (no ProblemDetails code) →
// "endpoint_missing"; a coded 404 (e.g. repo root gone) is a plain "error".
export function resolveRepoPrStatusAvailability(
  error: unknown,
): WorkspacePrStatusAvailability {
  if (error instanceof AnyHarnessError) {
    switch (error.problem.code) {
      case "HOSTING_GH_NOT_INSTALLED":
        return "gh_not_installed";
      case "HOSTING_GH_AUTH_REQUIRED":
        return "gh_auth_required";
      case "HOSTING_REMOTE_UNSUPPORTED":
        return "remote_unsupported";
      default:
        break;
    }
    if (error.problem.status === 404 && !error.problem.code) {
      return "endpoint_missing";
    }
  }
  return "error";
}

function isAbortError(error: unknown): boolean {
  if (
    typeof DOMException !== "undefined"
    && error instanceof DOMException
    && error.name === "AbortError"
  ) {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

// Never throws to the UI (aborts re-throw so React Query can cancel cleanly).
export async function listRepoRootPullRequestStatuses(
  connection: AnyHarnessClientConnection,
  repoRootId: string,
  params?: { refresh?: boolean },
  options?: AnyHarnessRequestOptions,
): Promise<RepoPullRequestStatusesResult> {
  try {
    const response = await getAnyHarnessClient(connection).pullRequests.listForRepoRoot(
      repoRootId,
      params,
      options,
    );
    return {
      availability: "ok",
      entries: response.entries,
      fetchedAt: response.fetchedAt,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return unavailable(resolveRepoPrStatusAvailability(error));
  }
}
