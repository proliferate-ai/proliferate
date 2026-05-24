import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  buildAccountCreditsPanelView,
  buildTeamBillingPanelView,
} from "@proliferate/product-model/billing/model";
import { AccountCreditsPanel } from "@proliferate/product-ui/billing/AccountCreditsPanel";
import { BillingSettingsPane } from "@proliferate/product-ui/billing/BillingSettingsPane";
import { TeamBillingPanel } from "@proliferate/product-ui/billing/TeamBillingPanel";
import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import {
  useAccountCredits,
  useAccountCreditsActions,
  useCurrentTeam,
  useTeamBilling,
  useTeamBillingActions,
  useTeamBillingEvents,
} from "@proliferate/cloud-sdk-react";

import { routes } from "../../../config/routes";

export function BillingSettingsSection() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const checkoutReturnState = checkoutReturnStateFromParams(searchParams);

  const accountCredits = useAccountCredits();
  const accountCreditActions = useAccountCreditsActions();
  const teamBilling = useTeamBilling();
  const teamEvents = useTeamBillingEvents(Boolean(teamBilling.data?.team?.canManageBilling));
  const teamBillingActions = useTeamBillingActions();
  const currentTeam = useCurrentTeam();

  const [accountActionError, setAccountActionError] = useState<string | null>(null);
  const [teamActionError, setTeamActionError] = useState<string | null>(null);

  const accountView = useMemo(
    () => buildAccountCreditsPanelView(accountCredits.data),
    [accountCredits.data],
  );
  const teamView = useMemo(
    () => buildTeamBillingPanelView(
      teamBilling.data,
      teamBilling.data?.team?.canManageBilling ? (teamEvents.data?.events ?? []) : [],
    ),
    [teamBilling.data, teamEvents.data?.events],
  );

  useEffect(() => {
    if (!checkoutReturnState) {
      return;
    }
    void teamBilling.refetch();
    void teamEvents.refetch();
    void currentTeam.refetch();
  }, [checkoutReturnState]);

  const canManageTeamBilling = Boolean(teamBilling.data?.team?.canManageBilling);
  const hostedInvoiceUrl = teamBilling.data?.team?.hostedInvoiceUrl ?? null;
  const pendingCheckoutUrl = teamBilling.data?.pendingCheckout?.checkoutUrl ?? null;
  const hasPendingCheckout = Boolean(teamBilling.data?.pendingCheckout);

  async function ensureAccountCredits() {
    setAccountActionError(null);
    try {
      await accountCreditActions.ensureAccountCredits();
      await accountCredits.refetch();
    } catch (error) {
      setAccountActionError(error instanceof Error ? error.message : "Account credits could not be checked.");
    }
  }

  async function openTeamBillingPortal() {
    if (!canManageTeamBilling) {
      setTeamActionError("Team billing is managed by owners and admins.");
      return;
    }
    setTeamActionError(null);
    try {
      const response = await teamBillingActions.createTeamBillingPortal();
      window.location.assign(response.url);
    } catch (error) {
      setTeamActionError(error instanceof Error ? error.message : "Team billing could not be opened.");
    }
  }

  async function toggleTeamOverage() {
    if (!canManageTeamBilling || !teamBilling.data?.team) {
      return;
    }
    setTeamActionError(null);
    try {
      await teamBillingActions.updateTeamOverageSettings({
        enabled: !teamBilling.data.team.managedCloud.overageEnabled,
      });
      await teamBilling.refetch();
    } catch (error) {
      setTeamActionError(error instanceof Error ? error.message : "Team overage could not be updated.");
    }
  }

  function startTeam() {
    navigate(routes.settingsSection("organization"));
  }

  function continueCheckout() {
    if (pendingCheckoutUrl) {
      window.location.assign(pendingCheckoutUrl);
    } else {
      navigate(routes.settingsSection("organization"));
    }
  }

  function connectGitHub() {
    navigate(routes.settingsSection("account"));
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Billing"
        description="Review Account credits and manage Team billing, seats, shared cloud runtime, overage, and plan changes."
      />
      <BillingSettingsPane
        checkoutReturnState={checkoutReturnState}
        currentPlanKey={teamBilling.data?.team ? "team" : "free"}
        planComparisonAction={
          teamBilling.data?.team
            ? canManageTeamBilling
              ? {
                  label: "Manage Team billing",
                  loading: teamBillingActions.creatingTeamBillingPortal,
                  onClick: () => {
                    void openTeamBillingPortal();
                  },
                }
              : undefined
            : hasPendingCheckout
              ? {
                  label: "Continue checkout",
                  onClick: continueCheckout,
                }
              : {
                  label: "Start Team",
                  onClick: startTeam,
                }
        }
      >
        <AccountCreditsPanel
          view={accountView}
          loading={accountCredits.isLoading}
          error={accountCredits.isError ? "Account credits could not be loaded." : null}
          actionError={accountActionError}
          retryAction={accountCredits.isError
            ? {
                label: "Retry",
                onClick: () => {
                  void accountCredits.refetch();
                },
              }
            : undefined}
          ensureAction={{
            label: accountView?.primaryActionLabel ?? "Check credits",
            loading: accountCreditActions.ensuringAccountCredits,
            onClick: () => {
              void ensureAccountCredits();
            },
          }}
          connectGitHubAction={{
            label: "Connect GitHub",
            onClick: connectGitHub,
          }}
          startTeamAction={!teamBilling.data?.team && teamBilling.data?.canCreateTeam
            ? {
                label: hasPendingCheckout ? "Continue checkout" : "Start Team",
                onClick: hasPendingCheckout ? continueCheckout : startTeam,
              }
            : undefined}
        />

        <TeamBillingPanel
          view={teamView}
          loading={teamBilling.isLoading}
          error={teamBilling.isError ? "Team billing could not be loaded." : null}
          actionError={teamActionError}
          retryAction={teamBilling.isError
            ? {
                label: "Retry",
                onClick: () => {
                  void teamBilling.refetch();
                },
              }
            : undefined}
          startTeamAction={teamView?.canCreateTeam
            ? {
                label: "Start Team",
                onClick: startTeam,
              }
            : undefined}
          continueCheckoutAction={pendingCheckoutUrl
            ? {
                label: "Continue checkout",
                onClick: continueCheckout,
              }
            : undefined}
          manageBillingAction={canManageTeamBilling
            ? {
                label: "Manage Team billing",
                loading: teamBillingActions.creatingTeamBillingPortal,
                onClick: () => {
                  void openTeamBillingPortal();
                },
              }
            : undefined}
          toggleOverageAction={canManageTeamBilling && teamBilling.data?.team
            ? {
                label: teamBilling.data.team.managedCloud.overageEnabled
                  ? "Turn off overage"
                  : "Turn on overage",
                loading: teamBillingActions.updatingTeamOverageSettings,
                onClick: () => {
                  void toggleTeamOverage();
                },
              }
            : undefined}
          invoiceAction={canManageTeamBilling && hostedInvoiceUrl
            ? {
                label: "View invoice",
                onClick: () => {
                  window.location.assign(hostedInvoiceUrl);
                },
              }
            : undefined}
        />

        {teamEvents.isError && canManageTeamBilling ? (
          <SettingsCard>
            <SettingsCardRow
              label="Billing events"
              description="Recent Team billing events could not be loaded."
            />
          </SettingsCard>
        ) : null}
      </BillingSettingsPane>
    </section>
  );
}

function checkoutReturnStateFromParams(
  searchParams: URLSearchParams,
): "success" | "cancel" | null {
  const checkout = searchParams.get("checkout");
  return checkout === "success" || checkout === "cancel" ? checkout : null;
}
