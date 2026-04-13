import {
  mobilityBlockerCopy,
  type WorkspaceMobilityBlockerCode,
} from "@/config/mobility-copy";
import type { WorkspaceMobilityDirection } from "@/stores/workspaces/workspace-mobility-ui-store";
import type {
  WorkspaceMobilityNormalizedBlockerCode,
  WorkspaceMobilityPrimaryBlocker,
} from "@/lib/domain/workspaces/mobility-blockers";

export interface LocalGitSyncSnapshot {
  upstreamBranch: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
}

export type MobilitySyncRecoveryState =
  | { kind: "passthrough"; blocker: WorkspaceMobilityPrimaryBlocker | null }
  | { kind: "loading" }
  | { kind: "resolved"; blocker: WorkspaceMobilityPrimaryBlocker };

function buildResolvedBlocker(args: {
  code: WorkspaceMobilityBlockerCode;
  rawMessage: string;
  direction: WorkspaceMobilityDirection | null;
  branchName?: string | null;
}): WorkspaceMobilityPrimaryBlocker {
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

export function resolveMobilitySyncRecovery(args: {
  blocker: WorkspaceMobilityPrimaryBlocker | null;
  direction: WorkspaceMobilityDirection | null;
  branchName?: string | null;
  gitSync: LocalGitSyncSnapshot | null;
  isGitSyncResolved: boolean;
}): MobilitySyncRecoveryState {
  if (!args.blocker) {
    return {
      kind: "passthrough",
      blocker: null,
    };
  }

  if (args.blocker.code !== "cloud_head_mismatch") {
    return {
      kind: "passthrough",
      blocker: args.blocker,
    };
  }

  if (!args.isGitSyncResolved) {
    return { kind: "loading" };
  }

  if (!args.gitSync) {
    return {
      kind: "passthrough",
      blocker: args.blocker,
    };
  }

  if (args.gitSync.behind > 0) {
    return {
      kind: "resolved",
      blocker: buildResolvedBlocker({
        code: "branch_out_of_sync",
        rawMessage: args.blocker.rawMessage,
        direction: args.direction,
        branchName: args.branchName,
      }),
    };
  }

  if (args.gitSync.ahead === 0) {
    return {
      kind: "passthrough",
      blocker: args.blocker,
    };
  }

  return {
    kind: "resolved",
    blocker: buildResolvedBlocker({
      code: "head_commit_not_published",
      rawMessage: args.blocker.rawMessage,
      direction: args.direction,
      branchName: args.branchName,
    }),
  };
}

export function isDisplayMobilityBlockerCode(
  code: WorkspaceMobilityNormalizedBlockerCode | null | undefined,
): code is WorkspaceMobilityBlockerCode {
  return code !== null && code !== undefined && code !== "cloud_head_mismatch";
}
