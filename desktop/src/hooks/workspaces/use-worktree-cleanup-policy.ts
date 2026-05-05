import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCloudWorktreeRetentionPolicy, usePutCloudWorktreeRetentionPolicy } from "@/hooks/cloud/use-cloud-worktree-retention-policy";
import {
  hasPendingWorktreeAutoDeleteLimitAdoption,
  markWorktreeAutoDeleteLimitAdopted,
  useUserPreferencesStore,
  WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
  WORKTREE_AUTO_DELETE_LIMIT_MAX,
  WORKTREE_AUTO_DELETE_LIMIT_MIN,
} from "@/stores/preferences/user-preferences-store";
import { useAuthStore } from "@/stores/auth/auth-store";
import type {
  WorktreeSettingsTarget,
  WorktreeSettingsTargetState,
} from "./use-worktree-settings-targets";

const seededCloudPolicyRuntimeKeys = new Set<string>();
const syncedPolicyKeys = new Set<string>();
const deferredRunKeys = new Set<string>();

type SyncPolicyToTarget = (
  target: WorktreeSettingsTarget,
  maxMaterializedWorktreesPerRepo: number,
  options?: { runDeferredCleanup?: boolean },
) => Promise<void>;

export interface WorktreeCleanupPolicyState {
  value: number;
  draftValue: string;
  setDraftValue: (value: string) => void;
  parsedDraft: number;
  canApply: boolean;
  applyDisabledReason: string | null;
  statusMessage: string | null;
  isApplying: boolean;
  apply: () => Promise<void>;
}

function parseLimit(value: string): number {
  return Number.parseInt(value, 10);
}

function validLimit(value: number): boolean {
  return Number.isInteger(value)
    && value >= WORKTREE_AUTO_DELETE_LIMIT_MIN
    && value <= WORKTREE_AUTO_DELETE_LIMIT_MAX;
}

export function useWorktreeCleanupPolicy(
  targets: WorktreeSettingsTargetState[],
  syncPolicyToTarget: SyncPolicyToTarget,
): WorktreeCleanupPolicyState {
  const authStatus = useAuthStore((state) => state.status);
  const preferenceValue = useUserPreferencesStore((state) => state.worktreeAutoDeleteLimit);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const preferencesHydrated = useUserPreferencesStore((state) => state._hydrated);
  const [adoptionPending, setAdoptionPending] = useState(
    () => hasPendingWorktreeAutoDeleteLimitAdoption(),
  );
  const [draftValue, setDraftValue] = useState("");
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);
  const cloudPolicy = useCloudWorktreeRetentionPolicy();
  const putCloudPolicy = usePutCloudWorktreeRetentionPolicy();
  const putCloudPolicyAsync = putCloudPolicy.mutateAsync;

  const localTarget = targets.find((targetState) => targetState.target.location === "local")
    ?.target ?? null;
  const localPolicyQuery = useQuery({
    queryKey: [
      "worktree-settings",
      "local-retention-policy",
      localTarget?.runtimeUrl ?? "",
    ] as const,
    queryFn: async () => {
      if (!localTarget) {
        throw new Error("Local runtime is unavailable.");
      }
      return getAnyHarnessClient({ runtimeUrl: localTarget.runtimeUrl })
        .worktrees.retentionPolicy();
    },
    enabled: preferencesHydrated && adoptionPending && localTarget !== null,
    retry: 1,
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
      void markWorktreeAutoDeleteLimitAdopted().then(() => setAdoptionPending(false));
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
      }).then(() => {
        setAdoptionPending(false);
      }).catch((error) => {
        seededCloudPolicyRuntimeKeys.delete(localTarget.key);
        setLocalErrorMessage(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    if (authStatus !== "authenticated" || cloudPolicy.data?.source === "default") {
      setPreference("worktreeAutoDeleteLimit", localPolicyValue);
      void markWorktreeAutoDeleteLimitAdopted().then(() => setAdoptionPending(false));
    }
  }, [
    adoptionPending,
    authStatus,
    cloudPolicy.data,
    localTarget,
    localPolicyQuery.data,
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

  const parsedDraft = parseLimit(draftValue || String(effectiveValue));
  const cloudLoading = authStatus === "authenticated"
    && cloudPolicy.isLoading
    && cloudPolicy.data === undefined;
  const canApply = !cloudLoading && validLimit(parsedDraft);
  const applyDisabledReason = cloudLoading
    ? "Loading cloud policy."
    : validLimit(parsedDraft)
      ? null
      : `Enter a value from ${WORKTREE_AUTO_DELETE_LIMIT_MIN} to ${WORKTREE_AUTO_DELETE_LIMIT_MAX}.`;

  const apply = useCallback(async () => {
    if (!validLimit(parsedDraft)) {
      throw new Error(
        `Enter a value from ${WORKTREE_AUTO_DELETE_LIMIT_MIN} to ${WORKTREE_AUTO_DELETE_LIMIT_MAX}.`,
      );
    }
    if (authStatus === "authenticated" && !cloudPolicy.isError) {
      if (cloudLoading) {
        throw new Error("Cloud policy is still loading.");
      }
      await putCloudPolicyAsync({
        maxMaterializedWorktreesPerRepo: parsedDraft,
      });
    }
    setPreference("worktreeAutoDeleteLimit", parsedDraft);
    await markWorktreeAutoDeleteLimitAdopted();
    setAdoptionPending(false);
    setDraftValue("");
    setLocalErrorMessage(null);
  }, [
    authStatus,
    cloudLoading,
    cloudPolicy.isError,
    parsedDraft,
    putCloudPolicyAsync,
    setPreference,
  ]);

  const statusMessage = localErrorMessage
    ?? (adoptionPending ? "Waiting for existing runtime policy." : null)
    ?? (authStatus === "authenticated" && cloudPolicy.isError
      ? "Cloud policy is unavailable; using local fallback."
      : null);

  return {
    value: effectiveValue,
    draftValue: draftValue || String(effectiveValue),
    setDraftValue,
    parsedDraft,
    canApply,
    applyDisabledReason,
    statusMessage,
    isApplying: putCloudPolicy.isPending,
    apply,
  };
}
