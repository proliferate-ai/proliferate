import { useState } from "react";

import {
  useCurrentTeam,
  useCurrentTeamCheckout,
  useGitHubAppInstallationStatus,
  useStartGitHubAppInstallation,
  useTeamCheckoutActions,
} from "@proliferate/cloud-sdk-react";

export function useWebOrganizationSettings() {
  const currentTeam = useCurrentTeam();
  const checkout = useCurrentTeamCheckout();
  const checkoutActions = useTeamCheckoutActions();
  const organizationId = currentTeam.data?.id ?? null;
  const githubAppInstallation = useGitHubAppInstallationStatus(
    organizationId,
    organizationId !== null,
  );
  const githubAppInstallationStart = useStartGitHubAppInstallation();
  const [teamName, setTeamName] = useState("");
  const [inviteEmails, setInviteEmails] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingCheckoutIntent = checkout.data?.intent ?? null;

  async function createTeam() {
    setActionError(null);
    try {
      const response = await checkoutActions.createTeamCheckout({
        teamName,
        inviteEmails: inviteEmails
          .split(",")
          .map((email) => email.trim())
          .filter(Boolean),
      });
      window.location.assign(response.url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Team checkout could not start.");
    }
  }

  function continueCheckout() {
    const url = pendingCheckoutIntent?.checkoutUrl;
    if (url) {
      window.location.assign(url);
    }
  }

  function cancelCheckout() {
    if (pendingCheckoutIntent) {
      void checkoutActions.cancelTeamCheckout(pendingCheckoutIntent.id);
    }
  }

  async function installGitHubApp() {
    if (!organizationId) {
      return;
    }
    setActionError(null);
    try {
      const response = await githubAppInstallationStart.mutateAsync({
        organizationId,
        options: {
          returnTo: `${window.location.origin}/settings/organization?source=github_app_installation_callback`,
        },
      });
      window.location.assign(response.installationUrl);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "GitHub App installation could not start.",
      );
    }
  }

  function manageGitHubApp() {
    window.open("https://github.com/settings/installations", "_blank", "noopener,noreferrer");
  }

  return {
    actionError,
    currentTeam: currentTeam.data ?? null,
    currentTeamLoading: currentTeam.isLoading,
    currentTeamError: currentTeam.isError,
    githubAppInstallation: githubAppInstallation.data,
    githubAppInstallationLoading: githubAppInstallation.isLoading,
    githubAppInstalling: githubAppInstallationStart.isPending,
    canManageGitHubAppInstallation: isOrganizationAdminRole(currentTeam.data?.membership?.role),
    pendingCheckoutIntent,
    teamName,
    inviteEmails,
    creatingTeamCheckout: checkoutActions.creatingTeamCheckout,
    cancelingTeamCheckout: checkoutActions.cancelingTeamCheckout,
    setTeamName,
    setInviteEmails,
    createTeam,
    installGitHubApp: () => void installGitHubApp(),
    manageGitHubApp,
    continueCheckout,
    cancelCheckout,
    retryCurrentTeam: () => void currentTeam.refetch(),
  };
}

function isOrganizationAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
