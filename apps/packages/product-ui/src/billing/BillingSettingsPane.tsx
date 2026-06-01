import type { ReactNode } from "react";

import type { BillingPlanColumn } from "./billing-plan-ladder";
import type { BillingActionView } from "./billing-types";
import { CheckoutReturnNotice, PlanComparisonCard } from "./BillingPlanComparison";

export type {
  BillingActionView,
  BillingGrantAllocationView,
  BillingOwnerCardView,
  BillingPlanView,
} from "./billing-types";
export { BillingOwnerCard } from "./BillingOwnerCard";

export interface BillingSettingsPaneProps {
  children: ReactNode;
  planComparisonAction?: BillingActionView;
  currentPlanKey?: BillingPlanColumn["key"] | null;
  checkoutReturnState?: "success" | "cancel" | null;
}

export function BillingSettingsPane({
  children,
  planComparisonAction,
  currentPlanKey,
  checkoutReturnState,
}: BillingSettingsPaneProps) {
  return (
    <div className="space-y-6">
      {checkoutReturnState ? <CheckoutReturnNotice state={checkoutReturnState} /> : null}
      <PlanComparisonCard action={planComparisonAction} currentPlanKey={currentPlanKey ?? null} />
      {children}
    </div>
  );
}
