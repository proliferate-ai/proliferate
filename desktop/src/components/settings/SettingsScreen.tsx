import type { ReactNode } from "react";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import {
  type SettingsSection,
  type SettingsStaticSection,
} from "@/config/settings";
import { AgentsPane } from "./AgentsPane";
import { SettingsContentBoundary } from "./SettingsContentBoundary";
import { ConfigurationPane } from "./panes/ConfigurationPane";
import { ConnectorsPane } from "./panes/ConnectorsPane";
import { AccountPane } from "./panes/AccountPane";
import { CloudAuthUnavailablePane } from "./panes/CloudAuthUnavailablePane";
import { CloudPane } from "./panes/CloudPane";
import { CloudSignInRequiredPane } from "./panes/CloudSignInRequiredPane";
import { CloudUnavailablePane } from "./panes/CloudUnavailablePane";
import { RepositoryPane } from "./panes/RepositoryPane";
import {
  cloudRepositoryKey,
  isCloudRepository,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { SettingsSidebar } from "./SettingsSidebar";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useUpdater } from "@/hooks/updater/use-updater";
import { CloudRepoSettingsScreen } from "@/components/cloud/repo-settings/CloudRepoSettingsScreen";

interface SettingsScreenProps {
  activeSection: SettingsSection;
  activeRepoSourceRoot: string | null;
  activeCloudRepoOwner: string | null;
  activeCloudRepoName: string | null;
  repositories: SettingsRepositoryEntry[];
  onNavigateHome: () => void;
  onSelectSection: (section: SettingsStaticSection) => void;
  onSelectRepo: (sourceRoot: string) => void;
}

function renderSettingsSection(
  activeSection: SettingsSection,
  repository: SettingsRepositoryEntry | null,
  cloudRepository: SettingsRepositoryEntry | null,
  repositories: SettingsRepositoryEntry[],
  cloudEnabled: boolean,
  cloudActive: boolean,
  cloudSignInChecking: boolean,
  cloudSignInAvailable: boolean,
): ReactNode {
  if (activeSection === "configuration") {
    return <ConfigurationPane />;
  }
  if (activeSection === "account") {
    return <AccountPane />;
  }
  if (activeSection === "connectors") {
    return <ConnectorsPane />;
  }
  if (activeSection === "cloud") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <CloudPane repositories={repositories} />;
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
  }
  if (activeSection === "cloudRepo") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <CloudRepoSettingsScreen repository={cloudRepository} />;
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
  }
  if (activeSection === "agents") {
    return <AgentsPane />;
  }
  return <RepositoryPane repository={repository} />;
}

export function SettingsScreen({
  activeSection,
  activeRepoSourceRoot,
  activeCloudRepoOwner,
  activeCloudRepoName,
  repositories,
  onNavigateHome,
  onSelectSection,
  onSelectRepo,
}: SettingsScreenProps) {
  const { cloudActive, cloudEnabled, cloudSignInAvailable, cloudSignInChecking } = useCloudAvailabilityState();
  const {
    phase,
    availableVersion,
    checkNow,
    downloadProgress,
    downloadUpdate,
    updatesSupported,
    openRestartPrompt,
  } = useUpdater();
  const activeRepository = repositories.find(
    (repository) => repository.sourceRoot === activeRepoSourceRoot,
  ) ?? null;
  const activeCloudRepository = repositories.find(
    (repository) => isCloudRepository(repository)
      && activeCloudRepoOwner
      && activeCloudRepoName
      && cloudRepositoryKey(repository.gitOwner, repository.gitRepoName)
        === cloudRepositoryKey(activeCloudRepoOwner, activeCloudRepoName),
  ) ?? null;

  return (
    <div className="flex h-screen bg-background text-foreground" data-telemetry-block>
      <SettingsSidebar
        repositories={repositories}
        activeSection={activeSection}
        activeRepoSourceRoot={activeRepoSourceRoot}
        onNavigateHome={onNavigateHome}
        onSelectSection={onSelectSection}
        onSelectRepo={onSelectRepo}
        disabledSections={{ cloud: !cloudEnabled }}
        onCheckForUpdates={() => { void checkNow(); }}
        updateActionState={{
          availableVersion,
          downloadProgress,
          isChecking: phase === "checking",
          hasAvailableUpdate: phase === "available" || phase === "ready",
          phase,
          updatesSupported,
        }}
        onDownloadUpdate={() => { void downloadUpdate(); }}
        onOpenRestartPrompt={openRestartPrompt}
      />

      <div className="relative flex-1">
        <div className="absolute left-0 right-0 top-0 h-10" data-tauri-drag-region="true" />
        <AutoHideScrollArea className="h-full" viewportClassName="px-6 pt-10">
          <div className="flex justify-center pb-14">
            <div className="w-full max-w-2xl space-y-6">
              <SettingsContentBoundary section={activeSection}>
                {renderSettingsSection(
                  activeSection,
                  activeRepository,
                  activeCloudRepository,
                  repositories,
                  cloudEnabled,
                  cloudActive,
                  cloudSignInChecking,
                  cloudSignInAvailable,
                )}
              </SettingsContentBoundary>
            </div>
          </div>
        </AutoHideScrollArea>
      </div>
    </div>
  );
}
