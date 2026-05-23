import type { Workspace } from "@anyharness/sdk";
import { HOME_SCREEN_LABELS } from "@/copy/home/home-screen-copy";
import {
  workspaceBranchLabel,
  workspaceRepoName,
} from "@/lib/domain/workspaces/display/workspace-display";

export type HomeActionId =
  | "resume-last-workspace"
  | "add-repository"
  | "agent-settings"
  | "repository-settings";

export type HomeActionIcon = "clock" | "folder" | "settings";

export interface HomeActionCardModel {
  id: HomeActionId;
  title: string;
  description: string;
  icon: HomeActionIcon;
  emphasis: "primary" | "secondary";
}

export interface HomeRepositoryIdentity {
  gitProvider: string | null;
  gitOwner: string | null;
  gitRepoName: string | null;
}

export interface HomeGitHubRepositoryOnboardingModel {
  title: string;
  description: string;
  actionLabel: string;
}

function hasGitHubRepository(repository: HomeRepositoryIdentity): boolean {
  return repository.gitProvider?.trim().toLowerCase() === "github"
    && Boolean(repository.gitOwner?.trim())
    && Boolean(repository.gitRepoName?.trim());
}

export function buildHomeActionCards(args: {
  latestWorkspace: Workspace | null;
  readyAgentCount: number;
  agentsLoading: boolean;
}): HomeActionCardModel[] {
  const { latestWorkspace, readyAgentCount, agentsLoading } = args;

  const leadingCard: HomeActionCardModel = latestWorkspace
    ? {
      id: "resume-last-workspace",
      title: HOME_SCREEN_LABELS.resumeWorkspaceTitle,
      description: `${HOME_SCREEN_LABELS.resumeWorkspaceDescriptionPrefix} ${workspaceRepoName(latestWorkspace)} / ${workspaceBranchLabel(latestWorkspace)}.`,
      icon: "clock",
      emphasis: "primary",
    }
    : {
      id: "add-repository",
      title: HOME_SCREEN_LABELS.addRepositoryTitle,
      description: HOME_SCREEN_LABELS.addRepositoryDescription,
      icon: "folder",
      emphasis: "primary",
    };

  const middleCard: HomeActionCardModel = {
    id: latestWorkspace ? "add-repository" : "repository-settings",
    title: latestWorkspace
      ? HOME_SCREEN_LABELS.addAnotherTitle
      : HOME_SCREEN_LABELS.repositorySettingsTitle,
    description: latestWorkspace
      ? HOME_SCREEN_LABELS.addAnotherDescription
      : HOME_SCREEN_LABELS.repositorySettingsDescription,
    icon: latestWorkspace ? "folder" : "settings",
    emphasis: "secondary",
  };

  const trailingCard: HomeActionCardModel = {
    id: "agent-settings",
    title: !agentsLoading && readyAgentCount === 0
      ? HOME_SCREEN_LABELS.agentSettingsTitle
      : HOME_SCREEN_LABELS.manageAgentsTitle,
    description: !agentsLoading && readyAgentCount === 0
      ? HOME_SCREEN_LABELS.agentSettingsDescription
      : HOME_SCREEN_LABELS.manageAgentsDescription,
    icon: "settings",
    emphasis: "secondary",
  };

  return [leadingCard, middleCard, trailingCard];
}

export function buildHomeGitHubRepositoryOnboarding(args: {
  repositories: HomeRepositoryIdentity[];
  repositoriesLoading: boolean;
}): HomeGitHubRepositoryOnboardingModel | null {
  if (args.repositoriesLoading || args.repositories.some(hasGitHubRepository)) {
    return null;
  }

  return {
    title: HOME_SCREEN_LABELS.addGitHubRepositoryTitle,
    description: HOME_SCREEN_LABELS.addGitHubRepositoryDescription,
    actionLabel: HOME_SCREEN_LABELS.addGitHubRepositoryAction,
  };
}
