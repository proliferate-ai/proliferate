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
  paymentHealthy?: boolean;
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
