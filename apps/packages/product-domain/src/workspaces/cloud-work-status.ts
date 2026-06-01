import type {
  CloudWorkspaceDetail,
  CloudWorkspaceLastSessionSummary,
  CloudWorkspaceSummary,
} from "@proliferate/cloud-sdk";

import type {
  CloudWorkStatusFilter,
  RecentWorkStatusIndicatorKind,
  RecentWorkStatusIndicatorView,
} from "./cloud-work-inventory-types";
import { cloudCommandReadiness, cloudWorkspaceRuntimeIsInProgress } from "./cloud-work-runtime";

type RecentWorkSessionInteractionFacts =
  Pick<CloudWorkspaceLastSessionSummary, "pendingInteractionCount">
  & Partial<Pick<CloudWorkspaceLastSessionSummary, "phase">>;

export function recentWorkStatusIndicatorForWorkspace(
  workspace: CloudWorkspaceStatusIndicatorFacts,
): RecentWorkStatusIndicatorView {
  return recentWorkStatusIndicatorForSession(
    workspace,
    workspace.lastSessionSummary?.status,
    workspace.lastSessionSummary,
  );
}

export function recentWorkStatusIndicatorForSession(
  workspace: CloudWorkspaceStatusIndicatorFacts,
  sessionStatus: string | null | undefined,
  sessionInteraction?: RecentWorkSessionInteractionFacts | null,
): RecentWorkStatusIndicatorView {
  if (workspaceHasErrorStatus(workspace)) {
    return STATUS_INDICATORS.error;
  }
  if (sessionIsError(sessionStatus)) {
    return STATUS_INDICATORS.error;
  }
  if (workspaceNeedsInput(workspace, sessionInteraction)) {
    return STATUS_INDICATORS.needs_input;
  }
  if (sessionIsReviewReady(sessionStatus)) {
    return STATUS_INDICATORS.review_ready;
  }
  if (sessionIsRunning(sessionStatus)) {
    return STATUS_INDICATORS.running;
  }
  if (workspaceIsCommandReady(workspace)) {
    return STATUS_INDICATORS.ready;
  }
  if (workspaceIsInProgress(workspace)) {
    return STATUS_INDICATORS.running;
  }
  return STATUS_INDICATORS.idle;
}

export type CloudWorkspaceStatusIndicatorFacts = Pick<
  CloudWorkspaceSummary,
  | "actionBlockKind"
  | "actionBlockReason"
  | "billing"
  | "exposure"
  | "exposureState"
  | "lastError"
  | "lastSessionSummary"
  | "runtime"
  | "sandboxType"
  | "status"
  | "targetId"
  | "visibility"
  | "workspaceStatus"
> &
  Partial<Pick<CloudWorkspaceSummary, "directTargetContext">> &
  Partial<Pick<CloudWorkspaceDetail, "anyharnessWorkspaceId">>;

export function cloudWorkStatusForWorkspace(
  workspace: Pick<
    CloudWorkspaceSummary,
    | "actionBlockKind"
    | "actionBlockReason"
    | "exposure"
    | "exposureState"
    | "lastError"
    | "runtime"
    | "sandboxType"
    | "status"
    | "statusDetail"
    | "targetId"
    | "visibility"
    | "workspaceStatus"
    | "lastSessionSummary"
  > &
    Partial<Pick<CloudWorkspaceSummary, "directTargetContext">> &
    Partial<Pick<CloudWorkspaceDetail, "anyharnessWorkspaceId">>,
): CloudWorkStatusFilter {
  if (workspace.visibility === "archived" || workspace.workspaceStatus === "archived") {
    return "archived";
  }
  if (workspace.lastError || workspace.workspaceStatus === "error" || workspace.runtime?.status === "error") {
    return "error";
  }
  if (workspaceHasPendingSessionInput(workspace)) {
    return "blocked";
  }
  if (workspace.actionBlockKind || workspace.actionBlockReason) {
    return "blocked";
  }
  if (workspace.lastSessionSummary?.status === "running") {
    return "running";
  }
  if (
    workspace.workspaceStatus === "pending"
    || workspace.workspaceStatus === "materializing"
    || workspace.workspaceStatus === "needs_rematerialization"
  ) {
    return "active";
  }
  if (cloudCommandReadiness(workspace).commandable) {
    return "ready";
  }
  if (cloudWorkspaceRuntimeIsInProgress(workspace)) {
    return "active";
  }
  return "ready";
}

