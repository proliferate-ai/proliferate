import { useEffect, useRef } from "react";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  SETTINGS_DEFAULT_SECTION,
  TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION,
  type SettingsSection,
} from "@/config/settings";
import { SettingsContentBoundary } from "./SettingsContentBoundary";
import { renderSettingsSection } from "./render-settings-section";
import {
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { type SettingsFocus } from "@/lib/domain/settings/navigation";
import {
  resolveRepoScopeSelection,
  type RepoSettingsContext,
} from "@/lib/domain/settings/repo-scope-selection";
import {
  SETTINGS_SCOPE_LABELS,
  SETTINGS_SCOPE_ORDER,
  getFirstSectionForScope,
  getSettingsScopeForSection,
  isSettingsAdminOnlySection,
} from "@/lib/domain/settings/navigation-presentation";
import { RepoScopeHeaderControls } from "@/components/settings/screen/RepoScopeHeaderControls";
import { SettingsSidebar } from "@/components/settings/sidebar/SettingsSidebar";
import { SettingsScopeTabs } from "@proliferate/product-ui/settings/SettingsScopeTabs";
import { ArrowLeft } from "lucide-react";
import { SETTINGS_COPY } from "@/copy/settings/settings-copy";
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
  onSelectRepoContext: (context: RepoSettingsContext) => void;
  onSelectCloudEnvironment: (gitOwner: string, gitRepoName: string) => void;
}

export function SettingsScreen({
  activeSection,
  activeRepoSourceRoot,
  focus,
  repositories,
  onNavigateHome,
  onSelectSection,
  onSelectRepo,
  onSelectRepoContext,
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
  const repoSelection = resolveRepoScopeSelection({
    repositories,
    activeRepoSourceRoot,
    focus,
  });
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
          <div className="ml-auto flex items-center gap-2.5">
            {activeScope === "repo" ? (
              <RepoScopeHeaderControls
                repositories={repositories}
                activeRepoSourceRoot={activeRepoSourceRoot}
                focus={focus}
                onSelectRepo={onSelectRepo}
                onSelectRepoContext={onSelectRepoContext}
                onSelectCloudEnvironment={onSelectCloudEnvironment}
              />
            ) : null}
          </div>
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
            integrations: !cloudEnabled,
            "organization-integrations": !cloudEnabled,
            "agent-api-keys": !cloudEnabled,
            "organization-secrets": !cloudEnabled,
            "organization-sso": !cloudEnabled,
            "personal-secrets": !cloudEnabled,
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
                    repoSelection,
                    cloudEnabled,
                    cloudActive,
                    cloudSignInChecking,
                    cloudSignInAvailable,
                    focus,
                    onSelectSection,
                    onSelectRepo,
                    onSelectRepoContext,
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
