import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import {
  BillingSettingsSurface,
  type BillingCheckoutReturnState,
} from "@proliferate/product-surfaces/settings/BillingSettingsSurface";
import { useCurrentTeam } from "@proliferate/cloud-sdk-react";

import { routes } from "../../../config/routes";

export function BillingSettingsSection() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentTeam = useCurrentTeam();
  const [searchParams] = useSearchParams();
  const team = currentTeam.data ?? null;
  const teamRole = team?.membership?.role ?? null;
  const canManageTeam = Boolean(
    team?.membership?.status === "active" && (teamRole === "owner" || teamRole === "admin"),
  );

  return (
    <BillingSettingsSurface
      organization={team
        ? {
            id: team.id,
            name: team.name,
            canManageBilling: canManageTeam,
            loading: currentTeam.isLoading,
          }
        : null}
      organizationLoading={currentTeam.isLoading}
      checkoutReturnState={checkoutReturnStateFromParams(searchParams)}
      onOpenUrl={(url) => {
        window.location.assign(url);
      }}
      onOpenOrganizationSettings={() => {
        navigate(routes.settingsSection("organization"), {
          state: settingsNavigationState(location.state),
        });
      }}
    />
  );
}

function settingsNavigationState(state: unknown): unknown {
  if (
    state &&
    typeof state === "object" &&
    "backgroundLocation" in state
  ) {
    return state;
  }
  return undefined;
}

function checkoutReturnStateFromParams(
  searchParams: URLSearchParams,
): BillingCheckoutReturnState {
  const checkout = searchParams.get("checkout");
  return checkout === "success" || checkout === "cancel" ? checkout : null;
}
