import type { SettingsFocus } from "@/lib/domain/settings/navigation";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

/** Which side of the picked repo the Repo-scope pages edit. */
export type RepoSettingsContext = "cloud" | "local";

export function isRepoSettingsContext(
  value: string | null | undefined,
): value is RepoSettingsContext {
  return value === "cloud" || value === "local";
}

export interface RepoScopeSelection {
  repository: SettingsRepositoryEntry | null;
  context: RepoSettingsContext;
}

/**
 * Effective Repo-scope selection shared by the header controls and the repo
 * pages: the picked repo (defaulting to the first entry, like the bench
 * picker) plus the Cloud|Local context — explicit `context` focus wins, then
 * cloud deep links (`cloudRepoOwner`/`cloudRepoName`) and cloud-only repos
 * land on Cloud, everything else on Local.
 */
export function resolveRepoScopeSelection({
  repositories,
  activeRepoSourceRoot,
  focus,
}: {
  repositories: SettingsRepositoryEntry[];
  activeRepoSourceRoot: string | null;
  focus: SettingsFocus;
}): RepoScopeSelection {
  const repository = repositories.find((entry) => entry.sourceRoot === activeRepoSourceRoot)
    ?? repositories[0]
    ?? null;
  if (isRepoSettingsContext(focus.context)) {
    return { repository, context: focus.context };
  }
  const cloudFocused = Boolean(focus.cloudRepoOwner && focus.cloudRepoName);
  return {
    repository,
    context: cloudFocused || repository?.availability === "cloud" ? "cloud" : "local",
  };
}
