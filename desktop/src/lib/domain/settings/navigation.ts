import {
  SETTINGS_CONTENT_SECTIONS,
  SETTINGS_DEFAULT_SECTION,
  type SettingsSection,
} from "@/config/settings";
import {
  cloudRepositoryKey,
  isCloudRepository,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";

export function isSettingsSection(value: string | null): value is SettingsSection {
  return SETTINGS_CONTENT_SECTIONS.some((item) => item === value);
}

export function normalizeSettingsSection(value: string | null): SettingsSection {
  if (value === "configuration") {
    return "general";
  }
  if (value === "defaults" || value === "advanced") {
    return "agent-defaults";
  }

  return isSettingsSection(value) ? value : SETTINGS_DEFAULT_SECTION;
}

interface SettingsNavigationTarget {
  section: SettingsSection;
  repo?: string | null;
  inviteHandoff?: string | null;
}

export function buildSettingsHref(target: SettingsNavigationTarget): string {
  const params = new URLSearchParams();
  params.set("section", target.section);
  if (target.section === "repo" && target.repo) {
    params.set("repo", target.repo);
  }
  if (target.section === "organization" && target.inviteHandoff) {
    params.set("inviteHandoff", target.inviteHandoff);
  }
  return `/settings?${params.toString()}`;
}

export function buildCloudSettingsHref(): string {
  return buildSettingsHref({ section: "cloud" });
}

export function buildCloudRepoSettingsHref(
  gitOwner: string,
  gitRepoName: string,
): string {
  const params = new URLSearchParams();
  params.set("section", "cloudRepo");
  params.set("cloudRepoOwner", gitOwner);
  params.set("cloudRepoName", gitRepoName);
  return `/settings?${params.toString()}`;
}

export interface SettingsSelectionInput {
  rawSection: string | null;
  rawRepo?: string | null;
  rawCloudRepoOwner?: string | null;
  rawCloudRepoName?: string | null;
  rawInviteHandoff?: string | null;
  repositories: SettingsRepositoryEntry[];
}

export interface SettingsSelection {
  activeSection: SettingsSection;
  activeRepoSourceRoot: string | null;
  inviteHandoff: string | null;
}

export function resolveSettingsSelection({
  rawSection,
  rawRepo = null,
  rawCloudRepoOwner = null,
  rawCloudRepoName = null,
  rawInviteHandoff = null,
  repositories,
}: SettingsSelectionInput): SettingsSelection {
  const repositoryRoots = new Set(repositories.map((repository) => repository.sourceRoot));
  const cloudRepositoriesByKey = new Map<string, SettingsRepositoryEntry[]>();
  for (const repository of repositories) {
    if (!isCloudRepository(repository)) {
      continue;
    }
    const key = cloudRepositoryKey(repository.gitOwner, repository.gitRepoName);
    const entries = cloudRepositoriesByKey.get(key);
    if (entries) {
      entries.push(repository);
    } else {
      cloudRepositoriesByKey.set(key, [repository]);
    }
  }

  let section: SettingsSection = normalizeSettingsSection(rawSection);
  let repoSourceRoot: string | null = section === "repo" ? rawRepo : null;

  if (rawSection === "cloudRepo") {
    const cloudRepoKey = rawCloudRepoOwner && rawCloudRepoName
      ? cloudRepositoryKey(rawCloudRepoOwner, rawCloudRepoName)
      : null;
    const matches = cloudRepoKey ? (cloudRepositoriesByKey.get(cloudRepoKey) ?? []) : [];
    if (matches.length === 1) {
      section = "repo";
      repoSourceRoot = matches[0].sourceRoot;
    } else {
      section = "cloud";
      repoSourceRoot = null;
    }
  }

  if (section === "repo") {
    if (!repoSourceRoot || !repositoryRoots.has(repoSourceRoot)) {
      repoSourceRoot = null;
    }
  }

  return {
    activeSection: section,
    activeRepoSourceRoot: repoSourceRoot,
    inviteHandoff: section === "organization" ? rawInviteHandoff : null,
  };
}
