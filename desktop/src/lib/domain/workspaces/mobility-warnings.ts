import type { WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import type { WorkspaceMobilityBlockerCode } from "@/config/mobility-copy";
import type { LocalGitSyncSnapshot } from "@/lib/domain/workspaces/mobility-sync-recovery";
import { joinLabels } from "@/lib/domain/workspaces/workspace-display";

export function summarizeNonMigratingState(
  preflight: WorkspaceMobilityPreflightResponse | null,
): string | null {
  if (!preflight) {
    return null;
  }

  const skippedSessions = (preflight.sessions ?? [])
    .filter((session) => !session.supported)
    .map((session) => session.agentKind);
  const hasTerminalWarning = (preflight.warnings ?? [])
    .some((warning) => warning.toLowerCase().includes("will not migrate"));

  if (skippedSessions.length > 0 && hasTerminalWarning) {
    return `${joinLabels(skippedSessions)} and active terminals will stay here.`;
  }

  if (skippedSessions.length > 0) {
    return `${joinLabels(skippedSessions)} will stay here.`;
  }

  if (hasTerminalWarning) {
    return "Active terminals will stay here.";
  }

  return null;
}

export function summarizeBranchSyncRecoveryWarning(args: {
  preflight: WorkspaceMobilityPreflightResponse | null;
  blockerCode: WorkspaceMobilityBlockerCode | null;
  gitSync: LocalGitSyncSnapshot | null;
}): string | null {
  if (!args.preflight?.canMove) {
    return null;
  }

  if (
    args.blockerCode !== "branch_not_published"
    && args.blockerCode !== "head_commit_not_published"
  ) {
    return null;
  }

  if (!args.gitSync || args.gitSync.clean) {
    return null;
  }

  return "Uncommitted changes will move with the workspace after this branch is synced.";
}
