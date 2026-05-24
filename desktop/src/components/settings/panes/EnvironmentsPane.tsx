import { useMemo, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { CloudEnvironmentList } from "@proliferate/product-ui/environments/CloudEnvironmentList";
import {
  buildCloudEnvironmentListItems,
} from "@proliferate/product-model/environments/cloud-environments";
import {
  formatGitRepoId,
  parseGitRepoId,
} from "@proliferate/product-model/repos/repo-id";
import { ChevronRight } from "@/components/ui/icons";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import type { SettingsFocus } from "@/lib/domain/settings/navigation";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { LocalRepoSection } from "./repo/LocalRepoSection";
import { CloudRepoSection } from "./repo/CloudRepoSection";
import { AddCloudEnvironmentDialogController } from "./environments/AddCloudEnvironmentDialogController";
import { CloudOnlyEnvironmentDetail } from "./environments/CloudOnlyEnvironmentDetail";

interface EnvironmentsPaneProps {
  repositories: SettingsRepositoryEntry[];
  selectedRepository: SettingsRepositoryEntry | null;
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
  focus: SettingsFocus;
  onSelectRepository: (sourceRoot: string) => void;
  onSelectCloudEnvironment: (gitOwner: string, gitRepoName: string) => void;
  onBackToList: () => void;
}

export function EnvironmentsPane({
  repositories,
  selectedRepository,
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
  focus,
  onSelectRepository,
  onSelectCloudEnvironment,
  onBackToList,
}: EnvironmentsPaneProps) {
  const [addCloudEnvironmentOpen, setAddCloudEnvironmentOpen] = useState(false);
  const cloudRepoConfigs = useCloudRepoConfigs(cloudActive);
  const selectedCloudRepo = focus.cloudRepoOwner && focus.cloudRepoName
    ? {
      gitOwner: focus.cloudRepoOwner,
      gitRepoName: focus.cloudRepoName,
    }
    : null;
  const cloudConfigByRepoId = useMemo(() => {
    const byId = new Map<string, { configured: boolean }>();
    for (const config of cloudRepoConfigs.data?.configs ?? []) {
      byId.set(formatGitRepoId({
        gitOwner: config.gitOwner,
        gitRepoName: config.gitRepoName,
      }), config);
    }
    return byId;
  }, [cloudRepoConfigs.data?.configs]);
  const cloudEnvironmentItems = useMemo(() => buildCloudEnvironmentListItems({
    configs: cloudRepoConfigs.data?.configs ?? [],
    localCheckouts: repositories
      .filter((repository) => repository.gitOwner && repository.gitRepoName)
      .map((repository) => ({
        gitOwner: repository.gitOwner!,
        gitRepoName: repository.gitRepoName!,
        sourceRoot: repository.sourceRoot,
        name: repository.name,
        secondaryLabel: repository.secondaryLabel,
      })),
  }), [cloudRepoConfigs.data?.configs, repositories]);

  if (!selectedRepository && selectedCloudRepo && cloudActive) {
    return (
      <CloudOnlyEnvironmentDetail
        gitOwner={selectedCloudRepo.gitOwner}
        gitRepoName={selectedCloudRepo.gitRepoName}
        cloudActive={cloudActive}
        onBack={onBackToList}
        onSaved={() => { void cloudRepoConfigs.refetch(); }}
      />
    );
  }

  if (!selectedRepository) {
    const cloudUnavailableReason = cloudUnavailableDescription({
      cloudEnabled,
      cloudActive,
      cloudSignInChecking,
      cloudSignInAvailable,
    });

    return (
      <>
        <CloudEnvironmentList
          title="Environments"
          description="Configure local checkouts and personal Cloud environments."
          localCheckouts={repositories.map((repository) => {
            const repoId = repository.gitOwner && repository.gitRepoName
              ? formatGitRepoId({
                gitOwner: repository.gitOwner,
                gitRepoName: repository.gitRepoName,
              })
              : null;
            const cloudConfig = repoId ? cloudConfigByRepoId.get(repoId) : null;
            return {
              id: repository.sourceRoot,
              name: repository.name,
              description: repository.secondaryLabel ?? repository.sourceRoot,
              cloudStatusLabel: cloudConfig
                ? cloudConfig.configured
                  ? "Cloud enabled"
                  : "Cloud disabled"
                : null,
            };
          })}
          cloudEnvironments={cloudEnvironmentItems.map((environment) => ({
            id: environment.id,
            fullName: environment.fullName,
            description: environment.description,
            configured: environment.configured,
            localState: environment.localState,
          }))}
          loadingCloudEnvironments={cloudRepoConfigs.isLoading}
          cloudUnavailableReason={cloudUnavailableReason}
          onSelectLocalCheckout={onSelectRepository}
          onSelectCloudEnvironment={(repoId) => {
            const parsed = parseGitRepoId(repoId);
            if (parsed) {
              onSelectCloudEnvironment(parsed.gitOwner, parsed.gitRepoName);
            }
          }}
          onAddCloudEnvironment={cloudActive ? () => setAddCloudEnvironmentOpen(true) : undefined}
          onRetryCloudEnvironments={cloudRepoConfigs.isError ? () => { void cloudRepoConfigs.refetch(); } : undefined}
        />
        <AddCloudEnvironmentDialogController
          open={addCloudEnvironmentOpen}
          onClose={() => setAddCloudEnvironmentOpen(false)}
          onEnvironmentAdded={(repoId) => {
            const parsed = parseGitRepoId(repoId);
            if (parsed) {
              onSelectCloudEnvironment(parsed.gitOwner, parsed.gitRepoName);
              void cloudRepoConfigs.refetch();
            }
          }}
        />
      </>
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onBackToList}
          className="h-auto px-0 py-0 text-sm hover:bg-transparent"
        >
          Environments
          <ChevronRight className="size-4" />
          <span className="text-foreground">{selectedRepository.name}</span>
        </Button>
        <SettingsPageHeader
          title={selectedRepository.name}
          description={selectedRepository.secondaryLabel ?? selectedRepository.sourceRoot}
        />
      </div>

      <LocalRepoSection repository={selectedRepository} />
      <CloudRepoSection
        repository={selectedRepository}
        cloudEnabled={cloudEnabled}
        cloudActive={cloudActive}
        cloudSignInChecking={cloudSignInChecking}
        cloudSignInAvailable={cloudSignInAvailable}
      />
    </section>
  );
}

function cloudUnavailableDescription({
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
}: {
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
}): string | null {
  if (cloudActive) {
    return null;
  }
  if (!cloudEnabled) {
    return "Cloud environments are unavailable in this build or deployment.";
  }
  if (cloudSignInChecking) {
    return "Checking cloud sign-in before loading personal Cloud environments.";
  }
  return cloudSignInAvailable
    ? "Sign in to configure personal Cloud environments."
    : "GitHub sign-in is unavailable, so Cloud environments cannot load.";
}
