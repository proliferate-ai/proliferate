import type { WorkspaceMobilityArchive, WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  deriveHandoffFailureRecovery,
  type HandoffFinalizationResolution,
} from "@/lib/domain/workspaces/mobility/handoff-failure-recovery";
import type { WorkspaceMobilityCloudPreflightResponse } from "@/lib/domain/workspaces/mobility/types";

interface LocalToCloudHandoffSnapshot {
  logicalWorkspaceId: string;
  mobilityWorkspaceId: string;
  sourceWorkspaceId: string;
  sourcePreflight: WorkspaceMobilityPreflightResponse;
  cloudPreflight: Pick<WorkspaceMobilityCloudPreflightResponse, "excludedPaths">;
}

interface LocalToCloudHandoffInput {
  snapshot: LocalToCloudHandoffSnapshot;
}

interface StartHandoffInput {
  mobilityWorkspaceId: string;
  input: {
    direction: "local_to_cloud";
    requestedBranch: string;
    requestedBaseSha: string;
    excludePaths: string[];
  };
}

interface UpdatePhaseInput {
  mobilityWorkspaceId: string;
  handoffOpId: string;
  input: {
    phase: "source_frozen" | "destination_ready" | "install_succeeded";
    statusDetail: string;
    cloudWorkspaceId?: string;
  };
}

export interface RunLocalToCloudHandoffDeps {
  startHandoff: (input: StartHandoffInput) => Promise<{ id: string }>;
  loadCloudMobilityWorkspaceDetail: (
    mobilityWorkspaceId: string,
  ) => Promise<{ cloudWorkspaceId?: string | null }>;
  waitForCloudWorkspaceReady: (cloudWorkspaceId: string) => Promise<unknown>;
  invalidateWorkspaceCollections: () => Promise<unknown>;
  updateRuntimeState: (input: {
    workspaceId: string;
    input: { mode: "frozen_for_handoff" | "remote_owned" | "normal"; handoffOpId: string | null };
  }) => Promise<unknown>;
  updatePhase: (input: UpdatePhaseInput) => Promise<unknown>;
  exportArchive: (input: {
    workspaceId: string;
    input: {
      excludePaths: string[];
      expectedHandoffOpId: string;
      expectedBaseCommitSha: string;
      expectedBranchName: string;
      requireCleanGitState: true;
    };
  }) => Promise<WorkspaceMobilityArchive>;
  installArchive: (input: {
    workspaceId: string;
    archive: WorkspaceMobilityArchive;
    operationId: string;
  }) => Promise<unknown>;
  finalizeHandoff: (input: {
    mobilityWorkspaceId: string;
    handoffOpId: string;
    input: { cloudWorkspaceId: string };
  }) => Promise<unknown>;
  clearWorkspaceOwnerFlipCache: (input: {
    logicalWorkspaceId: string;
    previousWorkspaceId: string;
    nextCloudWorkspaceId: string;
  }) => Promise<unknown>;
  clearWorkspaceRuntimeState: (
    workspaceId: string,
    options?: { clearSelection?: boolean },
  ) => void;
  refreshWorkspaceCollections: () => Promise<unknown>;
  selectWorkspace: (workspaceId: string, options?: { force?: boolean }) => Promise<unknown>;
  showMcpNotice: (logicalWorkspaceId: string) => void;
  cleanupWorkspace: (input: { workspaceId: string }) => Promise<unknown>;
  completeCleanup: (input: {
    mobilityWorkspaceId: string;
    handoffOpId: string;
  }) => Promise<unknown>;
  failHandoff: (input: {
    mobilityWorkspaceId: string;
    handoffOpId: string;
    input: { failureCode: "cleanup_failed" | "handoff_failed"; failureDetail: string };
  }) => Promise<unknown>;
  resolveFinalizationAfterAmbiguousCutover: (input: {
    mobilityWorkspaceId: string;
    handoffOpId: string;
  }) => Promise<HandoffFinalizationResolution>;
  showToast: (message: string) => void;
}

