import type { ReactNode } from "react";

import type { BillingPlanColumn } from "./billing-plan-ladder";
import type { BillingActionView } from "./billing-types";
import {
  BillingPlanManagementDialog,
  type BillingPlanManagementDialogProps,
} from "./BillingPlanManagementDialog";
import { CheckoutReturnNotice, PlanComparisonCard } from "./BillingPlanComparison";

export type {
  BillingActionView,
  BillingGrantAllocationView,
  BillingPlanView,
} from "./billing-types";

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
      <PlanComparisonCard
        action={planComparisonAction}
        enterpriseAction={enterprisePlanAction}
        currentPlanKey={currentPlanKey ?? null}
      />
      {planManagementDialog ? <BillingPlanManagementDialog {...planManagementDialog} /> : null}
      {children}
    </div>
  );
}
