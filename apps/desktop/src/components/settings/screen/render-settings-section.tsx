import { type ReactNode } from "react";
import { type SettingsSection } from "@/config/settings";
import { AccountPane } from "@/components/settings/panes/AccountPane";
import { AgentDefaultsPane } from "@/components/settings/panes/AgentDefaultsPane";
import { ApiKeysPane } from "@/components/settings/panes/agents/api-keys/ApiKeysPane";
import { HarnessPane } from "@/components/settings/panes/agents/harness/HarnessPane";
import { AppearancePane } from "@/components/settings/panes/AppearancePane";
import { GeneralPane } from "@/components/settings/panes/GeneralPane";
// BUDGETS PARKED: pane implementation is preserved but not rendered while disabled.
// import { OrganizationBudgetsPane } from "@/components/settings/panes/OrganizationBudgetsPane";
import { OrganizationIntegrationsPane } from "@/components/settings/panes/OrganizationIntegrationsPane";
import { OrganizationMembersPane } from "@/components/settings/panes/OrganizationMembersPane";
import { OrganizationPane } from "@/components/settings/panes/OrganizationPane";
import { OrganizationSecretsPane } from "@/components/settings/panes/OrganizationSecretsPane";
import { OrganizationSsoPane } from "@/components/settings/panes/OrganizationSsoPane";
import { PersonalSecretsPane } from "@/components/settings/panes/PersonalSecretsPane";
import { UserIntegrationsPane } from "@/components/settings/panes/UserIntegrationsPane";
import { OrganizationModelPolicyPane } from "@/components/settings/panes/OrganizationModelPolicyPane";
import { SettingsScaffoldPane } from "@/components/settings/panes/SettingsScaffoldPane";
import { BillingPane } from "@/components/settings/panes/BillingPane";
import { CloudAuthUnavailablePane } from "@/components/settings/panes/CloudAuthUnavailablePane";
import { CloudSignInRequiredPane } from "@/components/settings/panes/CloudSignInRequiredPane";
import { CloudUnavailablePane } from "@/components/settings/panes/CloudUnavailablePane";
import { RepoActionsPane } from "@/components/settings/panes/repo/RepoActionsPane";
import { RepoConfigurePane } from "@/components/settings/panes/repo/RepoConfigurePane";
import { RepoEnvironmentPane } from "@/components/settings/panes/repo/RepoEnvironmentPane";
import { WorktreesPane } from "@/components/settings/panes/WorktreesPane";
import { type SettingsFocus } from "@/lib/domain/settings/navigation";
import {
  type RepoScopeSelection,
  type RepoSettingsContext,
} from "@/lib/domain/settings/repo-scope-selection";
import {
  getHarnessKindForSettingsSection,
  isSettingsHarnessSection,
} from "@/lib/domain/settings/navigation-presentation";
import { isSettingsScaffoldPageId } from "@/copy/settings/settings-scaffold-copy";

interface CloudGateFlags {
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
}

/** Cloud-gated sections: unavailable build → sign-in states → the pane itself. */
function renderCloudGatedPane(flags: CloudGateFlags, pane: () => ReactNode): ReactNode {
  if (!flags.cloudEnabled) {
    return <CloudUnavailablePane />;
  }
  if (flags.cloudActive) {
    return pane();
  }
  if (flags.cloudSignInChecking || flags.cloudSignInAvailable) {
    return <CloudSignInRequiredPane />;
  }
  return <CloudAuthUnavailablePane />;
}

export function renderSettingsSection(
  activeSection: SettingsSection,
  repoSelection: RepoScopeSelection,
  cloudEnabled: boolean,
  cloudActive: boolean,
  cloudSignInChecking: boolean,
  cloudSignInAvailable: boolean,
  focus: SettingsFocus,
  onSelectSection: (section: SettingsSection) => void,
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
  if (isSettingsHarnessSection(activeSection)) {
    return <HarnessPane harnessKind={getHarnessKindForSettingsSection(activeSection)} />;
  }
  if (activeSection === "agent-defaults") {
    return <AgentDefaultsPane />;
  }
  if (activeSection === "agent-api-keys") {
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <ApiKeysPane />;
    }

    if (cloudSignInChecking) {
      return <CloudSignInRequiredPane />;
    }

    return cloudSignInAvailable ? <CloudSignInRequiredPane /> : <CloudAuthUnavailablePane />;
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
    if (!cloudEnabled) {
      return <CloudUnavailablePane />;
    }

    if (cloudActive) {
      return <UserIntegrationsPane focus={focus} />;
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
    return renderCloudGatedPane(cloudGate, () => <OrganizationSecretsPane />);
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
