import { useCallback } from "react";
import { useOrganizationSelectionActions } from "@/hooks/organizations/workflows/use-organization-selection-actions";
import { useOrganizationSwitchAction } from "@/hooks/organizations/workflows/use-organization-switch-action";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

// Activates an organization the user just joined (e.g. by accepting an
// invitation). Joining while already active in another org is the same
// semi-destructive transition as the org switcher, so it runs the switch
// action (close running local sessions + tear down the worker) BEFORE the
// store change — the (user, org) enrollment guard then re-enrolls cleanly
// instead of rotating the worker underneath running sessions. A first
// organization (or re-activating the current one) is adopted in place.
export function useJoinedOrganizationActivation() {
  const activeOrganizationId = useOrganizationStore(
    (state) => state.activeOrganizationId,
  );
  const { setActiveOrganizationId } = useOrganizationSelectionActions();
  const { switchOrganization, switchingOrganization } = useOrganizationSwitchAction();

  const activateJoinedOrganization = useCallback(async (organizationId: string) => {
    if (activeOrganizationId && activeOrganizationId !== organizationId) {
      await switchOrganization(organizationId);
      return;
    }
    setActiveOrganizationId(organizationId);
  }, [activeOrganizationId, setActiveOrganizationId, switchOrganization]);

  return {
    activateJoinedOrganization,
    activatingJoinedOrganization: switchingOrganization,
  };
}
