import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  billingGateView,
  toBillingGateReason,
  type BillingGateStateView,
} from "@proliferate/product-ui/patterns/BillingGateState";
import { useIsAdmin } from "#product/hooks/access/cloud/organizations/use-is-admin";
import {
  useCloudBilling,
  useCloudBillingActions,
} from "#product/hooks/cloud/facade/use-cloud-billing";
import { useSelectedCloudOwner } from "#product/hooks/organizations/derived/use-selected-cloud-owner";
import { buildBillingSettingsHref } from "#product/lib/domain/settings/navigation";
import type { CloudStartBlockReason } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";

export interface BillingGateActions {
  view: BillingGateStateView;
  actionError: string | null;
}

/**
 * Repair actions for a billing-blocked workspace (billing.md T2): maps the
 * typed start-block reason through `billingGateView` with the viewer's real
 * upgrade/refill mutations. Returns null while the reason is not a billing
 * repair (concurrency, unknown) or billing state has not loaded — callers
 * fall back to their descriptive copy so we never show a wrong CTA.
 */
export function useBillingGateView(
  reason: CloudStartBlockReason | null | undefined,
): BillingGateActions | null {
  const navigate = useNavigate();
  const owner = useSelectedCloudOwner();
  const billingReason = reason && reason !== "concurrency_limit" ? reason : null;
  const billing = useCloudBilling(owner, { enabled: billingReason !== null });
  const billingActions = useCloudBillingActions(owner);
  const admin = useIsAdmin(
    owner.ownerScope === "organization" ? owner.organizationId ?? null : null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  if (!billingReason || !billing.data) {
    return null;
  }

  const runBillingAction = (action: () => Promise<unknown>) => {
    setActionError(null);
    action().catch((error: unknown) => {
      setActionError(
        error instanceof Error ? error.message : "Billing action could not start.",
      );
    });
  };
  const billingHref = buildBillingSettingsHref(owner);

  const view = billingGateView(toBillingGateReason(billingReason), {
    isPaidPlan: billing.data.isPaidCloud === true,
    canManageBilling: owner.ownerScope === "organization" ? admin.isAdmin : true,
    onUpgrade: () => runBillingAction(billingActions.createCloudCheckout),
    onRefill: () => runBillingAction(billingActions.createRefillCheckout),
    onOpenBilling: billingHref ? () => navigate(billingHref) : undefined,
    actionLoading:
      billingActions.creatingCloudCheckout || billingActions.creatingRefillCheckout,
  });

  return { view, actionError };
}
