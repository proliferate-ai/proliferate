import type {
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";

export type CloudWorkspaceStatusFields = {
  status?: CloudWorkspaceStatus | null;
  workspaceStatus?: CloudWorkspaceStatus | null;
};

const PENDING_STATUSES = new Set<CloudWorkspaceStatus>([
  "pending",
  "materializing",
  "needs_rematerialization",
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

export function resolveCloudWorkspaceStatus(
  workspace: CloudWorkspaceStatusFields | null | undefined,
): CloudWorkspaceStatus | null {
  return workspace?.status ?? workspace?.workspaceStatus ?? null;
}

export function isCloudWorkspacePending(status: string | null | undefined): boolean {
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
  return resolveCloudWorkspaceStatus(workspace) === "ready"
    && isPostReadyPending(workspace.postReadyPhase);
}

export function isCloudWorkspaceFailedBeforeReady(
  workspace: CloudWorkspaceSummary,
): boolean {
  return resolveCloudWorkspaceStatus(workspace) === "error"
    && workspace.readyAt == null
    && workspace.productLifecycle !== "archived";
}

export function shouldPollCloudWorkspaceForUpdates(
  workspace: CloudWorkspaceSummary,
): boolean {
  return isCloudWorkspacePending(resolveCloudWorkspaceStatus(workspace))
    || isCloudWorkspacePostReadyPending(workspace);
}

export function shouldShowCloudWorkspaceStatusScreen(
  workspace: CloudWorkspaceSummary,
): boolean {
  const status = resolveCloudWorkspaceStatus(workspace);
  return (
    workspace.actionBlockKind != null
    || isCloudWorkspacePending(status)
    || status === "error"
    || status === "archived"
    || isCloudWorkspacePostReadyPending(workspace)
  );
}
