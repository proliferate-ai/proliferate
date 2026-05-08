export interface CloudOwnerSelection {
  ownerScope: "personal" | "organization";
  organizationId?: string | null;
}

export interface BillingPlanInfo {
  activeCloudRepoCount: number;
  activeSpendHold: boolean;
  billingMode: string;
  cloudRepoLimit: number | null;
  hostedInvoiceUrl?: string | null;
  hasUnlimitedCloudHours: boolean;
  includedManagedCloudHours?: number | null;
  isPaidCloud: boolean;
  isUnlimited: boolean;
  legacyCloudSubscription: boolean;
  managedCloudOverageCapCents?: number | null;
  managedCloudOverageEnabled: boolean;
  managedCloudOverageUsedCents?: number | null;
  overageEnabled: boolean;
  overagePricePerHourCents?: number | null;
  proBillingEnabled: boolean;
  remainingManagedCloudHours?: number | null;
  remainingSandboxHours?: number | null;
  repoEnvironmentLimit?: number | null;
  startBlocked: boolean;
  startBlockReason?: string | null;
  usedSandboxHours?: number | null;
  billableSeatCount?: number | null;
}
