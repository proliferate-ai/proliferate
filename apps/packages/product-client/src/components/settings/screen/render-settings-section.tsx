import { type ReactNode } from "react";
import { type SettingsSection } from "#product/config/settings";
import { AccountPane } from "#product/components/settings/panes/AccountPane";
import { ArchivedWorkspacesPane } from "#product/components/settings/panes/archived/ArchivedWorkspacesPane";
import { ApiKeysPane } from "#product/components/settings/panes/agents/api-keys/ApiKeysPane";
import { HarnessPane } from "#product/components/settings/panes/agents/harness/HarnessPane";
import { AppearancePane } from "#product/components/settings/panes/AppearancePane";
import { CloudGuard, type CloudGateFlags } from "#product/components/cloud/CloudGuard";
import { GeneralPane } from "#product/components/settings/panes/GeneralPane";
import { OrganizationBudgetsPane } from "#product/components/settings/panes/OrganizationBudgetsPane";
import { OrganizationIntegrationsPane } from "#product/components/settings/panes/OrganizationIntegrationsPane";
import { OrganizationMembersPane } from "#product/components/settings/panes/OrganizationMembersPane";
import { OrganizationPane } from "#product/components/settings/panes/OrganizationPane";
import { OrganizationSecretsPane } from "#product/components/settings/panes/OrganizationSecretsPane";
import { PersonalSecretsPane } from "#product/components/settings/panes/PersonalSecretsPane";
import { UserIntegrationsPane } from "#product/components/settings/panes/UserIntegrationsPane";
import { OrganizationModelPolicyPane } from "#product/components/settings/panes/OrganizationModelPolicyPane";
import { SettingsScaffoldPane } from "#product/components/settings/panes/SettingsScaffoldPane";
import { BillingPane } from "#product/components/settings/panes/BillingPane";
import { RepoActionsPane } from "#product/components/settings/panes/repo/RepoActionsPane";
import { RepoConfigurePane } from "#product/components/settings/panes/repo/RepoConfigurePane";
import { RepoEnvironmentPane } from "#product/components/settings/panes/repo/RepoEnvironmentPane";
import { type SettingsFocus } from "#product/lib/domain/settings/navigation";
import {
  type RepoScopeSelection,
  type RepoSettingsContext,
} from "#product/lib/domain/settings/repo-scope-selection";
import {
  getHarnessKindForSettingsSection,
  isSettingsHarnessSection,
} from "#product/lib/domain/settings/navigation-presentation";
import { isSettingsScaffoldPageId } from "#product/copy/settings/settings-scaffold-copy";

/** Cloud-gated sections: unavailable build → sign-in states → the pane itself. */
function renderCloudGatedPane(flags: CloudGateFlags, pane: () => ReactNode): ReactNode {
  return <CloudGuard flags={flags}>{pane()}</CloudGuard>;
}

export function renderSettingsSection(
  activeSection: SettingsSection,
  repoSelection: RepoScopeSelection,
  controlPlaneReachable: boolean,
  cloudActive: boolean,
  cloudSignInChecking: boolean,
  cloudSignInAvailable: boolean,
  authenticated: boolean,
  focus: SettingsFocus,
  _onSelectSection: (section: SettingsSection) => void,
  onSelectRepo: (sourceRoot: string) => void,
  onSelectRepoContext: (context: RepoSettingsContext) => void,
  onSelectCloudEnvironment: (gitOwner: string, gitRepoName: string) => void,
): ReactNode {
  // Control-plane gate: surfaces that only need a reachable, signed-in control
  // plane (not cloud compute/E2B). These are the ADR FM6/Q9 control-plane
  // features — API keys, personal/organization secrets, organization
  // integrations, and model policy — which must stay available whenever the
  // control plane is reachable and the user is authenticated, independent of
  // `cloudComputeEnabled`. CloudGuard renders children when its `cloudActive` is
  // true (and still shows CloudUnavailablePane when `controlPlaneReachable` is false), so
  // feed it the authentication signal instead of the compute one.
  const authGate: CloudGateFlags = {
    controlPlaneReachable,
    cloudActive: authenticated,
    cloudSignInChecking,
    cloudSignInAvailable,
  };
  if (isSettingsHarnessSection(activeSection)) {
    return <HarnessPane harnessKind={getHarnessKindForSettingsSection(activeSection)} />;
  }
  if (activeSection === "agent-api-keys") {
    return renderCloudGatedPane(authGate, () => <ApiKeysPane />);
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
    return renderCloudGatedPane(authGate, () => <PersonalSecretsPane />);
  }
  if (activeSection === "integrations") {
    return renderCloudGatedPane(authGate, () => <UserIntegrationsPane focus={focus} />);
  }
  if (activeSection === "archived-workspaces") {
    return <ArchivedWorkspacesPane />;
  }
  if (activeSection === "billing") {
    return <BillingPane focus={focus} />;
  }
  if (activeSection === "organization") {
    return <OrganizationPane />;
  }
  if (activeSection === "organization-members") {
    return <OrganizationMembersPane />;
  }
  if (activeSection === "organization-secrets") {
    return renderCloudGatedPane(authGate, () => <OrganizationSecretsPane />);
  }
  if (activeSection === "organization-integrations") {
    return renderCloudGatedPane(authGate, () => <OrganizationIntegrationsPane />);
  }
  if (activeSection === "organization-limits") {
    return <OrganizationBudgetsPane />;
  }
  if (activeSection === "organization-model-policy") {
    return renderCloudGatedPane(authGate, () => <OrganizationModelPolicyPane />);
  }
  if (isSettingsScaffoldPageId(activeSection)) {
    return <SettingsScaffoldPane pageId={activeSection} />;
  }
  if (activeSection === "repo-actions") {
    return (
      <RepoActionsPane
        repository={repoSelection.repository}
        context={repoSelection.context}
        controlPlaneReachable={controlPlaneReachable}
        cloudActive={cloudActive}
        cloudSignInChecking={cloudSignInChecking}
        cloudSignInAvailable={cloudSignInAvailable}
        onSelectRepo={onSelectRepo}
        onSelectCloudEnvironment={onSelectCloudEnvironment}
      />
    );
  }
  if (activeSection === "repo-environment") {
    return (
      <RepoEnvironmentPane
        repository={repoSelection.repository}
        context={repoSelection.context}
        controlPlaneReachable={controlPlaneReachable}
        cloudActive={cloudActive}
        cloudSignInChecking={cloudSignInChecking}
        cloudSignInAvailable={cloudSignInAvailable}
        onSelectRepo={onSelectRepo}
        onSelectCloudEnvironment={onSelectCloudEnvironment}
        onSelectRepoContext={onSelectRepoContext}
      />
    );
  }
  return (
    <RepoConfigurePane
      repository={repoSelection.repository}
      context={repoSelection.context}
      controlPlaneReachable={controlPlaneReachable}
      cloudActive={cloudActive}
      cloudSignInChecking={cloudSignInChecking}
      cloudSignInAvailable={cloudSignInAvailable}
      onSelectRepo={onSelectRepo}
      onSelectCloudEnvironment={onSelectCloudEnvironment}
    />
  );
}
