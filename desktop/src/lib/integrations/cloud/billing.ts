import { getProliferateClient } from "./client";
import type {
  BillingPlanInfo,
  BillingUrlResponse,
  OverageSettingsResponse,
} from "./client";

export async function getCloudBillingPlan(): Promise<BillingPlanInfo> {
  return (await getProliferateClient().GET("/v1/billing/cloud-plan")).data!;
}

export async function createCloudCheckoutSession(): Promise<BillingUrlResponse> {
  return (await getProliferateClient().POST("/v1/billing/cloud-checkout")).data!;
}

export async function createBillingPortalSession(): Promise<BillingUrlResponse> {
  return (await getProliferateClient().POST("/v1/billing/customer-portal")).data!;
}

export async function createRefillCheckoutSession(): Promise<BillingUrlResponse> {
  return (await getProliferateClient().POST("/v1/billing/refill-checkout")).data!;
}

export async function updateOverageSettings(
  enabled: boolean,
): Promise<OverageSettingsResponse> {
  return (
    await getProliferateClient().POST("/v1/billing/overage-settings", {
      body: { enabled },
    })
  ).data!;
}
