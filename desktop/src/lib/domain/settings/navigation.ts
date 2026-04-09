import { SETTINGS_CONTENT_SECTIONS, type SettingsSection } from "@/config/settings";

export function isSettingsSection(value: string | null): value is SettingsSection {
  return SETTINGS_CONTENT_SECTIONS.some((item) => item === value);
}

interface SettingsNavigationTarget {
  section: SettingsSection;
  repo?: string | null;
  cloudRepoOwner?: string | null;
  cloudRepoName?: string | null;
}

export function buildSettingsHref(target: SettingsNavigationTarget): string {
  const params = new URLSearchParams();
  params.set("section", target.section);
  if (target.section === "repo" && target.repo) {
    params.set("repo", target.repo);
  }
  if (target.section === "cloudRepo" && target.cloudRepoOwner && target.cloudRepoName) {
    params.set("cloudRepoOwner", target.cloudRepoOwner);
    params.set("cloudRepoName", target.cloudRepoName);
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
  return buildSettingsHref({
    section: "cloudRepo",
    cloudRepoOwner: gitOwner,
    cloudRepoName: gitRepoName,
  });
}
