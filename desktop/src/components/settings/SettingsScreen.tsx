import type { ReactNode } from "react";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import {
  type SettingsSection,
  type SettingsStaticSection,
} from "@/config/settings";
import { AgentsPane } from "./AgentsPane";
import { SettingsContentBoundary } from "./SettingsContentBoundary";
import { AccountPane } from "./panes/AccountPane";
import { AdvancedPane } from "./panes/AdvancedPane";
import { AppearancePane } from "./panes/AppearancePane";
import { DefaultsPane } from "./panes/DefaultsPane";
import { KeyboardShortcutsPane } from "./panes/KeyboardShortcutsPane";
import { ReviewSettingsPane } from "./panes/ReviewSettingsPane";
import { CloudAuthUnavailablePane } from "./panes/CloudAuthUnavailablePane";
import { CloudPane } from "./panes/CloudPane";
import { CloudSignInRequiredPane } from "./panes/CloudSignInRequiredPane";
import { CloudUnavailablePane } from "./panes/CloudUnavailablePane";
import { RepositoryPane } from "./panes/RepositoryPane";
import {
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { SettingsSidebar } from "./SettingsSidebar";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useUpdater } from "@/hooks/updater/use-updater";

interface SettingsScreenProps {
  activeSection: SettingsSection;
  activeRepoSourceRoot: string | null;
  repositories: SettingsRepositoryEntry[];
  onNavigateHome: () => void;
  onSelectSection: (section: SettingsStaticSection) => void;
  onSelectRepo: (sourceRoot: string) => void;
}

function renderSettingsSection(
  activeSection: SettingsSection,
  repository: SettingsRepositoryEntry | null,
  repositories: SettingsRepositoryEntry[],
  cloudEnabled: boolean,
  cloudActive: boolean,
  cloudSignInChecking: boolean,
  cloudSignInAvailable: boolean,
): ReactNode {
  if (activeSection === "agents") {
    return <AgentsPane />;
  }
  if (activeSection === "defaults") {
    return <DefaultsPane />;
  }
  if (activeSection === "review") {
    return <ReviewSettingsPane />;
  }
  if (activeSection === "appearance") {
    return <AppearancePane />;
  }
  if (activeSection === "keyboard") {
    return <KeyboardShortcutsPane />;
  }
  if (activeSection === "account") {
    return <AccountPane />;
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
  if (activeSection === "advanced") {
    return <AdvancedPane />;
  }
  return <RepositoryPane repository={repository} />;
}

export function SettingsScreen({
  activeSection,
  activeRepoSourceRoot,
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
