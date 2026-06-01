import { useState } from "react";

import {
  useCurrentTeam,
  useCurrentTeamCheckout,
  useTeamCheckoutActions,
} from "@proliferate/cloud-sdk-react";

export function useWebOrganizationSettings() {
  const currentTeam = useCurrentTeam();
  const checkout = useCurrentTeamCheckout();
  const checkoutActions = useTeamCheckoutActions();
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

  return {
    actionError,
    currentTeam: currentTeam.data ?? null,
    currentTeamLoading: currentTeam.isLoading,
    currentTeamError: currentTeam.isError,
    pendingCheckoutIntent,
    teamName,
    inviteEmails,
    creatingTeamCheckout: checkoutActions.creatingTeamCheckout,
    cancelingTeamCheckout: checkoutActions.cancelingTeamCheckout,
    setTeamName,
    setInviteEmails,
    createTeam,
    continueCheckout,
    cancelCheckout,
    retryCurrentTeam: () => void currentTeam.refetch(),
  };
}
