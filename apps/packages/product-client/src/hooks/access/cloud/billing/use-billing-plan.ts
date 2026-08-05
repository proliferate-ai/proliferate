import type { BillingReturnSurface, CloudOwnerSelection } from "@proliferate/cloud-sdk";
import {
  useCloudBilling,
  useCloudBillingActions,
} from "@proliferate/cloud-sdk-react";

interface BillingPlanAccessOptions {
  owner?: CloudOwnerSelection;
  enabled: boolean;
  returnSurface: BillingReturnSurface;
}

export function useBillingPlanAccess({
  owner,
  enabled,
  returnSurface,
}: BillingPlanAccessOptions) {
  const billingQuery = useCloudBilling(owner, enabled);
  const billingActions = useCloudBillingActions(owner, { returnSurface });

  return { billingQuery, billingActions };
}
