import { useCallback, useMemo } from "react";
import {
  useBootstrapCloudWorkspaceRemoteAccess,
  useDisableCloudWorkspaceRemoteAccess,
  useEnableCloudWorkspaceRemoteAccess,
} from "@/hooks/access/cloud/use-cloud-workspace-remote-access-mutation";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";
import { useCloudTargets } from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/derived/mobility/use-workspace-mobility-state";
import { ensureDesktopDispatchWorker } from "@/lib/access/tauri/cloud-worker";
import { getRuntimeInfo } from "@/lib/access/tauri/runtime";
import { useToastStore } from "@/stores/toast/toast-store";
import { getTarget, type CloudTargetSummary } from "@proliferate/cloud-sdk";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error && typeof error === "object") {
    for (const key of ["message", "detail", "error"] as const) {
      const value = (error as Partial<Record<typeof key, unknown>>)[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return "Remote access update failed.";
}

function needsFreshWorkerEnrollment(error: unknown): boolean {
  return errorMessage(error).includes("needs a fresh enrollment token");
}

function remoteAccessEnabled(exposureState: string | null | undefined): boolean {
  return exposureState === "tracked"
    || exposureState === "live"
    || exposureState === "paused"
    || exposureState === "stale";
}

function remoteAccessAvailableFromWeb(exposureState: string | null | undefined): boolean {
  return exposureState === "tracked" || exposureState === "live";
}

function remoteAccessLabel(exposureState: string | null | undefined): string {
  switch (exposureState) {
    case "live":
      return "Live remotely";
    case "tracked":
      return "Remote access on";
    case "paused":
      return "Remote paused";
    case "stale":
      return "Remote stale";
    default:
      return "Enable remote access";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface WorkerSignalBaseline {
  workerId: string | null;
  readyAt: number | null;
}

function newestTimestamp(...values: Array<string | null | undefined>): number | null {
  const timestamps = values
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter(Number.isFinite);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function workerSignalTimestamp(target: CloudTargetSummary): number | null {
  return newestTimestamp(
    target.update?.currentVersions?.reportedAt,
    target.statusDetail?.lastHeartbeatAt,
    target.statusDetail?.updatedAt,
  );
}

function workerSignalBaseline(target: CloudTargetSummary): WorkerSignalBaseline {
  return {
    workerId: target.update?.currentVersions?.workerId ?? null,
    readyAt: workerSignalTimestamp(target),
  };
}

function isFreshOnlineDispatchTarget(
  target: CloudTargetSummary,
  baseline: WorkerSignalBaseline | null,
): boolean {
  if (target.kind !== "desktop_dispatch" || target.status !== "online") {
    return false;
  }
  if (baseline === null) {
    return true;
  }
  const workerId = target.update?.currentVersions?.workerId ?? null;
  if (baseline.workerId && workerId && workerId !== baseline.workerId) {
    return true;
  }
  const readyAt = workerSignalTimestamp(target);
  return readyAt !== null && (
    baseline.readyAt === null
    || readyAt > baseline.readyAt
  );
}

async function waitForOnlineDispatchTarget(
  targetId: string,
  baseline: WorkerSignalBaseline | null = null,
): Promise<CloudTargetSummary> {
  let last: CloudTargetSummary | null = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const target = await getTarget(targetId);
    last = target;
    if (isFreshOnlineDispatchTarget(target, baseline)) {
      return target;
    }
    await sleep(500);
  }
  throw new Error(
    last
      ? "Desktop dispatch worker did not come online."
      : "Desktop dispatch target could not be loaded.",
  );
}

export function useWorkspaceRemoteAccessActions() {
  const mobility = useWorkspaceMobilityState();
  const showToast = useToastStore((state) => state.show);
  const targetsQuery = useCloudTargets();
  const {
    createExistingTargetEnrollment,
    createTargetEnrollment,
    isCreatingExistingTargetEnrollment,
    isCreatingTargetEnrollment,
  } = useCloudTargetMutations();
  const bootstrapMutation = useBootstrapCloudWorkspaceRemoteAccess();
  const enableMutation = useEnableCloudWorkspaceRemoteAccess();
  const disableMutation = useDisableCloudWorkspaceRemoteAccess();

  const logicalWorkspace = mobility.selectedLogicalWorkspace;
  const cloudWorkspace = mobility.selectedLogicalWorkspace?.cloudWorkspace ?? null;
  const cloudWorkspaceId = cloudWorkspace?.id ?? null;
  const localWorkspace = logicalWorkspace?.localWorkspace ?? null;
  const exposureState = cloudWorkspace?.exposureState ?? "untracked";
  const isEnabled = remoteAccessEnabled(exposureState);
  const isAvailableFromWeb = remoteAccessAvailableFromWeb(exposureState);
  const label = remoteAccessLabel(exposureState);
  const dispatchTarget = useMemo(() => (
    (targetsQuery.data ?? []).find((target) => (
      target.kind === "desktop_dispatch"
      && target.ownerScope === "personal"
      && target.status === "online"
    )) ?? null
  ), [targetsQuery.data]);
  const canBootstrap = !cloudWorkspaceId && !!localWorkspace?.id && !targetsQuery.isLoading;
  const isPending = (
    bootstrapMutation.isPending
    || enableMutation.isPending
    || disableMutation.isPending
    || isCreatingTargetEnrollment
    || isCreatingExistingTargetEnrollment
  );
  const disabled = (
    isPending
    || mobility.selectionLocked
    || (!cloudWorkspaceId && !canBootstrap)
  );
  const title = cloudWorkspaceId
    ? (
        isEnabled
          ? "Disable web and mobile access for this workspace"
          : "Backfill this workspace and keep it available from web and mobile"
      )
    : !localWorkspace?.id
      ? "Select a local workspace to enable remote access."
      : targetsQuery.isLoading
        ? "Checking for an online Desktop dispatch target."
        : dispatchTarget
          ? "Create a Cloud record for this local workspace and start syncing it."
          : "Start Desktop dispatch sync and make this workspace available from web and mobile.";
  const syncToWebDisabledReason = isPending
    ? "Remote access update already in progress."
    : mobility.selectionLocked
      ? "Workspace sync is still finishing."
      : (!cloudWorkspaceId && !canBootstrap)
        ? title
        : null;

  const ensureDispatchTarget = useCallback(async () => {
    if (dispatchTarget) {
      const baseline = workerSignalBaseline(dispatchTarget);
      try {
        await ensureDesktopDispatchWorker({
          targetId: dispatchTarget.id,
          enrollmentToken: null,
        });
      } catch (error) {
        if (!needsFreshWorkerEnrollment(error)) {
          throw error;
        }
        const enrollment = await createExistingTargetEnrollment({
          targetId: dispatchTarget.id,
          body: {},
        });
        await ensureDesktopDispatchWorker({
          targetId: enrollment.target.id,
          enrollmentToken: enrollment.enrollmentToken,
        });
      }
      const target = await waitForOnlineDispatchTarget(dispatchTarget.id, baseline);
      void targetsQuery.refetch();
      return target;
    }
    const runtime = await getRuntimeInfo();
    if (runtime.status !== "healthy") {
      throw new Error("AnyHarness must be healthy before remote access can start.");
    }
    const enrollment = await createTargetEnrollment({
      displayName: "This Mac",
      kind: "desktop_dispatch",
      ownerScope: "personal",
      organizationId: null,
      defaultWorkspaceRoot: null,
    });
    await ensureDesktopDispatchWorker({
      targetId: enrollment.target.id,
      enrollmentToken: enrollment.enrollmentToken,
    });
    const target = await waitForOnlineDispatchTarget(enrollment.target.id);
    void targetsQuery.refetch();
    return target;
  }, [createExistingTargetEnrollment, createTargetEnrollment, dispatchTarget, targetsQuery]);

  const ensureWorkspaceSyncWorker = useCallback(async () => {
    if (
      cloudWorkspace?.sandboxType === "local"
      && cloudWorkspace.targetId
    ) {
      const existingTarget = await getTarget(cloudWorkspace.targetId);
      const baseline = workerSignalBaseline(existingTarget);
      try {
        await ensureDesktopDispatchWorker({
          targetId: cloudWorkspace.targetId,
          enrollmentToken: null,
        });
      } catch (error) {
        if (!needsFreshWorkerEnrollment(error)) {
          throw error;
        }
        const enrollment = await createExistingTargetEnrollment({
          targetId: cloudWorkspace.targetId,
          body: {},
        });
        await ensureDesktopDispatchWorker({
          targetId: enrollment.target.id,
          enrollmentToken: enrollment.enrollmentToken,
        });
      }
      await waitForOnlineDispatchTarget(cloudWorkspace.targetId, baseline);
      void targetsQuery.refetch();
      return;
    }
  }, [cloudWorkspace, createExistingTargetEnrollment, targetsQuery]);

  const enableRemoteAccess = useCallback(async () => {
    try {
      if (cloudWorkspaceId && isAvailableFromWeb) {
        showToast("Workspace is already available from web.", "info");
      } else if (cloudWorkspaceId) {
        await ensureWorkspaceSyncWorker();
        await enableMutation.mutateAsync(cloudWorkspaceId);
        showToast("Remote access enabled.");
      } else if (localWorkspace?.id) {
        const target = await ensureDispatchTarget();
        const branch = (
          localWorkspace.currentBranch
          ?? logicalWorkspace?.branchKey
          ?? "default"
        ).trim() || "default";
        await bootstrapMutation.mutateAsync({
          targetId: target.id,
          anyharnessWorkspaceId: localWorkspace.id,
          displayName: logicalWorkspace?.displayName ?? localWorkspace.displayName ?? null,
          repo: {
            provider: logicalWorkspace?.provider ?? localWorkspace.gitProvider ?? "local",
            owner: logicalWorkspace?.owner ?? localWorkspace.gitOwner ?? "local",
            name: logicalWorkspace?.repoName ?? localWorkspace.gitRepoName ?? localWorkspace.id,
            branch,
            baseBranch: localWorkspace.originalBranch ?? branch,
          },
        });
        showToast("Remote access enabled.");
      }
    } catch (error) {
      console.error("Remote access update failed", error);
      showToast(errorMessage(error));
    }
  }, [
    bootstrapMutation,
    cloudWorkspaceId,
    enableMutation,
    ensureDispatchTarget,
    ensureWorkspaceSyncWorker,
    isAvailableFromWeb,
    localWorkspace,
    logicalWorkspace,
    showToast,
  ]);

  const handleClick = useCallback(async () => {
    if (disabled) {
      return;
    }
    if (cloudWorkspaceId && isEnabled) {
      try {
        await disableMutation.mutateAsync(cloudWorkspaceId);
        showToast("Remote access disabled.");
      } catch (error) {
        console.error("Remote access update failed", error);
        showToast(errorMessage(error));
      }
      return;
    }

    await enableRemoteAccess();
  }, [
    cloudWorkspaceId,
    disabled,
    disableMutation,
    enableRemoteAccess,
    isEnabled,
    showToast,
  ]);

  const syncToWeb = useCallback(() => {
    if (syncToWebDisabledReason) {
      showToast(syncToWebDisabledReason);
      return;
    }

    void enableRemoteAccess();
  }, [enableRemoteAccess, showToast, syncToWebDisabledReason]);

  return {
    disabled,
    handleClick,
    isEnabled,
    isPending,
    label,
    syncToWeb,
    syncToWebDisabledReason,
    title,
  };
}
