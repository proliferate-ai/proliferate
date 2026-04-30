import { useEffect, useMemo } from "react";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useDeferredHomeLaunchStore } from "@/stores/home/deferred-home-launch-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

const DEFERRED_HOME_LAUNCH_STALE_MS = 60 * 60 * 1000;

function shouldClearAsMissing(input: {
  cloudWorkspaceId: string;
  knownCloudWorkspaceIds: Set<string>;
  isWorkspaceDataAuthoritative: boolean;
}): boolean {
  return input.isWorkspaceDataAuthoritative
    && !input.knownCloudWorkspaceIds.has(input.cloudWorkspaceId);
}

export function useHomeDeferredLaunchRunner() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const launchesById = useDeferredHomeLaunchStore((state) => state.launches);
  const markConsuming = useDeferredHomeLaunchStore((state) => state.markConsuming);
  const markPending = useDeferredHomeLaunchStore((state) => state.markPending);
  const clear = useDeferredHomeLaunchStore((state) => state.clear);
  const { createSessionWithResolvedConfig } = useSessionActions();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const {
    data: workspaceCollections,
    isSuccess: workspaceCollectionsLoaded,
  } = useWorkspaces();
  const showToast = useToastStore((state) => state.show);

  const launches = useMemo(() => Object.values(launchesById), [launchesById]);

  const knownCloudWorkspaceIds = useMemo(() => new Set(
    (workspaceCollections?.cloudWorkspaces ?? []).map((workspace) => workspace.id),
  ), [workspaceCollections?.cloudWorkspaces]);

  useEffect(() => {
    const now = Date.now();
    for (const launch of launches) {
      if (now - launch.createdAt > DEFERRED_HOME_LAUNCH_STALE_MS) {
        clear(launch.id);
        continue;
      }
      if (shouldClearAsMissing({
        cloudWorkspaceId: launch.cloudWorkspaceId,
        knownCloudWorkspaceIds,
        isWorkspaceDataAuthoritative: workspaceCollectionsLoaded,
      })) {
        clear(launch.id);
      }
    }
  }, [clear, knownCloudWorkspaceIds, launches, workspaceCollectionsLoaded]);

  const readyLaunch = launches.find((launch) =>
    launch.status === "pending"
    && launch.workspaceId === selectedWorkspaceId
    && selectedCloudRuntime.workspaceId === launch.workspaceId
    && selectedCloudRuntime.cloudWorkspaceId === launch.cloudWorkspaceId
    && selectedCloudRuntime.state?.phase === "ready"
  ) ?? null;

  useEffect(() => {
    if (!readyLaunch) {
      return;
    }

    let cancelled = false;
    const consume = async () => {
      if (!markConsuming(readyLaunch.id)) {
        return;
      }

      try {
        await createSessionWithResolvedConfig({
          workspaceId: readyLaunch.workspaceId,
          agentKind: readyLaunch.agentKind,
          modelId: readyLaunch.modelId,
          text: readyLaunch.promptText,
          ...(readyLaunch.modeId ? { modeId: readyLaunch.modeId } : {}),
        });
        // Clear even if the hook re-ran mid-flight; the prompt was sent, so a remount must not retry it.
        clear(readyLaunch.id);
      } catch {
        if (cancelled) {
          markPending(readyLaunch.id);
          return;
        }

        const stillExists = knownCloudWorkspaceIds.has(readyLaunch.cloudWorkspaceId);
        if (!stillExists) {
          clear(readyLaunch.id);
          showToast("Deferred cloud launch was cancelled because the workspace is gone.");
          return;
        }

        markPending(readyLaunch.id);
        showToast("Cloud workspace is ready, but the queued prompt could not be sent yet.");
      }
    };

    void consume();

    return () => {
      cancelled = true;
    };
  }, [
    clear,
    createSessionWithResolvedConfig,
    knownCloudWorkspaceIds,
    markConsuming,
    markPending,
    readyLaunch,
    showToast,
  ]);
}
