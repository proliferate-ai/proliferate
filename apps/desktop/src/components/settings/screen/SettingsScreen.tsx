import { useEffect, useRef, type ReactNode } from "react";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  SETTINGS_DEFAULT_SECTION,
  TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION,
  type SettingsSection,
} from "@/config/settings";
import { SettingsContentBoundary } from "./SettingsContentBoundary";
import { AccountPane } from "@/components/settings/panes/AccountPane";
import { AgentAuthenticationPane } from "@/components/settings/panes/AgentAuthenticationPane";
import { AgentDefaultsPane } from "@/components/settings/panes/AgentDefaultsPane";
import { AppearancePane } from "@/components/settings/panes/AppearancePane";
import { GeneralPane } from "@/components/settings/panes/GeneralPane";
import { OrganizationIntegrationsPane } from "@/components/settings/panes/OrganizationIntegrationsPane";
// BUDGETS PARKED: pane implementation is preserved but not rendered while disabled.
// import { OrganizationBudgetsPane } from "@/components/settings/panes/OrganizationBudgetsPane";
import { OrganizationMembersPane } from "@/components/settings/panes/OrganizationMembersPane";
import { OrganizationPane } from "@/components/settings/panes/OrganizationPane";
import { OrganizationSecretsPane } from "@/components/settings/panes/OrganizationSecretsPane";
import { OrganizationSsoPane } from "@/components/settings/panes/OrganizationSsoPane";
import { PersonalSecretsPane } from "@/components/settings/panes/PersonalSecretsPane";
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
import {
  SETTINGS_SCOPE_LABELS,
  SETTINGS_SCOPE_ORDER,
  getFirstSectionForScope,
  getSettingsScopeForSection,
  isSettingsAdminOnlySection,
} from "@/lib/domain/settings/navigation-presentation";
import { SettingsSidebar } from "@/components/settings/sidebar/SettingsSidebar";
import { SettingsScopeTabs } from "@proliferate/product-ui/settings/SettingsScopeTabs";
import { ArrowLeft } from "lucide-react";
import { SETTINGS_COPY } from "@/copy/settings/settings-copy";
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
  if (activeSection === "account") {
    return <AccountPane />;
  }
  if (activeSection === "personal-secrets") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <PersonalSecretsPane />;
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
  }
  if (activeSection === "billing") {
    return <BillingPane />;
  }
  if (activeSection === "organization") {
    return <OrganizationPane />;
  }
  if (activeSection === "organization-members") {
    return <OrganizationMembersPane />;
  }
  if (activeSection === "organization-secrets") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <OrganizationSecretsPane />;
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
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
  // BUDGETS PARKED: render branch is intentionally disabled with the settings entry point.
  // if (activeSection === "organization-limits") {
  //   return <OrganizationBudgetsPane />;
  // }
  if (activeSection === "organization-sso") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <OrganizationSsoPane />;
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
  const { activeOrganizationId, organizationsQuery } = useActiveOrganization();
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
  const adminAccessLoading = organizationsQuery.isLoading || admin.isLoading;
  const shouldRedirectAdminSection =
    activeSectionIsAdminOnly
    && !TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION
    && !adminAccessLoading
    && admin.isAdmin !== true;
  const effectiveActiveSection =
    activeSectionIsAdminOnly
    && !TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION
    && !adminAccessLoading
    && admin.isAdmin !== true
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

  const activeScope = getSettingsScopeForSection(effectiveActiveSection);
  const handleScopeChange = (scope: typeof activeScope) => {
    if (scope === activeScope) {
      return;
    }
    onSelectSection(getFirstSectionForScope(scope));
  };
  return (
    <div className="flex h-screen flex-col bg-background text-foreground" data-telemetry-block>
      <header className="shrink-0 border-b border-border">
        <div
          className="flex h-10 items-center gap-2 pl-[82px] pr-3"
          data-tauri-drag-region="true"
        >
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            onClick={onNavigateHome}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {SETTINGS_COPY.back}
          </Button>
        </div>
        <div className="flex h-[46px] items-center gap-4 px-4">
          <SettingsScopeTabs
            items={SETTINGS_SCOPE_ORDER.map((scope) => ({
              id: scope,
              label: SETTINGS_SCOPE_LABELS[scope],
            }))}
            value={activeScope}
            onChange={handleScopeChange}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SettingsSidebar
          activeScope={activeScope}
          activeSection={effectiveActiveSection}
          adminAccess={{
            isAdmin: admin.isAdmin,
            isLoading: admin.isLoading,
          }}
          onSelectSection={onSelectSection}
          disabledSections={{
            "agent-authentication": !cloudEnabled,
            "organization-integrations": !cloudEnabled,
            "organization-secrets": !cloudEnabled,
            "organization-sso": !cloudEnabled,
            compute: !cloudEnabled,
            "personal-secrets": !cloudEnabled,
            // SLACK BOT PARKED: section is not registered while the flow is disabled.
            // "slack-bot": !cloudEnabled,
          }}
          onCheckForUpdates={() => { void checkNow(); }}
          updateActionState={{
            phase,
            updatesSupported,
          }}
        />

        <div className="relative min-w-0 flex-1 bg-background">
          <AutoHideScrollArea className="h-full" viewportClassName="px-10 pb-12 pt-10">
            <div className="flex justify-center pb-8">
              {/* The single settings page-width contract: panes never set their
                  own max-w — they inherit this container's. */}
              <div className="w-full max-w-[50rem] space-y-6">
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
    </div>
  );
}
