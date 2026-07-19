import { type ReactNode } from "react";
import { type SettingsSection } from "#product/config/settings";
import { AccountPane } from "#product/components/settings/panes/AccountPane";
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
import { OrganizationSsoPane } from "#product/components/settings/panes/OrganizationSsoPane";
import { PersonalSecretsPane } from "#product/components/settings/panes/PersonalSecretsPane";
import { UserIntegrationsPane } from "#product/components/settings/panes/UserIntegrationsPane";
import { OrganizationModelPolicyPane } from "#product/components/settings/panes/OrganizationModelPolicyPane";
import { SettingsScaffoldPane } from "#product/components/settings/panes/SettingsScaffoldPane";
import { BillingPane } from "#product/components/settings/panes/BillingPane";
import { RepoActionsPane } from "#product/components/settings/panes/repo/RepoActionsPane";
import { RepoConfigurePane } from "#product/components/settings/panes/repo/RepoConfigurePane";
import { RepoEnvironmentPane } from "#product/components/settings/panes/repo/RepoEnvironmentPane";
import { WorktreesPane } from "#product/components/settings/panes/WorktreesPane";
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
  cloudEnabled: boolean,
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
  const cloudGate: CloudGateFlags = {
    cloudEnabled,
    cloudActive,
    cloudSignInChecking,
    cloudSignInAvailable,
  };
  // Auth-plane gate: surfaces that only need a signed-in control plane (not
  // cloud compute/E2B). CloudGuard renders children when its `cloudActive` is
  // true, so feed it the authentication signal instead of the compute one.
  const authGate: CloudGateFlags = {
    cloudEnabled,
    cloudActive: authenticated,
    cloudSignInChecking,
    cloudSignInAvailable,
  };
  if (isSettingsHarnessSection(activeSection)) {
    return <HarnessPane harnessKind={getHarnessKindForSettingsSection(activeSection)} />;
  }
  if (activeSection === "agent-api-keys") {
    return renderCloudGatedPane(cloudGate, () => <ApiKeysPane />);
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
    return renderCloudGatedPane(cloudGate, () => <PersonalSecretsPane />);
  }
  if (activeSection === "integrations") {
    return renderCloudGatedPane(authGate, () => <UserIntegrationsPane focus={focus} />);
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
    return renderCloudGatedPane(cloudGate, () => <OrganizationSecretsPane />);
  }
  if (activeSection === "organization-integrations") {
    return renderCloudGatedPane(cloudGate, () => <OrganizationIntegrationsPane />);
  }
  if (activeSection === "organization-limits") {
    return <OrganizationBudgetsPane />;
  }
  if (activeSection === "organization-sso") {
    return renderCloudGatedPane(cloudGate, () => <OrganizationSsoPane />);
  }
  if (activeSection === "organization-model-policy") {
    return renderCloudGatedPane(cloudGate, () => <OrganizationModelPolicyPane />);
  }
  if (isSettingsScaffoldPageId(activeSection)) {
    return <SettingsScaffoldPane pageId={activeSection} />;
  }
  if (activeSection === "worktrees") {
    return <WorktreesPane />;
  }
  if (activeSection === "repo-actions") {
    return (
      <RepoActionsPane
        repository={repoSelection.repository}
        context={repoSelection.context}
        cloudEnabled={cloudEnabled}
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
        cloudEnabled={cloudEnabled}
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
      cloudEnabled={cloudEnabled}
      cloudActive={cloudActive}
      cloudSignInChecking={cloudSignInChecking}
      cloudSignInAvailable={cloudSignInAvailable}
      onSelectRepo={onSelectRepo}
      onSelectCloudEnvironment={onSelectCloudEnvironment}
    />
  );
}
