import { getProliferateClient } from "./client";
import type { BillingPlanInfo } from "./client";

export async function getCloudBillingPlan(): Promise<BillingPlanInfo> {
  return (await getProliferateClient().GET("/v1/billing/cloud-plan")).data!;
}
