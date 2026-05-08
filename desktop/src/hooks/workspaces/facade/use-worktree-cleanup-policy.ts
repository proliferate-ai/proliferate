import { useCallback, useState } from "react";
import { usePutCloudWorktreeRetentionPolicy } from "@/hooks/access/cloud/use-cloud-worktree-retention-policy";
import { useWorktreeAutoDeleteAdoption } from "@/hooks/preferences/workflows/use-worktree-auto-delete-adoption";
import {
  type SyncPolicyToTarget,
  type WorktreeCleanupPolicySyncTargetState,
  useWorktreeCleanupPolicySync,
} from "@/hooks/workspaces/lifecycle/use-worktree-cleanup-policy-sync";
import {
  WORKTREE_AUTO_DELETE_LIMIT_MAX,
  WORKTREE_AUTO_DELETE_LIMIT_MIN,
} from "@/lib/domain/preferences/user-preferences";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

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

// Owns the Worktree Settings pane policy view-model. Background runtime sync
// lives in the lifecycle hook; this facade owns draft state and Apply.
export function useWorktreeCleanupPolicy(
  targets: WorktreeCleanupPolicySyncTargetState[],
  syncPolicyToTarget: SyncPolicyToTarget,
): WorktreeCleanupPolicyState {
  const authStatus = useAuthStore((state) => state.status);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const markWorktreeAutoDeleteLimitAdopted = useWorktreeAutoDeleteAdoption();
  const [draftValue, setDraftValue] = useState("");
  const syncState = useWorktreeCleanupPolicySync(targets, syncPolicyToTarget);
  const putCloudPolicy = usePutCloudWorktreeRetentionPolicy();
  const putCloudPolicyAsync = putCloudPolicy.mutateAsync;

  const parsedDraft = parseLimit(draftValue || String(syncState.effectiveValue));
  const canApply = !syncState.cloudLoading && validLimit(parsedDraft);
  const applyDisabledReason = syncState.cloudLoading
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
    if (authStatus === "authenticated" && !syncState.cloudPolicyUnavailable) {
      if (syncState.cloudLoading) {
        throw new Error("Cloud policy is still loading.");
      }
      await putCloudPolicyAsync({
        maxMaterializedWorktreesPerRepo: parsedDraft,
      });
    }
    setPreference("worktreeAutoDeleteLimit", parsedDraft);
    await markWorktreeAutoDeleteLimitAdopted();
    setDraftValue("");
    syncState.clearStatusMessage();
  }, [
    authStatus,
    markWorktreeAutoDeleteLimitAdopted,
    parsedDraft,
    putCloudPolicyAsync,
    setPreference,
    syncState.clearStatusMessage,
    syncState.cloudLoading,
    syncState.cloudPolicyUnavailable,
  ]);

  return {
    value: syncState.effectiveValue,
    draftValue: draftValue || String(syncState.effectiveValue),
    setDraftValue,
    parsedDraft,
    canApply,
    applyDisabledReason,
    statusMessage: syncState.statusMessage,
    isApplying: putCloudPolicy.isPending,
    apply,
  };
}
