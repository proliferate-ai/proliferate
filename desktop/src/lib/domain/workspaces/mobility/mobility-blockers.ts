import type { WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import type { CloudWorkspaceMobilityPreflightResponse } from "@/lib/access/cloud/client";
import { mobilityBlockerCopy } from "@/lib/domain/workspaces/mobility/presentation";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";
import type { WorkspaceMobilityBlockerCode } from "@/lib/domain/workspaces/mobility/types";

export type WorkspaceMobilityNormalizedBlockerCode =
  | WorkspaceMobilityBlockerCode
  | "cloud_head_mismatch";

export interface WorkspaceMobilityPrimaryBlocker {
  code: WorkspaceMobilityNormalizedBlockerCode;
  rawMessage: string;
  headline: string;
  body: string;
  helper: string | null;
  actionLabel: string;
}

const SOURCE_BLOCKER_PRIORITY: WorkspaceMobilityBlockerCode[] = [
  "workspace_not_mutable",
  "setup_running",
  "session_running",
  "session_awaiting_interaction",
  "pending_prompt",
  "workspace_dirty",
  "local_default_branch_in_use",
  "default_branch_unknown",
  "missing_branch_name",
  "missing_base_commit_sha",
  "archive_too_large",
  "workspace_status_unknown",
];

const CLOUD_BLOCKER_PRIORITY: WorkspaceMobilityBlockerCode[] = [
  "cloud_lost",
  "workspace_handoff_in_progress",
  "user_handoff_in_progress",
  "owner_mismatch",
  "branch_mismatch",
  "missing_base_commit_sha",
  "branch_not_published",
  "cloud_repo_access",
  "unknown",
];

const CLOUD_HEAD_MISMATCH_PRIORITY = CLOUD_BLOCKER_PRIORITY.indexOf("cloud_repo_access");
const CLOUD_HEAD_MISMATCH_MESSAGE = "on github is not at the requested commit";

function sourceBlockerPriority(code: WorkspaceMobilityBlockerCode): number {
  const index = SOURCE_BLOCKER_PRIORITY.indexOf(code);
  return index === -1 ? SOURCE_BLOCKER_PRIORITY.length : index;
}

function cloudBlockerPriority(code: WorkspaceMobilityNormalizedBlockerCode): number {
  if (code === "cloud_head_mismatch") {
    return CLOUD_HEAD_MISMATCH_PRIORITY;
  }
  const index = CLOUD_BLOCKER_PRIORITY.indexOf(code);
  return index === -1 ? CLOUD_BLOCKER_PRIORITY.length : index;
}

function normalizeCloudBlockerCode(message: string): WorkspaceMobilityNormalizedBlockerCode {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("cloud_lost")) {
    return "cloud_lost";
  }
  if (normalized.includes("handoff already in progress for workspace")) {
    return "workspace_handoff_in_progress";
  }
  if (normalized.includes("another handoff is already in progress")) {
    return "user_handoff_in_progress";
  }
  if (normalized.includes("not currently local-owned") || normalized.includes("not currently cloud-owned")) {
    return "owner_mismatch";
  }
  if (normalized.includes("requested branch does not match logical workspace branch")) {
    return "branch_mismatch";
  }
  if (normalized.includes("requested base sha must be non-empty")) {
    return "missing_base_commit_sha";
  }
  if (normalized.includes("was not found on github")) {
    return "branch_not_published";
  }
  if (normalized.includes(CLOUD_HEAD_MISMATCH_MESSAGE)) {
    return "cloud_head_mismatch";
  }
  if (
    normalized.includes("connect a github account before moving this workspace to cloud")
  ) {
    return "github_account_required";
  }
  if (
    normalized.includes("grant repository access before moving this workspace to cloud")
  ) {
    return "cloud_repo_access";
  }
  return "unknown";
}

function buildPrimaryBlocker(args: {
  code: WorkspaceMobilityNormalizedBlockerCode;
  rawMessage: string;
  direction: WorkspaceMobilityDirection | null;
  branchName?: string | null;
}): WorkspaceMobilityPrimaryBlocker {
  if (args.code === "cloud_head_mismatch") {
    return {
      code: args.code,
      rawMessage: args.rawMessage,
      headline: args.direction === "cloud_to_local"
        ? "Can't bring this workspace back local yet"
        : "Can't move this workspace to cloud yet",
      body: args.rawMessage,
      helper: "Refresh local git status and try again.",
      actionLabel: "Got it",
    };
  }

  const copy = mobilityBlockerCopy({
    code: args.code,
    direction: args.direction,
    branchName: args.branchName,
    rawMessage: args.rawMessage,
  });

  return {
    code: args.code,
    rawMessage: args.rawMessage,
    ...copy,
  };
}

export function pickPrimaryMobilityBlocker(args: {
  sourcePreflight: WorkspaceMobilityPreflightResponse | null;
  cloudPreflight: CloudWorkspaceMobilityPreflightResponse | null;
  direction: WorkspaceMobilityDirection | null;
  branchName?: string | null;
}): WorkspaceMobilityPrimaryBlocker | null {
  const sourceBlockers = [...(args.sourcePreflight?.blockers ?? [])]
    .sort((left, right) => (
      sourceBlockerPriority((left.code ?? "unknown") as WorkspaceMobilityBlockerCode)
      - sourceBlockerPriority((right.code ?? "unknown") as WorkspaceMobilityBlockerCode)
    ));
  if (sourceBlockers.length > 0) {
    const blocker = sourceBlockers[0];
    return buildPrimaryBlocker({
      code: (blocker.code ?? "unknown") as WorkspaceMobilityBlockerCode,
      rawMessage: blocker.message,
      direction: args.direction,
      branchName: args.branchName,
    });
  }

  const cloudBlockers = [...(args.cloudPreflight?.blockers ?? [])]
    .map((message) => ({
      code: normalizeCloudBlockerCode(message),
      message,
    }))
    .sort((left, right) => cloudBlockerPriority(left.code) - cloudBlockerPriority(right.code));

  if (cloudBlockers.length === 0) {
    return null;
  }

  return buildPrimaryBlocker({
    code: cloudBlockers[0].code,
    rawMessage: cloudBlockers[0].message,
    direction: args.direction,
    branchName: args.branchName,
  });
}
