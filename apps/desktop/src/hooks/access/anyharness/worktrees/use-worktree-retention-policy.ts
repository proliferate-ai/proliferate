import { useQuery } from "@tanstack/react-query";
import { getWorktreeRetentionPolicy } from "#product/lib/access/anyharness/worktrees";
import {
  type WorktreeSettingsTarget,
  worktreeSettingsTargetRuntimeConnection,
} from "#product/lib/domain/workspaces/worktrees/worktree-settings-target";
import { worktreeSettingsTargetRetentionPolicyKey } from "#product/hooks/access/anyharness/worktrees/query-keys";

export function useWorktreeRetentionPolicy(
  target: WorktreeSettingsTarget | null,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: target
      ? worktreeSettingsTargetRetentionPolicyKey(target)
      : ["worktree-settings", "retention-policy", "missing"] as const,
    queryFn: async () => {
      if (!target) {
        throw new Error("Worktree settings target is unavailable.");
      }
      return getWorktreeRetentionPolicy(worktreeSettingsTargetRuntimeConnection(target));
    },
    enabled: options.enabled && target !== null,
    retry: 1,
  });
}