const STATUS_INDICATORS: Record<RecentWorkStatusIndicatorKind, RecentWorkStatusIndicatorView> = {
  needs_input: {
    kind: "needs_input",
    tone: "attention",
    label: "Needs input",
    hollow: false,
    live: false,
  },
  running: {
    kind: "running",
    tone: "progress",
    label: "In progress",
    hollow: false,
    live: true,
  },
  review_ready: {
    kind: "review_ready",
    tone: "success",
    label: "Ready for review",
    hollow: false,
    live: false,
  },
  ready: {
    kind: "ready",
    tone: "success",
    label: "Ready",
    hollow: false,
    live: false,
  },
  error: {
    kind: "error",
    tone: "danger",
    label: "Error",
    hollow: false,
    live: false,
  },
  idle: {
    kind: "idle",
    tone: "muted",
    label: "Idle",
    hollow: true,
    live: false,
  },
};

function workspaceHasErrorStatus(
  workspace: Pick<CloudWorkspaceSummary, "lastError" | "runtime" | "status" | "workspaceStatus">,
): boolean {
  return Boolean(workspace.lastError)
    || workspace.workspaceStatus === "error"
    || workspace.status === "error"
    || workspace.runtime?.status === "error"
    || workspace.runtime?.status === "disabled";
}

function workspaceNeedsInput(
  workspace: Pick<
    CloudWorkspaceSummary,
    | "actionBlockKind"
    | "actionBlockReason"
    | "billing"
    | "lastSessionSummary"
    | "visibility"
  >,
  sessionInteraction: RecentWorkSessionInteractionFacts | null | undefined = workspace.lastSessionSummary,
): boolean {
  return workspace.visibility === "shared_unclaimed"
    || sessionHasPendingInput(sessionInteraction)
    || Boolean(workspace.actionBlockKind || workspace.actionBlockReason)
    || workspace.billing?.blockStatus === "blocked"
    || workspace.billing?.startBlocked === true
    || workspace.billing?.activeSpendHold === true;
}

function workspaceIsInProgress(
  workspace: Pick<CloudWorkspaceSummary, "runtime" | "sandboxType" | "status" | "workspaceStatus">
    & Partial<Pick<CloudWorkspaceSummary, "directTargetContext">>,
): boolean {
  return workspace.workspaceStatus === "pending"
    || workspace.workspaceStatus === "materializing"
    || workspace.workspaceStatus === "needs_rematerialization"
    || workspace.status === "pending"
    || workspace.status === "materializing"
    || workspace.status === "needs_rematerialization"
    || cloudWorkspaceRuntimeIsInProgress(workspace);
}

function workspaceIsCommandReady(workspace: CloudWorkspaceStatusIndicatorFacts): boolean {
  return cloudCommandReadiness(workspace).commandable;
}

function sessionIsError(status: string | null | undefined): boolean {
  const normalized = normalizedStatusToken(status);
  return normalized === "error" || normalized === "failed";
}

function sessionIsRunning(status: string | null | undefined): boolean {
  const normalized = normalizedStatusToken(status);
  return normalized === "running" || normalized === "queued";
}

function sessionIsReviewReady(status: string | null | undefined): boolean {
  const normalized = normalizedStatusToken(status);
  return normalized === "review" || normalized === "ready_for_review";
}

function normalizedStatusToken(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
}

export function workspaceHasPendingSessionInput(
  workspace: Pick<CloudWorkspaceSummary, "lastSessionSummary">,
): boolean {
  return sessionHasPendingInput(workspace.lastSessionSummary);
}

function sessionHasPendingInput(
  summary: RecentWorkSessionInteractionFacts | null | undefined,
): boolean {
  if (!summary) {
    return false;
  }
  const phase = summary.phase?.toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
  return (summary.pendingInteractionCount ?? 0) > 0
    || phase === "awaiting_interaction";
}

export function selectDefaultCloudWorkSession(
  workspace: Pick<CloudWorkspaceSummary, "lastSessionSummary">,
): string | null {
  return workspace.lastSessionSummary?.sessionId ?? null;
}
