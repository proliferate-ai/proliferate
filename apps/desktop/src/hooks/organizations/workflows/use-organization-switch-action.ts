import { useCallback, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useOrganizationSelectionActions } from "@/hooks/organizations/workflows/use-organization-selection-actions";
import { useSessionDismissActions } from "@/hooks/sessions/workflows/use-session-dismiss-actions";
import { collectRunningLocalSessionIds } from "@/lib/domain/sessions/running-local-sessions";
import { teardownDesktopWorker } from "@/lib/workflows/cloud/ensure-desktop-worker";
import { getSessionRecords } from "@/stores/sessions/session-records";

// The semi-destructive org->org switch: close running LOCAL sessions (via the
// same per-session dismiss action the session UI uses — there is no bulk
// close workflow), tear down the desktop worker (revoke + stop + delete the
// gateway dotfile), then record the new active organization. The
// (user, org)-keyed enrollment guard observes the store change and re-enrolls
// the worker under the new organization.
export function useOrganizationSwitchAction() {
  const worker = useProductHost().desktop?.worker ?? null;
  const { dismissSession } = useSessionDismissActions();
  const { setActiveOrganizationId } = useOrganizationSelectionActions();
  const [switchingOrganization, setSwitchingOrganization] = useState(false);

  const switchOrganization = useCallback(async (organizationId: string) => {
    setSwitchingOrganization(true);
    try {
      const runningLocalSessionIds = collectRunningLocalSessionIds(getSessionRecords());
      for (const sessionId of runningLocalSessionIds) {
        // dismissSession swallows its own failures; a session that could not
        // be dismissed must not block rotating the worker identity.
        await dismissSession(sessionId);
      }
      if (worker !== null) {
        await teardownDesktopWorker(worker);
      }
      setActiveOrganizationId(organizationId);
    } finally {
      setSwitchingOrganization(false);
    }
  }, [dismissSession, setActiveOrganizationId, worker]);

  return { switchOrganization, switchingOrganization };
}
