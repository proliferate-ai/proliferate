import { useMemo } from "react";
import {
  useCloudRepoConfigs,
  useOrganizationCloudRepoConfigs,
} from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useSettingsRepositories } from "@/hooks/settings/derived/use-settings-repositories";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import {
  buildAutomationTargetState,
  type AutomationTargetSelection,
} from "@/lib/domain/automations/target/selection";
import type { CloudRepoConfigSummary } from "@/lib/domain/cloud/repo-configs";

const EMPTY_REPO_CONFIGS: CloudRepoConfigSummary[] = [];
const EMPTY_CLOUD_WORKSPACES: ReturnType<typeof useStandardRepoProjection>["cloudWorkspaces"] = [];

type AutomationTargetOwnerScope = "personal" | "organization";

interface UseAutomationTargetSelectionInput {
  automation: {
    executionTarget?: AutomationTargetSelection["executionTarget"];
    targetMode?: "local" | "personal_cloud" | "shared_cloud";
    gitOwner: string;
    gitRepoName: string;
  } | null;
  selectedTarget: AutomationTargetSelection | null;
  ownerScope?: AutomationTargetOwnerScope;
  organizationId?: string | null;
  enabled?: boolean;
}

export function useAutomationTargetSelection({
  automation,
  selectedTarget,
  ownerScope = "personal",
  organizationId = null,
  enabled = true,
}: UseAutomationTargetSelectionInput) {
  const isOrganization = ownerScope === "organization";
  const { data: personalRepoConfigsData, isLoading: personalRepoConfigsLoading } =
    useCloudRepoConfigs(enabled && !isOrganization);
  const { data: organizationRepoConfigsData, isLoading: organizationRepoConfigsLoading } =
    useOrganizationCloudRepoConfigs(
      organizationId,
      enabled && isOrganization && organizationId !== null,
    );
  const { repositories } = useSettingsRepositories();
  const { cloudWorkspaces, isLoading: repoProjectionLoading } =
    useStandardRepoProjection();
  const repoConfigs = isOrganization
    ? organizationRepoConfigsData?.configs
    : personalRepoConfigsData?.configs;
  const scopedCloudWorkspaces = isOrganization ? EMPTY_CLOUD_WORKSPACES : cloudWorkspaces;
  const repoConfigsLoading = isOrganization
    ? organizationRepoConfigsLoading
    : personalRepoConfigsLoading;

  const targetState = useMemo(() => buildAutomationTargetState({
    repoConfigs: repoConfigs ?? EMPTY_REPO_CONFIGS,
    cloudWorkspaces: scopedCloudWorkspaces,
    repositories,
    selectedTarget,
    savedTarget: automation
      ? {
        executionTarget: automation.executionTarget
          ?? (automation.targetMode === "local" ? "local" : "cloud"),
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
    cloudAvailable: !isOrganization || organizationId !== null,
  }), [
    automation?.executionTarget,
    automation?.targetMode,
    automation?.gitOwner,
    automation?.gitRepoName,
    isOrganization,
    organizationId,
    repoConfigs,
    repositories,
    scopedCloudWorkspaces,
    selectedTarget,
  ]);

  return {
    ...targetState,
    isLoading: repoConfigsLoading || repoProjectionLoading,
  };
}
