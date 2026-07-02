import type { RepoConfigResponse } from "@proliferate/cloud-sdk";
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
  description: string;
  icon: HomeOnboardingIcon;
}

/**
 * Model-probe onboarding card state (UX spec §10). "probing" while the
 * harness reconcile/model discovery runs, "done" once launchable models are
 * known, "none" when no provider is connected, "hidden" when dismissed or
 * still loading.
 */
export type HomeModelProbeCardState =
  | { kind: "probing"; harnessKinds: string[] }
  | { kind: "done"; modelCount: number; harnessKinds: string[] }
  | { kind: "none" }
  | { kind: "hidden" };

export function resolveHomeModelProbeCardState(args: {
  dismissed: boolean;
  agentsLoading: boolean;
  isReconciling: boolean;
  harnessKinds: readonly string[];
  modelCount: number;
  /** When the "set up agents" card is already shown, the probe card's
   * "none" state would duplicate it — suppress it. */
  agentSetupCardVisible: boolean;
}): HomeModelProbeCardState {
  if (args.dismissed) {
    return { kind: "hidden" };
  }
  if (args.isReconciling) {
    return { kind: "probing", harnessKinds: [...args.harnessKinds] };
  }
  if (args.agentsLoading) {
    return { kind: "hidden" };
  }
  if (args.modelCount > 0) {
    return {
      kind: "done",
      modelCount: args.modelCount,
      harnessKinds: [...args.harnessKinds],
    };
  }
  if (args.agentSetupCardVisible) {
    return { kind: "hidden" };
  }
  return { kind: "none" };
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
  repoConfigs: readonly RepoConfigResponse[] | null | undefined,
): Set<string> {
  return new Set(
    (repoConfigs ?? [])
      .filter((repo) => repo.environments.some((environment) => environment.kind === "cloud"))
      .map((repo) => cloudRepositoryKey(repo.gitOwner, repo.gitRepoName)),
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
  repoConfigs: readonly RepoConfigResponse[] | null | undefined;
}): HomeRepositoryIdentity | null {
  const configuredKeys = configuredCloudRepositoryKeys(args.repoConfigs);
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
  repoConfigs: readonly RepoConfigResponse[] | null | undefined;
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
      repoConfigs: args.repoConfigs,
    }) !== null;

  if (!args.repositoriesLoading && !hasGitHubRepository) {
    cards.push({
      id: "add-repository",
      title: HOME_SCREEN_LABELS.addGitHubRepositoryTitle,
      description: HOME_SCREEN_LABELS.addGitHubRepositoryDescription,
      icon: "github",
    });
  }

  if (needsDefaultHarnesses) {
    cards.push({
      id: "agent-defaults",
      title: HOME_SCREEN_LABELS.configureDefaultHarnessesTitle,
      description: HOME_SCREEN_LABELS.configureDefaultHarnessesDescription,
      icon: "sliders",
    });
  }

  if (needsRepositoryConfiguration) {
    cards.push({
      id: "repository-settings",
      title: HOME_SCREEN_LABELS.configureRepositoryTitle,
      description: HOME_SCREEN_LABELS.configureRepositoryDescription,
      icon: "settings",
    });
  }

  return cards;
}
