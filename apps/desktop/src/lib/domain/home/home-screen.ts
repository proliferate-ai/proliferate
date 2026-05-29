import type { CloudRepoConfigSummary } from "@/lib/domain/cloud/repo-configs";
import { HOME_SCREEN_LABELS } from "@/copy/home/home-screen-copy";
import { cloudRepositoryKey } from "@/lib/domain/settings/repositories";

export type HomeActionId =
  | "add-repository"
  | "agent-defaults"
  | "agent-settings"
  | "repository-settings";

export type HomeOnboardingActionId =
  | "add-repository"
  | "agent-defaults"
  | "repository-settings";

export type HomeOnboardingIcon = "github" | "settings" | "sliders";

export interface HomeOnboardingCardModel {
  id: HomeOnboardingActionId;
  title: string;
  icon: HomeOnboardingIcon;
}

export interface HomeRepositoryIdentity {
  sourceRoot?: string | null;
  gitProvider: string | null;
  gitOwner: string | null;
  gitRepoName: string | null;
}

function isGitHubRepository(repository: HomeRepositoryIdentity): boolean {
  return repository.gitProvider?.trim().toLowerCase() === "github"
    && Boolean(repository.gitOwner?.trim())
    && Boolean(repository.gitRepoName?.trim());
}

function configuredCloudRepositoryKeys(
  configs: readonly CloudRepoConfigSummary[] | null | undefined,
): Set<string> {
  return new Set(
    (configs ?? [])
      .filter((config) => config.configured)
      .map((config) => cloudRepositoryKey(config.gitOwner, config.gitRepoName)),
  );
}

function homeRepositoryKey(repository: HomeRepositoryIdentity): string | null {
  const gitOwner = repository.gitOwner?.trim();
  const gitRepoName = repository.gitRepoName?.trim();
  return gitOwner && gitRepoName
    ? cloudRepositoryKey(gitOwner, gitRepoName)
    : null;
}

export function findHomeUnconfiguredGitHubRepository(args: {
  repositories: readonly HomeRepositoryIdentity[];
  cloudRepoConfigs: readonly CloudRepoConfigSummary[] | null | undefined;
}): HomeRepositoryIdentity | null {
  const configuredKeys = configuredCloudRepositoryKeys(args.cloudRepoConfigs);
  return args.repositories.find((repository) => {
    if (!isGitHubRepository(repository)) {
      return false;
    }
    const key = homeRepositoryKey(repository);
    return key ? !configuredKeys.has(key) : false;
  }) ?? null;
}

export function buildHomeOnboardingCards(args: {
  repositories: readonly HomeRepositoryIdentity[];
  repositoriesLoading: boolean;
  readyAgentCount: number;
  agentsLoading: boolean;
  defaultChatAgentKind: string;
  cloudRepoConfigs: readonly CloudRepoConfigSummary[] | null | undefined;
  cloudRepoConfigsLoading: boolean;
}): HomeOnboardingCardModel[] {
  const cards: HomeOnboardingCardModel[] = [];
  const hasGitHubRepository =
    !args.repositoriesLoading && args.repositories.some(isGitHubRepository);
  const needsDefaultHarnesses =
    !args.agentsLoading
    && (args.readyAgentCount === 0 || args.defaultChatAgentKind.trim().length === 0);
  const needsRepositoryConfiguration =
    hasGitHubRepository
    && !args.cloudRepoConfigsLoading
    && findHomeUnconfiguredGitHubRepository({
      repositories: args.repositories,
      cloudRepoConfigs: args.cloudRepoConfigs,
    }) !== null;

  if (!args.repositoriesLoading && !hasGitHubRepository) {
    cards.push({
      id: "add-repository",
      title: HOME_SCREEN_LABELS.addGitHubRepositoryTitle,
      icon: "github",
    });
  }

  if (needsDefaultHarnesses) {
    cards.push({
      id: "agent-defaults",
      title: HOME_SCREEN_LABELS.configureDefaultHarnessesTitle,
      icon: "sliders",
    });
  }

  if (needsRepositoryConfiguration) {
    cards.push({
      id: "repository-settings",
      title: HOME_SCREEN_LABELS.configureRepositoryTitle,
      icon: "settings",
    });
  }

  return cards;
}
