import { useMemo } from "react";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useSettingsRepositories } from "@/hooks/settings/use-settings-repositories";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
import {
  buildAutomationTargetState,
  type AutomationTargetSelection,
} from "@/lib/domain/automations/target-selection";
import type {
  AutomationResponse,
  CloudRepoConfigSummary,
} from "@/lib/access/cloud/client";

const EMPTY_REPO_CONFIGS: CloudRepoConfigSummary[] = [];

interface UseAutomationTargetSelectionInput {
  automation: AutomationResponse | null;
  selectedTarget: AutomationTargetSelection | null;
  enabled?: boolean;
}

export function useAutomationTargetSelection({
  automation,
  selectedTarget,
  enabled = true,
}: UseAutomationTargetSelectionInput) {
  const { data: repoConfigsData, isLoading: repoConfigsLoading } =
    useCloudRepoConfigs(enabled);
  const { repositories } = useSettingsRepositories();
  const { cloudWorkspaces, isLoading: repoProjectionLoading } =
    useStandardRepoProjection();

  const targetState = useMemo(() => buildAutomationTargetState({
    repoConfigs: repoConfigsData?.configs ?? EMPTY_REPO_CONFIGS,
    cloudWorkspaces,
    repositories,
    selectedTarget,
    savedTarget: automation
      ? {
        executionTarget: automation.executionTarget,
        gitOwner: automation.gitOwner,
        gitRepoName: automation.gitRepoName,
      }
      : null,
    editRepoIdentity: automation
      ? {
        gitOwner: automation.gitOwner,
        gitRepoName: automation.gitRepoName,
      }
      : null,
  }), [
    automation?.executionTarget,
    automation?.gitOwner,
    automation?.gitRepoName,
    cloudWorkspaces,
    repoConfigsData?.configs,
    repositories,
    selectedTarget,
  ]);

  return {
    ...targetState,
    isLoading: repoConfigsLoading || repoProjectionLoading,
  };
}
