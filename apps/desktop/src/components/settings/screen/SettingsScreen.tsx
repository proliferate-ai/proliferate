import { useEffect, useRef, type ReactNode } from "react";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { SETTINGS_DEFAULT_SECTION, type SettingsSection } from "@/config/settings";
import { SettingsContentBoundary } from "./SettingsContentBoundary";
import { AccountPane } from "@/components/settings/panes/AccountPane";
import { AgentAuthenticationPane } from "@/components/settings/panes/AgentAuthenticationPane";
import { AgentDefaultsPane } from "@/components/settings/panes/AgentDefaultsPane";
import { ArchivedChatsPane } from "@/components/settings/panes/ArchivedChatsPane";
import { AppearancePane } from "@/components/settings/panes/AppearancePane";
import { GeneralPane } from "@/components/settings/panes/GeneralPane";
import { KeyboardShortcutsPane } from "@/components/settings/panes/KeyboardShortcutsPane";
import { OrganizationIntegrationsPane } from "@/components/settings/panes/OrganizationIntegrationsPane";
import { OrganizationPane } from "@/components/settings/panes/OrganizationPane";
import { SettingsScaffoldPane } from "@/components/settings/panes/SettingsScaffoldPane";
// SLACK BOT PARKED: pane implementation is preserved but not rendered while disabled.
// import { SlackBotPane } from "@/components/settings/panes/SlackBotPane";
import { BillingPane } from "@/components/settings/panes/BillingPane";
import { CloudAuthUnavailablePane } from "@/components/settings/panes/CloudAuthUnavailablePane";
import { CloudSignInRequiredPane } from "@/components/settings/panes/CloudSignInRequiredPane";
import { CloudUnavailablePane } from "@/components/settings/panes/CloudUnavailablePane";
import { ComputePane } from "@/components/settings/panes/ComputePane";
import { EnvironmentsPane } from "@/components/settings/panes/EnvironmentsPane";
import { WorktreesPane } from "@/components/settings/panes/WorktreesPane";
import {
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { type SettingsFocus } from "@/lib/domain/settings/navigation";
import { isSettingsAdminOnlySection } from "@/lib/domain/settings/navigation-presentation";
import { SettingsSidebar } from "@/components/settings/sidebar/SettingsSidebar";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useUpdater } from "@/hooks/access/tauri/use-updater";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { isSettingsScaffoldPageId } from "@/copy/settings/settings-scaffold-copy";

interface SettingsScreenProps {
  activeSection: SettingsSection;
  activeRepoSourceRoot: string | null;
  focus: SettingsFocus;
  repositories: SettingsRepositoryEntry[];
  onNavigateHome: () => void;
  onSelectSection: (section: SettingsSection) => void;
  onSelectRepo: (sourceRoot: string) => void;
  onSelectCloudEnvironment: (gitOwner: string, gitRepoName: string) => void;
}

