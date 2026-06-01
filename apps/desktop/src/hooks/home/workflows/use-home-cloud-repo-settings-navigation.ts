import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { buildCloudRepoSettingsHref } from "@/lib/domain/settings/navigation";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

interface CloudRepoSettingsTarget {
  gitOwner?: string | null;
  gitRepoName?: string | null;
}

export function useHomeCloudRepoSettingsNavigation(
  cloudRepoTarget: CloudRepoSettingsTarget | null | undefined,
) {
  const navigate = useNavigate();
  const targetOwner = cloudRepoTarget?.gitOwner?.trim();
  const targetRepoName = cloudRepoTarget?.gitRepoName?.trim();

  return useCallback((repository?: SettingsRepositoryEntry) => {
    const repoTarget = repository
      ? {
        gitOwner: repository.gitOwner?.trim(),
        gitRepoName: repository.gitRepoName?.trim(),
      }
      : {
        gitOwner: targetOwner,
        gitRepoName: targetRepoName,
      };
    const target = repoTarget.gitOwner && repoTarget.gitRepoName
      ? { gitOwner: repoTarget.gitOwner, gitRepoName: repoTarget.gitRepoName }
      : null;
    if (target) {
      navigate(buildCloudRepoSettingsHref(target.gitOwner, target.gitRepoName));
    }
  }, [navigate, targetOwner, targetRepoName]);
}