export async function runLocalToCloudHandoff(
  { snapshot }: LocalToCloudHandoffInput,
  deps: RunLocalToCloudHandoffDeps,
): Promise<void> {
  const branchName = snapshot.sourcePreflight.branchName?.trim();
  const baseCommitSha = snapshot.sourcePreflight.baseCommitSha?.trim();
  if (!branchName || !baseCommitSha) {
    deps.showToast("Workspace mobility requires a resolved branch and base commit.");
    return;
  }

  let handoffOpId: string | null = null;
  let targetCloudWorkspaceId: string | null = null;
  let finalized = false;
  let cleanupCompleted = false;
  let sourceRemoteOwned = false;

  try {
    const handoff = await deps.startHandoff({
      mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
      input: {
        direction: "local_to_cloud",
        requestedBranch: branchName,
        requestedBaseSha: baseCommitSha,
        excludePaths: snapshot.cloudPreflight.excludedPaths,
      },
    });
    handoffOpId = handoff.id;

    const mobilityDetail = await deps.loadCloudMobilityWorkspaceDetail(snapshot.mobilityWorkspaceId);
    targetCloudWorkspaceId = mobilityDetail.cloudWorkspaceId ?? null;
    if (!targetCloudWorkspaceId) {
      throw new Error("Cloud destination did not resolve.");
    }

    await deps.waitForCloudWorkspaceReady(targetCloudWorkspaceId);
    await deps.invalidateWorkspaceCollections();

    await deps.updateRuntimeState({
      workspaceId: snapshot.sourceWorkspaceId,
      input: {
        mode: "frozen_for_handoff",
        handoffOpId,
      },
    });
    await deps.updatePhase({
      mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
      handoffOpId,
      input: {
        phase: "source_frozen",
        statusDetail: "Source workspace frozen",
      },
    });

    await deps.updatePhase({
      mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
      handoffOpId,
      input: {
        phase: "destination_ready",
        statusDetail: "Destination workspace ready",
        cloudWorkspaceId: targetCloudWorkspaceId,
      },
    });

    const archive = await deps.exportArchive({
      workspaceId: snapshot.sourceWorkspaceId,
      input: {
        excludePaths: snapshot.cloudPreflight.excludedPaths,
        expectedHandoffOpId: handoffOpId,
        expectedBaseCommitSha: baseCommitSha,
        expectedBranchName: branchName,
        requireCleanGitState: true,
      },
    });
    const targetWorkspaceId = cloudWorkspaceSyntheticId(targetCloudWorkspaceId);
    await deps.installArchive({
      workspaceId: targetWorkspaceId,
      archive,
      operationId: handoffOpId,
    });

    await deps.updatePhase({
      mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
      handoffOpId,
      input: {
        phase: "install_succeeded",
        statusDetail: "Archive installed in cloud",
        cloudWorkspaceId: targetCloudWorkspaceId,
      },
    });

    await deps.updateRuntimeState({
      workspaceId: snapshot.sourceWorkspaceId,
      input: {
        mode: "remote_owned",
        handoffOpId,
      },
    });
    sourceRemoteOwned = true;

    await deps.finalizeHandoff({
      mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
      handoffOpId,
      input: {
        cloudWorkspaceId: targetCloudWorkspaceId,
      },
    });
    finalized = true;

    await deps.clearWorkspaceOwnerFlipCache({
      logicalWorkspaceId: snapshot.logicalWorkspaceId,
      previousWorkspaceId: snapshot.sourceWorkspaceId,
      nextCloudWorkspaceId: targetCloudWorkspaceId,
    });
    deps.clearWorkspaceRuntimeState(snapshot.sourceWorkspaceId, { clearSelection: true });
    await deps.refreshWorkspaceCollections();
    await deps.selectWorkspace(targetWorkspaceId, { force: true });

    deps.showMcpNotice(snapshot.logicalWorkspaceId);
    const cleanupHandoffOpId = handoffOpId;
    void (async () => {
      try {
        await deps.cleanupWorkspace({
          workspaceId: snapshot.sourceWorkspaceId,
        });
        deps.clearWorkspaceRuntimeState(snapshot.sourceWorkspaceId);
        await deps.completeCleanup({
          mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
          handoffOpId: cleanupHandoffOpId,
        });
        cleanupCompleted = true;
        await deps.invalidateWorkspaceCollections().catch(() => undefined);
      } catch (cleanupError) {
        if (cleanupCompleted) {
          await deps.invalidateWorkspaceCollections().catch(() => undefined);
          return;
        }
        await deps.failHandoff({
          mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
          handoffOpId: cleanupHandoffOpId,
          input: {
            failureCode: "cleanup_failed",
            failureDetail: cleanupError instanceof Error
              ? cleanupError.message
              : "Source cleanup failed after finalize.",
          },
        }).catch(() => undefined);
        await deps.invalidateWorkspaceCollections().catch(() => undefined);
        deps.showMcpNotice(snapshot.logicalWorkspaceId);
        deps.showToast(cleanupError instanceof Error
          ? cleanupError.message
          : "The workspace moved, but source cleanup needs retry.");
      }
    })();
  } catch (error) {
    const finalizationResolution = !finalized && sourceRemoteOwned && handoffOpId
      ? await deps.resolveFinalizationAfterAmbiguousCutover({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        handoffOpId,
      })
      : "not_finalized";
    const effectiveFinalized = finalized || finalizationResolution === "finalized";
    const failureRecovery = deriveHandoffFailureRecovery({
      handoffStarted: handoffOpId !== null,
      finalized: effectiveFinalized,
      finalizationUnresolved: finalizationResolution === "unknown",
      cleanupCompleted,
    });

    if (handoffOpId && failureRecovery.shouldMarkHandoffFailed) {
      await deps.failHandoff({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        handoffOpId,
        input: {
          failureCode: "handoff_failed",
          failureDetail: error instanceof Error
            ? error.message
            : "Workspace handoff failed.",
        },
      }).catch(() => undefined);
    }

    if (failureRecovery.shouldRestoreSourceRuntimeState) {
      await deps.updateRuntimeState({
        workspaceId: snapshot.sourceWorkspaceId,
        input: {
          mode: "normal",
          handoffOpId: null,
        },
      }).catch(() => undefined);
    }

    if (failureRecovery.shouldRefreshWorkspaceSelection) {
      await deps.invalidateWorkspaceCollections();
      await deps.selectWorkspace(snapshot.logicalWorkspaceId, { force: true }).catch(() => undefined);
    }

    deps.showToast(error instanceof Error ? error.message : "Workspace handoff failed.");
    throw error;
  }
}