function renderSettingsSection(
  activeSection: SettingsSection,
  repository: SettingsRepositoryEntry | null,
  repositories: SettingsRepositoryEntry[],
  cloudEnabled: boolean,
  cloudActive: boolean,
  cloudSignInChecking: boolean,
  cloudSignInAvailable: boolean,
  focus: SettingsFocus,
  onSelectSection: (section: SettingsSection) => void,
  onSelectRepo: (sourceRoot: string) => void,
  onSelectCloudEnvironment: (gitOwner: string, gitRepoName: string) => void,
): ReactNode {
  if (activeSection === "agent-defaults") {
    return <AgentDefaultsPane />;
  }
  if (activeSection === "general") {
    return <GeneralPane />;
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
  if (activeSection === "organization-integrations") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <OrganizationIntegrationsPane />;
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
  }
  if (isSettingsScaffoldPageId(activeSection)) {
    return <SettingsScaffoldPane pageId={activeSection} />;
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
  // SLACK BOT PARKED: render branch is intentionally disabled with the settings entry point.
  // if (activeSection === "slack-bot") {
  //   if (!cloudEnabled) {
  //     return <CloudUnavailablePane />;
  //   }
  //
  //   if (cloudActive) {
  //     return <SlackBotPane />;
  //   }
  //
  //   if (cloudSignInChecking) {
  //     return <CloudSignInRequiredPane />;
  //   }
  //
  //   return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
  // }
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
  if (activeSection === "worktrees") {
    return <WorktreesPane />;
  }
  if (activeSection === "archived-chats") {
    return <ArchivedChatsPane />;
  }
  return (
    <EnvironmentsPane
      repositories={repositories}
      selectedRepository={repository}
      cloudEnabled={cloudEnabled}
      cloudActive={cloudActive}
      cloudSignInChecking={cloudSignInChecking}
      cloudSignInAvailable={cloudSignInAvailable}
      focus={focus}
      onSelectRepository={onSelectRepo}
      onSelectCloudEnvironment={onSelectCloudEnvironment}
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
  onSelectCloudEnvironment,
}: SettingsScreenProps) {
  const { cloudActive, cloudEnabled, cloudSignInAvailable, cloudSignInChecking } = useCloudAvailabilityState();
  const { activeOrganizationId } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const {
    phase,
    checkNow,
    updatesSupported,
  } = useUpdater();
  const activeRepository = repositories.find(
    (repository) => repository.sourceRoot === activeRepoSourceRoot,
  ) ?? null;
  const activeSectionIsAdminOnly = isSettingsAdminOnlySection(activeSection);
  const shouldRedirectAdminSection =
    activeSectionIsAdminOnly && !admin.isLoading && admin.isAdmin !== true;
  const effectiveActiveSection =
    activeSectionIsAdminOnly && admin.isAdmin !== true
      ? SETTINGS_DEFAULT_SECTION
      : activeSection;
  const redirectedAdminSectionRef = useRef<SettingsSection | null>(null);

  useEffect(() => {
    if (!shouldRedirectAdminSection) {
      redirectedAdminSectionRef.current = null;
      return;
    }
    if (redirectedAdminSectionRef.current === activeSection) {
      return;
    }
    redirectedAdminSectionRef.current = activeSection;
    onSelectSection(SETTINGS_DEFAULT_SECTION);
  }, [activeSection, onSelectSection, shouldRedirectAdminSection]);

  return (
    <div className="flex h-screen bg-surface-under text-foreground" data-telemetry-block>
      <SettingsSidebar
        activeSection={effectiveActiveSection}
        adminAccess={{
          isAdmin: admin.isAdmin,
          isLoading: admin.isLoading,
        }}
        onNavigateHome={onNavigateHome}
        onSelectSection={onSelectSection}
        disabledSections={{
          "agent-authentication": !cloudEnabled,
          "organization-integrations": !cloudEnabled,
          compute: !cloudEnabled,
          // SLACK BOT PARKED: section is not registered while the flow is disabled.
          // "slack-bot": !cloudEnabled,
        }}
        onCheckForUpdates={() => { void checkNow(); }}
        updateActionState={{
          isChecking: phase === "checking",
          hasAvailableUpdate: phase === "available" || phase === "ready",
          phase,
          updatesSupported,
        }}
      />

      <div className="relative min-w-0 flex-1 bg-background">
        <div className="absolute left-0 right-0 top-0 h-10" data-tauri-drag-region="true" />
        <AutoHideScrollArea className="h-full" viewportClassName="px-10 pb-12 pt-14">
          <div className="flex justify-center pb-8">
            <div
              className={`w-full space-y-6 ${
                effectiveActiveSection === "billing" || effectiveActiveSection === "organization-integrations"
                  ? "max-w-[76rem]"
                  : "max-w-[50rem]"
              }`}
            >
              <SettingsContentBoundary section={effectiveActiveSection}>
                {renderSettingsSection(
                  effectiveActiveSection,
                  activeRepository,
                  repositories,
                  cloudEnabled,
                  cloudActive,
                  cloudSignInChecking,
                  cloudSignInAvailable,
                  focus,
                  onSelectSection,
                  onSelectRepo,
                  onSelectCloudEnvironment,
                )}
              </SettingsContentBoundary>
            </div>
          </div>
        </AutoHideScrollArea>
      </div>
    </div>
  );
}
