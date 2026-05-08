import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useCloudWorktreeRetentionPolicy,
  usePutCloudWorktreeRetentionPolicy,
} from "@/hooks/access/cloud/use-cloud-worktree-retention-policy";
import { useWorktreeRetentionPolicy } from "@/hooks/access/anyharness/worktrees/use-worktree-retention-policy";
import { useHasPendingWorktreeAutoDeleteAdoption } from "@/hooks/preferences/derived/use-pending-worktree-auto-delete-adoption";
import { useWorktreeAutoDeleteAdoption } from "@/hooks/preferences/workflows/use-worktree-auto-delete-adoption";
import {
  WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
} from "@/lib/domain/preferences/user-preferences";
import type { WorktreeSettingsTarget } from "@/lib/domain/workspaces/worktrees/worktree-settings-target";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

const seededCloudPolicyRuntimeKeys = new Set<string>();
const syncedPolicyKeys = new Set<string>();
const deferredRunKeys = new Set<string>();

export type SyncPolicyToTarget = (
  target: WorktreeSettingsTarget,
  maxMaterializedWorktreesPerRepo: number,
  options?: { runDeferredCleanup?: boolean },
) => Promise<void>;

export interface WorktreeCleanupPolicySyncTargetState {
  target: WorktreeSettingsTarget;
}

export interface WorktreeCleanupPolicySyncState {
  effectiveValue: number;
  resolvedValue: number | null;
  cloudLoading: boolean;
  cloudPolicyUnavailable: boolean;
  clearStatusMessage: () => void;
  statusMessage: string | null;
}

// Owns background adoption/synchronization for the global worktree cleanup policy.
// The settings pane facade owns user-edit draft state and the explicit Apply action.
export function useWorktreeCleanupPolicySync(
  targets: WorktreeCleanupPolicySyncTargetState[],
  syncPolicyToTarget: SyncPolicyToTarget,
): WorktreeCleanupPolicySyncState {
  const authStatus = useAuthStore((state) => state.status);
  const preferenceValue = useUserPreferencesStore((state) => state.worktreeAutoDeleteLimit);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const preferencesHydrated = useUserPreferencesStore((state) => state._hydrated);
  const adoptionPending = useHasPendingWorktreeAutoDeleteAdoption();
  const markWorktreeAutoDeleteLimitAdopted = useWorktreeAutoDeleteAdoption();
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);
  const cloudPolicy = useCloudWorktreeRetentionPolicy();
  const putCloudPolicy = usePutCloudWorktreeRetentionPolicy();
  const putCloudPolicyAsync = putCloudPolicy.mutateAsync;

  const localTarget = targets.find((targetState) => targetState.target.location === "local")
    ?.target ?? null;
  const localPolicyQuery = useWorktreeRetentionPolicy(localTarget, {
    enabled: preferencesHydrated && adoptionPending,
  });

  const resolvedValue = useMemo(() => {
    if (authStatus === "bootstrapping") {
      return null;
    }
    if (
      authStatus === "authenticated"
      && cloudPolicy.data === undefined
      && !cloudPolicy.isError
    ) {
      return null;
    }
    if (authStatus === "authenticated" && cloudPolicy.data?.source === "persisted") {
      return cloudPolicy.data.maxMaterializedWorktreesPerRepo;
    }
    if (
      authStatus === "authenticated"
      && cloudPolicy.data?.source === "default"
      && adoptionPending
      && !localPolicyQuery.isError
      && localPolicyQuery.data === undefined
    ) {
      return null;
    }
    return preferenceValue;
  }, [
    adoptionPending,
    authStatus,
    cloudPolicy.data,
    cloudPolicy.isError,
    localPolicyQuery.data,
    localPolicyQuery.isError,
    preferenceValue,
  ]);

  const effectiveValue = resolvedValue ?? preferenceValue;

  useEffect(() => {
    if (!preferencesHydrated || !adoptionPending) {
      return;
    }

    if (authStatus === "authenticated" && cloudPolicy.data?.source === "persisted") {
      setPreference("worktreeAutoDeleteLimit", cloudPolicy.data.maxMaterializedWorktreesPerRepo);
      void markWorktreeAutoDeleteLimitAdopted();
      return;
    }

    const localPolicyValue = localPolicyQuery.data?.maxMaterializedWorktreesPerRepo;
    if (localPolicyValue === undefined) {
      return;
    }

    if (
      authStatus === "authenticated"
      && cloudPolicy.data?.source === "default"
      && localPolicyValue !== WORKTREE_AUTO_DELETE_LIMIT_DEFAULT
    ) {
      if (!localTarget || seededCloudPolicyRuntimeKeys.has(localTarget.key)) {
        return;
      }
      seededCloudPolicyRuntimeKeys.add(localTarget.key);
      void putCloudPolicyAsync({
        maxMaterializedWorktreesPerRepo: localPolicyValue,
      }).then(() => {
        setPreference("worktreeAutoDeleteLimit", localPolicyValue);
        return markWorktreeAutoDeleteLimitAdopted();
      }).catch((error) => {
        seededCloudPolicyRuntimeKeys.delete(localTarget.key);
        setLocalErrorMessage(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    if (authStatus !== "authenticated" || cloudPolicy.data?.source === "default") {
      setPreference("worktreeAutoDeleteLimit", localPolicyValue);
      void markWorktreeAutoDeleteLimitAdopted();
    }
  }, [
    adoptionPending,
    authStatus,
    cloudPolicy.data,
    localTarget,
    localPolicyQuery.data,
    markWorktreeAutoDeleteLimitAdopted,
    preferencesHydrated,
    putCloudPolicyAsync,
    setPreference,
  ]);

  useEffect(() => {
    if (
      !preferencesHydrated
      || authStatus === "bootstrapping"
      || resolvedValue === null
      || adoptionPending
    ) {
      return;
    }
    for (const targetState of targets) {
      const key = `${targetState.target.key}:${resolvedValue}`;
      if (syncedPolicyKeys.has(key)) {
        continue;
      }
      syncedPolicyKeys.add(key);
      const runKey = targetState.target.key;
      const runDeferredCleanup = !deferredRunKeys.has(runKey);
      if (runDeferredCleanup) {
        deferredRunKeys.add(runKey);
      }
      void syncPolicyToTarget(targetState.target, resolvedValue, {
        runDeferredCleanup,
      }).catch((error) => {
        syncedPolicyKeys.delete(key);
        if (runDeferredCleanup) {
          deferredRunKeys.delete(runKey);
        }
        setLocalErrorMessage(error instanceof Error ? error.message : String(error));
      });
    }
  }, [
    adoptionPending,
    authStatus,
    preferencesHydrated,
    resolvedValue,
    syncPolicyToTarget,
    targets,
  ]);

  const cloudLoading = authStatus === "authenticated"
    && cloudPolicy.isLoading
    && cloudPolicy.data === undefined;
  const cloudPolicyUnavailable = authStatus === "authenticated" && cloudPolicy.isError;
  const statusMessage = localErrorMessage
    ?? (adoptionPending ? "Waiting for existing runtime policy." : null)
    ?? (cloudPolicyUnavailable
      ? "Cloud policy is unavailable; using local fallback."
      : null);
  const clearStatusMessage = useCallback(() => {
    setLocalErrorMessage(null);
  }, []);

  return {
    effectiveValue,
    resolvedValue,
    cloudLoading,
    cloudPolicyUnavailable,
    clearStatusMessage,
    statusMessage,
  };
}
