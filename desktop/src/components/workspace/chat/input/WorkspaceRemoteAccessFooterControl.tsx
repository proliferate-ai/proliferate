import { useCallback, useMemo } from "react";
import {
  useBootstrapCloudWorkspaceRemoteAccess,
  useDisableCloudWorkspaceRemoteAccess,
  useEnableCloudWorkspaceRemoteAccess,
} from "@/hooks/access/cloud/use-cloud-workspace-remote-access-mutation";
import { useCloudTargets } from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { getProliferateClient } from "@/lib/access/cloud/client";
import { ensureDesktopDispatchWorker } from "@/lib/access/tauri/cloud-worker";
import { getRuntimeInfo } from "@/lib/access/tauri/runtime";
import { useToastStore } from "@/stores/toast/toast-store";
import { getTarget, type CloudTargetSummary } from "@proliferate/cloud-sdk";
import { Globe, Spinner } from "@/components/ui/icons";
import { ComposerControlButton } from "./ComposerControlButton";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Remote access update failed.";
}

function remoteAccessEnabled(exposureState: string | null | undefined): boolean {
  return exposureState === "tracked"
    || exposureState === "live"
    || exposureState === "paused"
    || exposureState === "stale";
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

async function waitForOnlineDispatchTarget(targetId: string): Promise<CloudTargetSummary> {
  let last: CloudTargetSummary | null = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const target = await getTarget(targetId);
    last = target;
    if (target.kind === "desktop_dispatch" && target.status === "online") {
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

export function WorkspaceRemoteAccessFooterControl() {
  const mobility = useWorkspaceMobilityState();
  const showToast = useToastStore((state) => state.show);
  const targetsQuery = useCloudTargets();
  const { createTargetEnrollment, isCreatingTargetEnrollment } = useCloudTargetMutations();
  const bootstrapMutation = useBootstrapCloudWorkspaceRemoteAccess();
  const enableMutation = useEnableCloudWorkspaceRemoteAccess();
  const disableMutation = useDisableCloudWorkspaceRemoteAccess();

  const logicalWorkspace = mobility.selectedLogicalWorkspace;
  const cloudWorkspace = mobility.selectedLogicalWorkspace?.cloudWorkspace ?? null;
  const cloudWorkspaceId = cloudWorkspace?.id ?? null;
  const localWorkspace = logicalWorkspace?.localWorkspace ?? null;
  const exposureState = cloudWorkspace?.exposureState ?? "untracked";
  const isEnabled = remoteAccessEnabled(exposureState);
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

  const ensureDispatchTarget = useCallback(async () => {
    if (dispatchTarget) {
      return dispatchTarget;
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
      cloudBaseUrl: getProliferateClient().baseUrl,
      anyharnessBaseUrl: runtime.url,
    });
    const target = await waitForOnlineDispatchTarget(enrollment.target.id);
    void targetsQuery.refetch();
    return target;
  }, [createTargetEnrollment, dispatchTarget, targetsQuery]);

  const handleClick = useCallback(async () => {
    if (disabled) {
      return;
    }
    try {
      if (cloudWorkspaceId && isEnabled) {
        await disableMutation.mutateAsync(cloudWorkspaceId);
        showToast("Remote access disabled.");
      } else if (cloudWorkspaceId) {
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
      showToast(errorMessage(error));
    }
  }, [
    bootstrapMutation,
    cloudWorkspaceId,
    disabled,
    disableMutation,
    enableMutation,
    ensureDispatchTarget,
    isEnabled,
    localWorkspace,
    logicalWorkspace,
    showToast,
  ]);

  return (
    <ComposerControlButton
      icon={isPending ? <Spinner className="size-3.5" /> : <Globe className="size-3.5" />}
      label={isPending ? "Updating access" : remoteAccessLabel(exposureState)}
      tone={isEnabled ? "info" : "neutral"}
      active={isEnabled}
      disabled={disabled}
      onClick={handleClick}
      title={title}
    />
  );
}
