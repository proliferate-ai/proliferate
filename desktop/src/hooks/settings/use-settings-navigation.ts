import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type SettingsSection, type SettingsStaticSection } from "@/config/settings";
import { type SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import {
  buildSettingsHref,
  resolveSettingsSelection,
} from "@/lib/domain/settings/navigation";

interface UseSettingsNavigationArgs {
  repositories: SettingsRepositoryEntry[];
}

export function useSettingsNavigation({
  repositories,
}: UseSettingsNavigationArgs) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const rawSection = searchParams.get("section");
  const rawRepo = searchParams.get("repo");
  const rawCloudRepoOwner = searchParams.get("cloudRepoOwner");
  const rawCloudRepoName = searchParams.get("cloudRepoName");

  const selection = useMemo(() => resolveSettingsSelection({
    rawSection,
    rawRepo,
    rawCloudRepoOwner,
    rawCloudRepoName,
    repositories,
  }), [
    rawCloudRepoName,
    rawCloudRepoOwner,
    rawRepo,
    rawSection,
    repositories,
  ]);

  useEffect(() => {
    const expectedHref = buildSettingsHref({
      section: selection.activeSection,
      repo: selection.activeRepoSourceRoot,
    });
    const currentHref = `/settings?${searchParams.toString()}`;

    if (expectedHref !== currentHref) {
      navigate(expectedHref, { replace: true });
    }
  }, [
    navigate,
    searchParams,
    selection.activeRepoSourceRoot,
    selection.activeSection,
  ]);

  const navigateTo = useCallback((next: {
    section: SettingsSection;
    repo?: string | null;
  }) => {
    navigate(buildSettingsHref(next));
  }, [navigate]);

  const selectSection = useCallback((section: SettingsStaticSection) => {
    navigateTo({ section });
  }, [navigateTo]);

  const selectRepo = useCallback((sourceRoot: string) => {
    navigateTo({
      section: "repo",
      repo: sourceRoot,
    });
  }, [navigateTo]);

  return {
    ...selection,
    selectSection,
    selectRepo,
  };
}
