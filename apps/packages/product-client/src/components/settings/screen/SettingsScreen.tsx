import { useEffect, useRef } from "react";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { Button } from "#product/primitives/Button";
import {
  SETTINGS_DEFAULT_SECTION,
  TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION,
  type SettingsSection,
} from "#product/config/settings";
import { SettingsContentBoundary } from "./SettingsContentBoundary";
import { renderSettingsSection } from "./render-settings-section";
import {
  type SettingsRepositoryEntry,
} from "#product/lib/domain/settings/repositories";
import { type SettingsFocus } from "#product/lib/domain/settings/navigation";
import {
  resolveRepoScopeSelection,
  type RepoSettingsContext,
} from "#product/lib/domain/settings/repo-scope-selection";
import {
  SETTINGS_SCOPE_LABELS,
  SETTINGS_SCOPE_ORDER,
  getFirstSectionForScope,
  getSettingsScopeForSection,
  isSettingsAdminOnlyScope,
  isSettingsAdminOnlySection,
  isSettingsHarnessSection,
} from "#product/lib/domain/settings/navigation-presentation";
import { RepoScopeHeaderControls } from "#product/components/settings/screen/RepoScopeHeaderControls";
import { AgentScopeHeaderControls } from "#product/components/settings/screen/AgentScopeHeaderControls";
import { SettingsSidebar } from "#product/components/settings/sidebar/SettingsSidebar";
import { SettingsScopeTabs } from "#product/primitives/patterns/settings/SettingsScopeTabs";
import { ArrowLeft } from "#product/primitives/icons/core";
import { SETTINGS_COPY } from "#product/copy/settings/settings-copy";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useMacWindowControlsInsetClass } from "#product/hooks/ui/layout/use-mac-window-controls";
import { useWorkspaceSidebarResize } from "#product/hooks/preferences/ui/use-workspace-sidebar-resize";
import { useUpdater } from "#product/hooks/access/tauri/use-updater";
import { useIsAdmin } from "#product/hooks/access/cloud/organizations/use-is-admin";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import {
  SETTINGS_NAV_FLOW_KEY,
  finishRendererFlow,
  markRendererFlowDataReady,
  markRendererFlowShellCommitted,
} from "#product/lib/infra/diagnostics/renderer-flow-timing";

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
  const { authStatus, cloudActive, controlPlaneReachable, cloudSignInAvailable, cloudSignInChecking } = useCloudAvailabilityState();
  const authenticated = authStatus === "authenticated";
  const { activeOrganizationId, organizationsQuery } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const {
    phase,
    checkNow,
    updatesSupported,
  } = useUpdater();
  // Host-capability gating (ADR Q3, FR-2/FR-3): the Cloud|Local scope toggles
  // and cloud repo context are culled from desktop. Only web keeps the cloud
  // settings surface reachable. Desktop always resolves to the Local context so
  // no repo-scope pane ever renders its cloud arm (RepoCloudGate and the GitHub
  // App authorization affordances stay dormant, web-only).
  const host = useProductHost();
  const cloudSettingsReachable = host.surface === "web";
  const resolvedRepoSelection = resolveRepoScopeSelection({
    repositories,
    activeRepoSourceRoot,
    focus,
  });
  const repoSelection = cloudSettingsReachable
    ? resolvedRepoSelection
    : { ...resolvedRepoSelection, context: "local" as const };
  const activeSectionIsAdminOnly = isSettingsAdminOnlySection(activeSection);
  const adminAccessLoading = organizationsQuery.isLoading || admin.isLoading;
  const isAdminConfirmed = admin.isAdmin === true;
  // Single gating source: until admin status resolves to true, treat the
  // user as non-admin so admin-only panes/tabs never flash during the
  // useIsAdmin loading window.
  const showAdminSettings = TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION || isAdminConfirmed;
  const shouldRedirectAdminSection =
    activeSectionIsAdminOnly
    && !TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION
    && !adminAccessLoading
    && !isAdminConfirmed;
  const effectiveActiveSection =
    activeSectionIsAdminOnly && !showAdminSettings
      ? SETTINGS_DEFAULT_SECTION
      : activeSection;
  const visibleScopeOrder = SETTINGS_SCOPE_ORDER.filter(
    (scope) => !isSettingsAdminOnlyScope(scope) || showAdminSettings,
  );
  const redirectedAdminSectionRef = useRef<SettingsSection | null>(null);

  // UX-latency R1 settings_nav flow: the screen mounting is the shell; the
  // settle happens once admin/org gating data resolves. Fires once per mount.
  const settingsFlowSettledRef = useRef(false);
  useEffect(() => {
    markRendererFlowShellCommitted({
      kind: "settings_nav",
      correlationKey: SETTINGS_NAV_FLOW_KEY,
    });
  }, []);
  // COVERAGE LIMIT (honest): when admin/org access is already resolved at mount
  // (adminAccessLoading === false on the first pass — the common warm case), the
  // shell/data/stable marks fire back-to-back in the same tick, so
  // shell_to_data_ms and data_to_stable_ms collapse to ~0. The non-trivial
  // signal only appears on a cold open where useIsAdmin is still loading.
  useEffect(() => {
    if (adminAccessLoading || settingsFlowSettledRef.current) {
      return;
    }
    settingsFlowSettledRef.current = true;
    markRendererFlowDataReady({
      kind: "settings_nav",
      correlationKey: SETTINGS_NAV_FLOW_KEY,
    });
    finishRendererFlow({ kind: "settings_nav", correlationKey: SETTINGS_NAV_FLOW_KEY });
  }, [adminAccessLoading]);

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

  // The settings sidebar shares the main sidebar's persisted width, so
  // resizing either surface keeps both in step.
  const {
    sidebarWidth,
    onSidebarSeparatorDown,
  } = useWorkspaceSidebarResize();

  // Only a host that actually paints macOS window buttons reserves room for
  // them; on Web the inset was dead space above the nav.
  const macWindowControlsInsetClass = useMacWindowControlsInsetClass();

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
        {/* h-[46px]: the shared native-chrome header height used tree-wide
            wherever a row shares the macOS drag region (see
            WorkspaceShellSidebar.tsx, MainSidebarPageShell.tsx,
            MacWindowControlsSafeArea.tsx) — not settings-local drift. */}
        <div
          className={`flex h-[46px] items-center gap-2 pr-3 ${
            macWindowControlsInsetClass || "pl-3"
          }`}
          data-tauri-drag-region="true"
        >
          <Button
            type="button"
            variant="ghost"
            size="unstyled"
            onClick={onNavigateHome}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-ui"
          >
            <ArrowLeft className="icon-paired" />
            {SETTINGS_COPY.back}
          </Button>
        </div>
        {/* h-[46px]: see the cause comment above. */}
        <div className="flex h-[46px] items-center gap-4 px-4">
          <SettingsScopeTabs
            items={visibleScopeOrder.map((scope) => ({
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
                showContextToggle={cloudSettingsReachable}
                onSelectRepo={onSelectRepo}
                onSelectRepoContext={onSelectRepoContext}
                onSelectCloudEnvironment={onSelectCloudEnvironment}
              />
            ) : activeScope === "agents"
              && cloudSettingsReachable
              && (isSettingsHarnessSection(effectiveActiveSection) || effectiveActiveSection === "agent-api-keys") ? (
              <AgentScopeHeaderControls />
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          id="settings-sidebar"
          className="flex shrink-0 flex-col overflow-hidden border-r border-border"
          style={{ width: sidebarWidth }}
        >
          <SettingsSidebar
            activeScope={activeScope}
            activeSection={effectiveActiveSection}
            adminAccess={{
              isAdmin: admin.isAdmin,
              isLoading: admin.isLoading,
            }}
            onSelectSection={onSelectSection}
            disabledSections={{
              integrations: !controlPlaneReachable,
              "organization-integrations": !controlPlaneReachable,
              "agent-api-keys": !controlPlaneReachable,
            }}
            onCheckForUpdates={() => { void checkNow(); }}
            updateActionState={{
              phase,
              updatesSupported,
            }}
          />
        </div>

        {/* hover:bg-primary/30 active:bg-primary/50: a resize-handle affordance,
            not a re-implementation of a component's owned state — no target in
            section 4 names a resize-handle shape, so this stays a first
            instance. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-controls="settings-sidebar"
          onMouseDown={onSidebarSeparatorDown}
          className="relative z-10 -ml-1 flex w-1 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-primary/30 active:bg-primary/50"
        />

        <div className="relative min-w-0 flex-1 bg-background">
          <AutoHideScrollArea className="h-full" viewportClassName="px-10 pb-12 pt-10">
            <div className="flex justify-center pb-8">
              {/* The page-width contract and section rhythm now live on
                  SettingsPageBody, inside every pane; this container only
                  centers it. */}
              <SettingsContentBoundary section={effectiveActiveSection}>
                {renderSettingsSection(
                  effectiveActiveSection,
                  repoSelection,
                  controlPlaneReachable,
                  cloudActive,
                  cloudSignInChecking,
                  cloudSignInAvailable,
                  authenticated,
                  focus,
                  onSelectSection,
                  onSelectRepo,
                  onSelectRepoContext,
                  onSelectCloudEnvironment,
                )}
              </SettingsContentBoundary>
            </div>
          </AutoHideScrollArea>
        </div>
      </div>
    </div>
  );
}
