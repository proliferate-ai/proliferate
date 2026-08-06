import type { ReactNode } from "react";

import type { BillingPlanColumn } from "#product/lib/domain/billing/billing-plan-ladder";
import type { BillingActionView } from "#product/components/billing/BillingUiParts";
import {
  BillingPlanManagementDialog,
  type BillingPlanManagementDialogProps,
} from "#product/components/billing/BillingPlanManagementDialog";
import { CheckoutReturnNotice } from "#product/components/billing/BillingPlanComparison";

export interface BillingSettingsPaneProps {
  children: ReactNode;
  planComparisonAction?: BillingActionView;
  enterprisePlanAction?: BillingActionView;
  planManagementDialog?: BillingPlanManagementDialogProps;
  currentPlanKey?: BillingPlanColumn["key"] | null;
  checkoutReturnState?: "success" | "cancel" | null;
}

export function BillingSettingsPane({
  children,
  planComparisonAction,
  enterprisePlanAction,
  planManagementDialog,
  currentPlanKey,
  checkoutReturnState,
}: BillingSettingsPaneProps) {
  return (
    <div className="space-y-6">
      {checkoutReturnState ? <CheckoutReturnNotice state={checkoutReturnState} /> : null}
      {children}
      {planManagementDialog ? (
        <BillingPlanManagementDialog
          {...planManagementDialog}
          coreAction={planManagementDialog.coreAction ?? planComparisonAction}
          enterpriseAction={planManagementDialog.enterpriseAction ?? enterprisePlanAction}
          currentPlanKey={planManagementDialog.currentPlanKey ?? currentPlanKey ?? null}
        />
      ) : null}
    </div>
  );
}
