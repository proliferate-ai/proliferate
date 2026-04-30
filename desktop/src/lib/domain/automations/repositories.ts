import type {
  CloudRepoConfigSummary,
  CloudWorkspaceSummary,
} from "@/lib/integrations/cloud/client";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

export interface AutomationRepositoryOption {
  gitOwner: string;
  gitRepoName: string;
  label: string;
}

function addRepositoryOption(
  options: AutomationRepositoryOption[],
  seen: Set<string>,
  gitOwner: string | null | undefined,
  gitRepoName: string | null | undefined,
): void {
  const owner = gitOwner?.trim();
  const name = gitRepoName?.trim();
  if (!owner || !name) return;

  const key = `${owner}/${name}`;
  if (seen.has(key)) return;

  seen.add(key);
  options.push({
    gitOwner: owner,
    gitRepoName: name,
    label: key,
  });
}

export function buildAutomationRepositoryOptions(args: {
  repoConfigs: readonly CloudRepoConfigSummary[] | null | undefined;
  cloudWorkspaces?: readonly CloudWorkspaceSummary[] | null | undefined;
  repositories: readonly SettingsRepositoryEntry[] | null | undefined;
}): AutomationRepositoryOption[] {
  const options: AutomationRepositoryOption[] = [];
  const seen = new Set<string>();

  for (const repoConfig of args.repoConfigs ?? []) {
    addRepositoryOption(options, seen, repoConfig.gitOwner, repoConfig.gitRepoName);
  }

  for (const workspace of args.cloudWorkspaces ?? []) {
    if (workspace.repo.provider !== "github") continue;
    addRepositoryOption(options, seen, workspace.repo.owner, workspace.repo.name);
  }

  for (const repository of args.repositories ?? []) {
    addRepositoryOption(options, seen, repository.gitOwner, repository.gitRepoName);
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}
