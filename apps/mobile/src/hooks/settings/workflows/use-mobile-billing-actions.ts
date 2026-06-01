import { useState } from "react";
import { Linking } from "react-native";
import { useCloudBillingActions } from "@proliferate/cloud-sdk-react";

export function useMobileBillingActions() {
  const billingActions = useCloudBillingActions({ ownerScope: "personal" });
  const [billingError, setBillingError] = useState<string | null>(null);

  async function startBillingAction(action: "portal" | "checkout" | "refill"): Promise<void> {
    setBillingError(null);
    try {
      const response =
        action === "portal"
          ? await billingActions.createBillingPortal()
          : action === "refill"
            ? await billingActions.createRefillCheckout()
            : await billingActions.createCloudCheckout();
      await Linking.openURL(response.url);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Billing action could not start.");
    }
  }

  return {
    billingActions,
    billingError,
    startBillingAction,
  };
}
