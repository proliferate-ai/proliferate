import type { ReactNode } from "react";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { type SettingsSection } from "@/config/settings";
import { SettingsContentBoundary } from "./SettingsContentBoundary";
import { AccountPane } from "@/components/settings/panes/AccountPane";
import { AgentAuthenticationPane } from "@/components/settings/panes/AgentAuthenticationPane";
import { AgentDefaultsPane } from "@/components/settings/panes/AgentDefaultsPane";
import { AppearancePane } from "@/components/settings/panes/AppearancePane";
import { GeneralPane } from "@/components/settings/panes/GeneralPane";
import { KeyboardShortcutsPane } from "@/components/settings/panes/KeyboardShortcutsPane";
import { OrganizationPane } from "@/components/settings/panes/OrganizationPane";
import { ReviewSettingsPane } from "@/components/settings/panes/ReviewSettingsPane";
import { SlackBotPane } from "@/components/settings/panes/SlackBotPane";
import { BillingPane } from "@/components/settings/panes/BillingPane";
import { CloudAuthUnavailablePane } from "@/components/settings/panes/CloudAuthUnavailablePane";
import { CloudSignInRequiredPane } from "@/components/settings/panes/CloudSignInRequiredPane";
import { CloudUnavailablePane } from "@/components/settings/panes/CloudUnavailablePane";
import { ComputePane } from "@/components/settings/panes/ComputePane";
import { EnvironmentsPane } from "@/components/settings/panes/EnvironmentsPane";
import { SharedEnvironmentsPane } from "@/components/settings/panes/SharedEnvironmentsPane";
import {
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { type SettingsFocus } from "@/lib/domain/settings/navigation";
import { SettingsSidebar } from "@/components/settings/sidebar/SettingsSidebar";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useUpdater } from "@/hooks/access/tauri/use-updater";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";

interface SettingsScreenProps {
  activeSection: SettingsSection;
  activeRepoSourceRoot: string | null;
  focus: SettingsFocus;
  repositories: SettingsRepositoryEntry[];
  onNavigateHome: () => void;
  onSelectSection: (section: SettingsSection) => void;
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
  adminAccess: { isAdmin: boolean; isLoading: boolean; role: string | null },
  activeOrganizationId: string | null,
  focus: SettingsFocus,
  onSelectSection: (section: SettingsSection) => void,
  onSelectRepo: (sourceRoot: string) => void,
): ReactNode {
  if (activeSection === "agent-defaults") {
    return <AgentDefaultsPane />;
  }
  if (activeSection === "general") {
    return <GeneralPane />;
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
  if (activeSection === "billing") {
    return <BillingPane />;
  }
  if (activeSection === "organization") {
    return <OrganizationPane />;
  }
  if (activeSection === "agent-authentication") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <AgentAuthenticationPane initialAgentKind={focus.kind ?? null} />;
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
  }
  if (activeSection === "shared-environments") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return (
        <SharedEnvironmentsPane
          isAdmin={adminAccess.isAdmin}
          isCheckingAdmin={adminAccess.isLoading}
          role={adminAccess.role}
          activeOrganizationId={activeOrganizationId}
          repositories={repositories}
          focus={focus}
          onOpenSettingsSection={onSelectSection}
        />
      );
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
  }
  if (activeSection === "slack-bot") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <SlackBotPane />;
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
  }
  if (activeSection === "compute") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <ComputePane initialTargetId={focus.target ?? null} />;
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
  }
  return (
    <EnvironmentsPane
      repositories={repositories}
      selectedRepository={repository}
      cloudEnabled={cloudEnabled}
      cloudActive={cloudActive}
      cloudSignInChecking={cloudSignInChecking}
      cloudSignInAvailable={cloudSignInAvailable}
      onSelectRepository={onSelectRepo}
      onBackToList={() => onSelectSection("environments")}
    />
  );
}

export function SettingsScreen({
  activeSection,
  activeRepoSourceRoot,
  focus,
  repositories,
  onNavigateHome,
  onSelectSection,
  onSelectRepo,
}: SettingsScreenProps) {
  const { cloudActive, cloudEnabled, cloudSignInAvailable, cloudSignInChecking } = useCloudAvailabilityState();
  const { activeOrganizationId } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
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
    <div className="flex h-screen bg-surface-under text-foreground" data-telemetry-block>
      <SettingsSidebar
        activeSection={activeSection}
        adminAccess={{
          isAdmin: admin.isAdmin,
          isLoading: admin.isLoading,
        }}
        onNavigateHome={onNavigateHome}
        onSelectSection={onSelectSection}
        disabledSections={{
          "agent-authentication": !cloudEnabled,
          "shared-environments": !cloudEnabled,
          compute: !cloudEnabled,
          "slack-bot": !cloudEnabled,
        }}
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

      <div className="relative flex-1 bg-background">
        <div className="absolute left-0 right-0 top-0 h-10" data-tauri-drag-region="true" />
        <AutoHideScrollArea className="h-full" viewportClassName="px-8 pt-12">
          <div className="flex justify-center pb-16">
            <div
              className={`w-full space-y-7 ${
                activeSection === "billing" ? "max-w-[72rem]" : "max-w-[46rem]"
              }`}
            >
              <SettingsContentBoundary section={activeSection}>
                {renderSettingsSection(
                  activeSection,
                  activeRepository,
                  repositories,
                  cloudEnabled,
                  cloudActive,
                  cloudSignInChecking,
                  cloudSignInAvailable,
                  {
                    isAdmin: admin.isAdmin,
                    isLoading: admin.isLoading,
                    role: admin.role,
                  },
                  activeOrganizationId,
                  focus,
                  onSelectSection,
                  onSelectRepo,
                )}
              </SettingsContentBoundary>
            </div>
          </div>
        </AutoHideScrollArea>
      </div>
    </div>
  );
}
