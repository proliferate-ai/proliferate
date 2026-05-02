import { getProliferateClient } from "./client";
import type {
  BillingPlanInfo,
  BillingUrlResponse,
  OverageSettingsResponse,
} from "./client";

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
): Promise<BillingPlanInfo> {
  return (
    await getProliferateClient().GET("/v1/billing/cloud-plan", {
      params: { query: ownerQuery(owner) },
    })
  ).data!;
}

export async function createCloudCheckoutSession(
  owner?: CloudOwnerSelection,
): Promise<BillingUrlResponse> {
  return (
    await getProliferateClient().POST("/v1/billing/cloud-checkout", {
      body: ownerBody(owner),
    })
  ).data!;
}

export async function createBillingPortalSession(
  owner?: CloudOwnerSelection,
): Promise<BillingUrlResponse> {
  return (
    await getProliferateClient().POST("/v1/billing/customer-portal", {
      body: ownerBody(owner),
    })
  ).data!;
}

export async function createRefillCheckoutSession(
  owner?: CloudOwnerSelection,
): Promise<BillingUrlResponse> {
  return (
    await getProliferateClient().POST("/v1/billing/refill-checkout", {
      body: ownerBody(owner),
    })
  ).data!;
}

export async function updateOverageSettings(
  input: { enabled: boolean; capCentsPerSeat?: number | null },
  owner?: CloudOwnerSelection,
): Promise<OverageSettingsResponse> {
  return (
    await getProliferateClient().POST("/v1/billing/overage-settings", {
      body: { ...input, ...ownerBody(owner) },
    })
  ).data!;
}
