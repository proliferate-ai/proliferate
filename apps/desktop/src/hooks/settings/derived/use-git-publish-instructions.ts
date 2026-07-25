import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

/**
 * Resolves effective git publish instructions with per-repo override.
 * Resolution order: per-repo instructions (if non-empty) > user-level setting > empty.
 */
export function useGitPublishInstructions(sourceRoot?: string | null): string {
  const userInstructions = useUserPreferencesStore((state) => state.gitPublishInstructions);
  const repoInstructions = useRepoPreferencesStore((state) =>
    sourceRoot ? state.repoConfigs[sourceRoot]?.gitPublishInstructions : undefined,
  );

  if (repoInstructions && repoInstructions.trim()) {
    return repoInstructions;
  }
  return userInstructions;
}
