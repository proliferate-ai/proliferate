import type { ReactNode } from "react";
import type { BillingPlanColumn } from "./billing-plan-ladder";

export interface BillingPlanView {
  plan?: string | null;
  billingMode: string;
  proBillingEnabled: boolean;
  isUnlimited: boolean;
  hasUnlimitedCloudHours: boolean;
  freeSandboxHours?: number | null;
  usedSandboxHours?: number | null;
  remainingSandboxHours?: number | null;
  cloudRepoLimit?: number | null;
  activeCloudRepoCount: number;
  concurrentSandboxLimit?: number | null;
  activeSandboxCount: number;
  isPaidCloud: boolean;
  overageEnabled: boolean;
  hostedInvoiceUrl?: string | null;
  startBlocked: boolean;
  startBlockReason?: string | null;
  activeSpendHold: boolean;
  billableSeatCount?: number | null;
  includedManagedCloudHours?: number | null;
  remainingManagedCloudHours?: number | null;
  managedCloudOverageEnabled: boolean;
  managedCloudOverageCapCents?: number | null;
  managedCloudOverageUsedCents?: number | null;
  overagePricePerHourCents?: number | null;
  repoEnvironmentLimit?: number | null;
  legacyCloudSubscription: boolean;
  grantAllocations?: BillingGrantAllocationView[] | null;
}

export interface BillingGrantAllocationView {
  grantType: string;
  totalSeconds: number;
  consumedSeconds: number;
  remainingSeconds: number;
  active: boolean;
}

export interface BillingActionView {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface BillingOwnerCardView {
  title: string;
  description?: ReactNode;
  iconKind?: "personal" | "organization";
  plan?: BillingPlanView | null;
  loading?: boolean;
  error?: ReactNode;
  actionError?: ReactNode;
  retryAction?: BillingActionView;
  manageAction?: BillingActionView;
  upgradeAction?: BillingActionView;
  refillAction?: BillingActionView;
  overageAction?: BillingActionView;
  invoiceAction?: BillingActionView;
}

export interface BillingSettingsPaneProps {
  children: ReactNode;
  planComparisonAction?: BillingActionView;
  currentPlanKey?: BillingPlanColumn["key"] | null;
  checkoutReturnState?: "success" | "cancel" | null;
}
