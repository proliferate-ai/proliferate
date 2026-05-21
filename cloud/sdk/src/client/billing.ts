import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  BillingPlanInfo,
  BillingUrlResponse,
  OverageSettingsResponse,
} from "../types/index.js";

export interface CloudOwnerSelection {
  ownerScope: "personal" | "organization";
  organizationId?: string | null;
}

function ownerQuery(owner?: CloudOwnerSelection) {
  return {
    ownerScope: owner?.ownerScope ?? "personal",
    organizationId: owner?.organizationId ?? undefined,
  };
}

function ownerBody(owner?: CloudOwnerSelection) {
  return {
    ownerScope: owner?.ownerScope ?? "personal",
    organizationId: owner?.organizationId ?? null,
  };
}

export async function getCloudBillingPlan(
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<BillingPlanInfo> {
  return (
    await client.GET("/v1/billing/cloud-plan", {
      params: { query: ownerQuery(owner) },
    })
  ).data!;
}

export async function createCloudCheckoutSession(
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<BillingUrlResponse> {
  return (
    await client.POST("/v1/billing/cloud-checkout", {
      body: ownerBody(owner),
    })
  ).data!;
}

export async function createBillingPortalSession(
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<BillingUrlResponse> {
  return (
    await client.POST("/v1/billing/customer-portal", {
      body: ownerBody(owner),
    })
  ).data!;
}

export async function createRefillCheckoutSession(
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<BillingUrlResponse> {
  return (
    await client.POST("/v1/billing/refill-checkout", {
      body: ownerBody(owner),
    })
  ).data!;
}

export async function updateOverageSettings(
  input: { enabled: boolean; capCentsPerSeat?: number | null },
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OverageSettingsResponse> {
  return (
    await client.POST("/v1/billing/overage-settings", {
      body: { ...input, ...ownerBody(owner) },
    })
  ).data!;
}
