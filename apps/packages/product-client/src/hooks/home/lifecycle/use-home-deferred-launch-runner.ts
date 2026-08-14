import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import {
  useDeferredHomeLaunchStore,
  type DeferredHomeLaunch,
} from "#product/stores/home/deferred-home-launch-store";
import {
  resolveChatLaunchRetryMode,
  type ChatLaunchRetryMode,
} from "#product/lib/domain/chat/launch/launch-intent";
import { launchIntent } from "#product/lib/domain/chat/launch/launch-intent-registry";
import {
  resolveDeferredLaunchReadiness,
} from "#product/lib/domain/home/deferred-launch-readiness";
import {
  pendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  isLaunchAttemptAttended,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";

const DEFERRED_HOME_LAUNCH_STALE_MS = 60 * 60 * 1000;

const EMPTY_DEFERRED_LAUNCHES: readonly DeferredHomeLaunch[] = [];

function shouldClearAsMissing(input: {
  cloudWorkspaceId: string;
  knownCloudWorkspaceIds: Set<string>;
  isWorkspaceDataAuthoritative: boolean;
}): boolean {
  return input.isWorkspaceDataAuthoritative
    && !input.knownCloudWorkspaceIds.has(input.cloudWorkspaceId);
}

function launchFailureRetryMode(intentId: string): ChatLaunchRetryMode {
  return resolveChatLaunchRetryMode(
    launchIntent(useChatLaunchIntentStore.getState(), intentId),
  );
}

// Owns deferred cloud launch consumption. Does not own initial Home launch initiation.
export function useHomeDeferredLaunchRunner() {
  const launchesById = useDeferredHomeLaunchStore((state) => state.launches);
  const pendingWorkspaces = useSessionSelectionStore((state) => state.pendingWorkspaces);
  const markConsuming = useDeferredHomeLaunchStore((state) => state.markConsuming);
  const markPending = useDeferredHomeLaunchStore((state) => state.markPending);
  const clear = useDeferredHomeLaunchStore((state) => state.clear);
  const failLaunchIntent = useChatLaunchIntentStore((state) => state.fail);
  const { createSessionWithResolvedConfig } = useSessionCreationActions();
  const {
    data: workspaceCollections,
    isSuccess: workspaceCollectionsLoaded,
  } = useWorkspaces();
  const showToast = useToastStore((state) => state.show);

  const launches = useMemo(() => Object.values(launchesById), [launchesById]);

  const knownCloudWorkspaceIds = useMemo(() => new Set(
    (workspaceCollections?.cloudWorkspaces ?? []).map((workspace) => workspace.id),
  ), [workspaceCollections?.cloudWorkspaces]);
  const knownCloudWorkspaceIdsRef = useRef(knownCloudWorkspaceIds);
  knownCloudWorkspaceIdsRef.current = knownCloudWorkspaceIds;

  const cloudWorkspacesById = useMemo(() => {
    const byId = new Map<string, CloudWorkspaceSummary>();
    for (const workspace of workspaceCollections?.cloudWorkspaces ?? []) {
      byId.set(workspace.id, workspace);
    }
    return byId;
  }, [workspaceCollections?.cloudWorkspaces]);

  useEffect(() => {
    const now = Date.now();
    for (const launch of launches) {
      if (now - launch.createdAt > DEFERRED_HOME_LAUNCH_STALE_MS) {
        clear(launch.id);
        failLaunchIntent(launch.launchIntentId, {
          message: "Cloud workspace did not become ready in time.",
          retryMode: launchFailureRetryMode(launch.launchIntentId),
        });
        continue;
      }
      if (shouldClearAsMissing({
        cloudWorkspaceId: launch.cloudWorkspaceId,
        knownCloudWorkspaceIds,
        isWorkspaceDataAuthoritative: workspaceCollectionsLoaded,
      })) {
        clear(launch.id);
        failLaunchIntent(launch.launchIntentId, {
          message: "Cloud workspace was removed before the queued prompt could send.",
          retryMode: "safe",
        });
      }
    }
  }, [
    clear,
    failLaunchIntent,
    knownCloudWorkspaceIds,
    launches,
    workspaceCollectionsLoaded,
  ]);

  // Readiness is asked per launch, from that launch's own workspace record and
  // registry entry, so a launch promotes while the user is looking somewhere
  // else (PRO-230).
  const launchesByReadiness = useMemo(() => {
    const ready: DeferredHomeLaunch[] = [];
    const failed: DeferredHomeLaunch[] = [];
    for (const launch of launches) {
      if (launch.status !== "pending") {
        continue;
      }
      const readiness = resolveDeferredLaunchReadiness({
        cloudWorkspace: cloudWorkspacesById.get(launch.cloudWorkspaceId) ?? null,
        pendingEntry: pendingWorkspaceEntry(pendingWorkspaces, launch.cloudAttemptId),
      });
      if (readiness === "ready") {
        ready.push(launch);
      } else if (readiness === "failed") {
        failed.push(launch);
      }
    }
    return {
      ready: ready.length > 0 ? ready : EMPTY_DEFERRED_LAUNCHES,
      failed: failed.length > 0 ? failed : EMPTY_DEFERRED_LAUNCHES,
    };
  }, [cloudWorkspacesById, launches, pendingWorkspaces]);

  const failedLaunchKey = launchesByReadiness.failed.map((launch) => launch.id).join("|");
  const failedLaunchesRef = useRef<readonly DeferredHomeLaunch[]>(EMPTY_DEFERRED_LAUNCHES);
  failedLaunchesRef.current = launchesByReadiness.failed;

  useEffect(() => {
    if (!failedLaunchKey) {
      return;
    }
    for (const launch of failedLaunchesRef.current) {
      clear(launch.id);
      // The provisioning failure already announced itself once per attempt —
      // failed sidebar row plus one toast — so this only releases the queued
      // prompt rather than reporting the same failure a second time.
      failLaunchIntent(launch.launchIntentId, {
        message: "Cloud workspace never became ready, so the queued prompt was not sent.",
        retryMode: launchFailureRetryMode(launch.launchIntentId),
      });
    }
  }, [clear, failedLaunchKey, failLaunchIntent]);

  const consumeLaunch = useCallback(async (
    launch: DeferredHomeLaunch,
    isCancelled: () => boolean,
  ) => {
    if (!markConsuming(launch.id)) {
      return;
    }

    // A background promotion must not steal the camera: unattended, the
    // session is created and its shell intent recorded against the launch's
    // own workspace, and the active session the user is watching is left
    // alone (PRO-230).
    const attended = isLaunchAttemptAttended({
      attemptId: launch.cloudAttemptId,
      workspaceId: launch.workspaceId,
    });

    try {
      await createSessionWithResolvedConfig({
        workspaceId: launch.workspaceId,
        agentKind: launch.agentKind,
        modelId: launch.modelId,
        text: launch.promptText,
        promptId: launch.promptId,
        launchIntentId: launch.launchIntentId,
        launchControlValues: launch.launchControlValues,
        activateOnCreate: attended,
        targetWorkspaceUiKey: attended ? null : launch.workspaceId,
        ...(launch.modeId ? { modeId: launch.modeId } : {}),
      });
      // Clear even if the hook re-ran mid-flight; the prompt was sent, so a remount must not retry it.
      clear(launch.id);
      useChatLaunchIntentStore.getState().clear(launch.launchIntentId);
    } catch {
      if (isCancelled()) {
        markPending(launch.id);
        return;
      }

      const stillExists = knownCloudWorkspaceIdsRef.current.has(launch.cloudWorkspaceId);
      if (!stillExists) {
        clear(launch.id);
        failLaunchIntent(launch.launchIntentId, {
          message: "Cloud workspace was removed before the queued prompt could send.",
          retryMode: "safe",
        });
        showToast("Deferred cloud launch was cancelled because the workspace is gone.");
        return;
      }

      clear(launch.id);
      failLaunchIntent(launch.launchIntentId, {
        message: "Cloud workspace is ready, but the queued prompt could not be sent.",
        retryMode: launchFailureRetryMode(launch.launchIntentId),
      });
      showToast("Cloud workspace is ready, but the queued prompt could not be sent.");
    }
  }, [
    clear,
    createSessionWithResolvedConfig,
    failLaunchIntent,
    markConsuming,
    markPending,
    showToast,
  ]);

  const readyLaunchKey = launchesByReadiness.ready.map((launch) => launch.id).join("|");
  const readyLaunchesRef = useRef<readonly DeferredHomeLaunch[]>(EMPTY_DEFERRED_LAUNCHES);
  readyLaunchesRef.current = launchesByReadiness.ready;

  useEffect(() => {
    if (!readyLaunchKey) {
      return;
    }

    let cancelled = false;
    // Each launch consumes on its own; `markConsuming` is the single-flight
    // guard, so a second launch becoming ready cannot restart the first.
    for (const launch of readyLaunchesRef.current) {
      void consumeLaunch(launch, () => cancelled);
    }

    return () => {
      cancelled = true;
    };
  }, [consumeLaunch, readyLaunchKey]);
}
