import { useCallback } from "react";
import { useCloudBillingQuery } from "#product/hooks/access/cloud/use-cloud-billing";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useSelectedCloudOwner } from "#product/hooks/organizations/derived/use-selected-cloud-owner";
import {
  resolveCloudWorkspaceStartPreflight,
  type CloudWorkspaceStartPreflight,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-creation";
import { descriptionForStartBlockReason } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";

const BILLING_PREFLIGHT_UNAVAILABLE =
  "Billing state could not be read. Please retry before starting Cloud work.";

/**
 * Fresh owner-scoped billing gate for every managed-Cloud start.
 *
 * The check deliberately runs on the user action, before any optimistic
 * workspace or session state is created. The create endpoint still owns the
 * authoritative gate; this preflight prevents a known block from becoming a
 * dead client-only workspace while preserving the server's typed denial.
 */
export function useCloudWorkspaceStartPreflight() {
  const { billingEnabled } = useAppCapabilities();
  const selectedOwner = useSelectedCloudOwner();
  const billingQuery = useCloudBillingQuery(selectedOwner, { enabled: false });

  const preflightCloudWorkspaceStart = useCallback(
    async (): Promise<CloudWorkspaceStartPreflight> => {
      if (!billingEnabled) {
        return { status: "allowed" };
      }

      try {
        const result = await billingQuery.refetch({ throwOnError: true });
        if (!result.data) {
          return {
            status: "unavailable",
            message: BILLING_PREFLIGHT_UNAVAILABLE,
          };
        }
        return resolveCloudWorkspaceStartPreflight(
          result.data,
          descriptionForStartBlockReason,
        );
      } catch {
        return {
          status: "unavailable",
          message: BILLING_PREFLIGHT_UNAVAILABLE,
        };
      }
    },
    [billingEnabled, billingQuery.refetch],
  );

  return { preflightCloudWorkspaceStart };
}
