import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type SettingsSection } from "@/config/settings";
import {
  cloudRepositoryKey,
  isCloudRepository,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import {
  buildSettingsHref,
  isSettingsSection,
} from "@/lib/domain/settings/navigation";

interface UseSettingsNavigationArgs {
  repositories: SettingsRepositoryEntry[];
}

export function useSettingsNavigation({
  repositories,
}: UseSettingsNavigationArgs) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const repositoryRoots = useMemo(
    () => new Set(repositories.map((repository) => repository.sourceRoot)),
    [repositories],
  );
  const cloudRepoKeys = useMemo(
    () =>
      new Set(
        repositories
          .filter(isCloudRepository)
          .map((repository) => cloudRepositoryKey(repository.gitOwner, repository.gitRepoName)),
      ),
    [repositories],
  );

  const rawSection = searchParams.get("section");
  const rawRepo = searchParams.get("repo");
  const rawCloudRepoOwner = searchParams.get("cloudRepoOwner");
  const rawCloudRepoName = searchParams.get("cloudRepoName");

  const selection = useMemo(() => {
    let section: SettingsSection = isSettingsSection(rawSection)
      ? rawSection
      : "configuration";
    let repoSourceRoot: string | null = section === "repo" ? rawRepo : null;
    let cloudRepoOwner: string | null = section === "cloudRepo" ? rawCloudRepoOwner : null;
    let cloudRepoName: string | null = section === "cloudRepo" ? rawCloudRepoName : null;

    if (section === "repo") {
      if (!repoSourceRoot || !repositoryRoots.has(repoSourceRoot)) {
        const fallbackRepo = repositories[0]?.sourceRoot ?? null;
        if (fallbackRepo) {
          repoSourceRoot = fallbackRepo;
        } else {
          section = "configuration";
          repoSourceRoot = null;
        }
      }
    }

    if (section === "cloudRepo") {
      const cloudRepoKey = cloudRepoOwner && cloudRepoName
        ? cloudRepositoryKey(cloudRepoOwner, cloudRepoName)
        : null;
      if (!cloudRepoKey || !cloudRepoKeys.has(cloudRepoKey)) {
        section = "cloud";
        cloudRepoOwner = null;
        cloudRepoName = null;
      }
    }

    return {
      activeSection: section,
      activeRepoSourceRoot: repoSourceRoot,
      activeCloudRepoOwner: cloudRepoOwner,
      activeCloudRepoName: cloudRepoName,
    };
  }, [
    cloudRepoKeys,
    rawCloudRepoName,
    rawCloudRepoOwner,
    rawRepo,
    rawSection,
    repositories,
    repositoryRoots,
  ]);

  useEffect(() => {
    const expectedHref = buildSettingsHref({
      section: selection.activeSection,
      repo: selection.activeRepoSourceRoot,
      cloudRepoOwner: selection.activeCloudRepoOwner,
      cloudRepoName: selection.activeCloudRepoName,
    });
    const currentHref = `/settings?${searchParams.toString()}`;

    if (expectedHref !== currentHref) {
      navigate(expectedHref, { replace: true });
    }
  }, [
    navigate,
    searchParams,
    selection.activeCloudRepoName,
    selection.activeCloudRepoOwner,
    selection.activeRepoSourceRoot,
    selection.activeSection,
  ]);

  const navigateTo = useCallback((next: {
    section: SettingsSection;
    repo?: string | null;
    cloudRepoOwner?: string | null;
    cloudRepoName?: string | null;
  }) => {
    navigate(buildSettingsHref(next));
  }, [navigate]);

  const selectSection = useCallback((section: Exclude<SettingsSection, "repo" | "cloudRepo">) => {
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
