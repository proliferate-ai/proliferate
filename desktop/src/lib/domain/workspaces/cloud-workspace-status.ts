import type {
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
} from "@/lib/access/cloud/client";

const PENDING_STATUSES = new Set<CloudWorkspaceStatus>([
  "pending",
  "materializing",
]);

const START_BLOCK_REASONS = [
  "concurrency_limit",
  "credits_exhausted",
  "overage_disabled",
  "cap_exhausted",
  "payment_failed",
  "admin_hold",
  "external_billing_hold",
] as const;

export type CloudStartBlockReason = (typeof START_BLOCK_REASONS)[number];

const START_BLOCK_REASON_SET: ReadonlySet<string> = new Set(START_BLOCK_REASONS);

export function isCloudWorkspacePending(status: string): boolean {
  return PENDING_STATUSES.has(status as CloudWorkspaceStatus);
}

export function isCloudStartBlockReason(
  reason: string | null | undefined,
): reason is CloudStartBlockReason {
  return typeof reason === "string" && START_BLOCK_REASON_SET.has(reason);
}

function isPostReadyPending(phase: string | null | undefined): boolean {
  return phase === "applying_files" || phase === "starting_setup";
}

export function isCloudWorkspacePostReadyPending(
  workspace: CloudWorkspaceSummary,
): boolean {
  return workspace.status === "ready" && isPostReadyPending(workspace.postReadyPhase);
}

export function shouldPollCloudWorkspaceForUpdates(
  workspace: CloudWorkspaceSummary,
): boolean {
  return isCloudWorkspacePending(workspace.status) || isCloudWorkspacePostReadyPending(workspace);
}

export function shouldShowCloudWorkspaceStatusScreen(
  workspace: CloudWorkspaceSummary,
): boolean {
  return (
    workspace.actionBlockKind != null
    || isCloudWorkspacePending(workspace.status)
    || workspace.status === "error"
    || workspace.status === "archived"
    || isCloudWorkspacePostReadyPending(workspace)
  );
}
