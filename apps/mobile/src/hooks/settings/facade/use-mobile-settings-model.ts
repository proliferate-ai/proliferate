import { useMemo } from "react";
import {
  useAuthViewer,
  useCloudBilling,
  useRepositories,
  useOrganizations,
} from "@proliferate/cloud-sdk-react";

import type { MobileSettingsAccountSummary } from "../../../lib/domain/settings/mobile-settings-presentation";

export function useMobileSettingsModel(account: MobileSettingsAccountSummary) {
  const viewer = useAuthViewer();
  const organizations = useOrganizations();
  const billing = useCloudBilling({ ownerScope: "personal" });
  const repoConfigs = useRepositories();

  const displayName =
    viewer.data?.user.display_name?.trim()
    || viewer.data?.user.email?.split("@")[0]
    || account.name;
  const email = viewer.data?.user.email ?? account.handle;
  const githubConnected = Boolean(viewer.data?.githubConnected);
  const githubChecking = viewer.isLoading && !viewer.data;
  const githubStateLabel = githubChecking
    ? "Checking"
    : viewer.isError
      ? "Unknown"
      : githubConnected
        ? "Linked"
        : "Required";
  const githubNeedsAttention = !githubChecking && (viewer.isError || !githubConnected);
  const passwordEnabled = Boolean(viewer.data?.passwordCredential.enabled);
  const passwordStateLabel = viewer.isLoading && !viewer.data
    ? "Checking"
    : passwordEnabled
      ? "Enabled"
      : "Not set";
  const authStateLabel = viewer.isError
    ? "Unknown"
    : viewer.isLoading
      ? "Checking"
      : viewer.data?.onboardingState === "active"
        ? "Active"
        : "Setup";
  const configuredRepos = useMemo(
    () => (repoConfigs.data?.repositories ?? []).flatMap((repo) => {
      const cloudEnvironment = repo.environments.find((environment) =>
        environment.kind === "cloud"
      );
      if (!cloudEnvironment?.configured) {
        return [];
      }
      return [{
        gitOwner: repo.gitOwner,
        gitRepoName: repo.gitRepoName,
        configured: true,
      }];
    }),
    [repoConfigs.data?.repositories],
  );
  const organizationRows = organizations.data?.organizations ?? [];

  return {
    authStateLabel,
    billing,
    configuredRepos,
    displayName,
    email,
    githubConnected,
    githubNeedsAttention,
    githubStateLabel,
    organizations,
    organizationRows,
    passwordEnabled,
    passwordStateLabel,
    repoConfigs,
    viewer,
  };
}
