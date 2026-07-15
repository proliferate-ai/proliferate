import type { BillingCheckoutReturnOptions } from "@proliferate/cloud-sdk/client/billing";

export function desktopBillingReturnOptions(): BillingCheckoutReturnOptions {
  return { returnSurface: "desktop" };
}
