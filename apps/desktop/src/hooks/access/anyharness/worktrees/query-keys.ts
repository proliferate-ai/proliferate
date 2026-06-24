import type { WorktreeSettingsTarget } from "@/lib/domain/workspaces/worktrees/worktree-settings-target";

export function worktreeSettingsTargetInventoryKey(target: WorktreeSettingsTarget) {
  return [
    "worktree-settings",
    "target",
    target.location,
    target.environmentId ?? target.runtimeUrl,
    target.runtimeGeneration,
  ] as const;
}

export function worktreeSettingsTargetHealthKey(target: WorktreeSettingsTarget) {
  return [
    "worktree-settings",
    "health",
    target.location,
    target.environmentId ?? target.runtimeUrl,
    target.runtimeGeneration,
  ] as const;
}

export function worktreeSettingsTargetRetentionPolicyKey(target: WorktreeSettingsTarget) {
  return [
    "worktree-settings",
    "retention-policy",
    target.location,
    target.environmentId ?? target.runtimeUrl,
    target.runtimeGeneration,
  ] as const;
}
