import { useMemo } from "react";
import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";

export function useMobileRepositoryPickerOptions({
  configuredKeys,
  query,
  repositories,
}: {
  configuredKeys: ReadonlySet<string>;
  query: string;
  repositories: readonly CloudGitRepositorySummary[];
}) {
  return useMemo(() => {
    const all = repositories.filter(
      (repo) => !configuredKeys.has(`${repo.gitOwner}/${repo.gitRepoName}`),
    );
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return all;
    }
    return all.filter((repo) => repo.fullName.toLowerCase().includes(normalizedQuery));
  }, [repositories, configuredKeys, query]);
}
