import { useMemo } from "react";
import { useRepoConfigs } from "@proliferate/cloud-sdk-react";
import { useComputeTargetOptions } from "@/hooks/compute/derived/use-compute-target-options";
import { useSettingsRepositories } from "@/hooks/settings/derived/use-settings-repositories";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import {
  buildAutomationTargetState,
  type AutomationTargetSelection,
} from "@/lib/domain/automations/target/selection";
import type { AutomationTargetRepoConfigRecord } from "@/lib/domain/automations/target/records";

const EMPTY_REPO_CONFIGS: AutomationTargetRepoConfigRecord[] = [];
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
  const { data: repoConfigsData, isLoading: repoConfigsLoading } =
    useRepoConfigs(enabled && !isOrganization);
  const { repositories } = useSettingsRepositories();
  const { cloudWorkspaces, isLoading: repoProjectionLoading } =
    useStandardRepoProjection();
  const computeTargets = useComputeTargetOptions({
    enabled,
    ownerScope,
  });
  const repoConfigs = useMemo(
    () => (repoConfigsData?.repositories ?? []).map((repo) => ({
      gitOwner: repo.gitOwner,
      gitRepoName: repo.gitRepoName,
      configured: repo.environments.some((environment) => environment.kind === "cloud"),
    })),
    [repoConfigsData?.repositories],
  );
  const scopedCloudWorkspaces = isOrganization ? EMPTY_CLOUD_WORKSPACES : cloudWorkspaces;
  const effectiveRepoConfigs = isOrganization ? EMPTY_REPO_CONFIGS : repoConfigs;

  const targetState = useMemo(() => buildAutomationTargetState({
    repoConfigs: effectiveRepoConfigs,
    cloudWorkspaces: scopedCloudWorkspaces,
    sshTargets: computeTargets.sshTargetOptions,
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
    effectiveRepoConfigs,
    repositories,
    scopedCloudWorkspaces,
    computeTargets.sshTargetOptions,
    selectedTarget,
  ]);

  return {
    ...targetState,
    isLoading: (!isOrganization && repoConfigsLoading) || repoProjectionLoading || computeTargets.isLoading,
  };
}
