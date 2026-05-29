import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@proliferate/ui/icons";
import { CloudEnvironmentsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudEnvironmentsSettingsSurface";

import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import type { SettingsFocus } from "@/lib/domain/settings/navigation";
import { LocalRepoSection } from "./repo/LocalRepoSection";
import { CloudRepoSection } from "./repo/CloudRepoSection";

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
  const selectedCloudRepo = focus.cloudRepoOwner && focus.cloudRepoName
    ? {
      gitOwner: focus.cloudRepoOwner,
      gitRepoName: focus.cloudRepoName,
    }
    : null;

  if (!selectedRepository) {
    return (
      <CloudEnvironmentsSettingsSurface
        mode="hybrid"
        enabled={cloudActive}
        cloudUnavailableReason={cloudUnavailableDescription({
          cloudEnabled,
          cloudActive,
          cloudSignInChecking,
          cloudSignInAvailable,
        })}
        localCheckouts={repositories.map((repository) => ({
          id: repository.sourceRoot,
          name: repository.name,
          description: repository.secondaryLabel ?? repository.sourceRoot,
          gitOwner: repository.gitOwner,
          gitRepoName: repository.gitRepoName,
        }))}
        selectedCloudRepo={selectedCloudRepo}
        onSelectLocalCheckout={onSelectRepository}
        onSelectCloudEnvironment={(repo) => {
          onSelectCloudEnvironment(repo.gitOwner, repo.gitRepoName);
        }}
        onBackToList={onBackToList}
      />
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
