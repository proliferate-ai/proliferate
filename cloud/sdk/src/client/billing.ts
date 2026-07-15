import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  BillingPlanInfo,
  BillingUrlResponse,
  BudgetLimitInput,
  BudgetLimitsResponse,
  CurrentTeamCheckoutResponse,
  LlmBalance,
  OrgUsageByUserResponse,
  OrgUserUsageTimeseriesResponse,
  OverageSettingsResponse,
  TeamCheckoutRequest,
  TeamCheckoutResponse,
  UsageSummary,
  UsageTimeseries,
} from "../types/index.js";

export interface CloudOwnerSelection {
  ownerScope: "personal" | "organization";
  organizationId?: string | null;
}

export type BillingReturnSurface = "desktop" | "web";

export interface BillingCheckoutReturnOptions {
  returnSurface?: BillingReturnSurface;
}

export type TeamCheckoutSessionRequest = TeamCheckoutRequest & BillingCheckoutReturnOptions;

function ownerQuery(owner?: CloudOwnerSelection) {
  return {
    ownerScope: owner?.ownerScope ?? "personal",
    organizationId: owner?.organizationId ?? undefined,
  };
}

function ownerBody(owner?: CloudOwnerSelection, options?: BillingCheckoutReturnOptions) {
  return {
    ownerScope: owner?.ownerScope ?? "personal",
    organizationId: owner?.organizationId ?? null,
    returnSurface: options?.returnSurface ?? "web",
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
  returnOptions?: BillingCheckoutReturnOptions,
): Promise<BillingUrlResponse> {
  return (
    await client.POST("/v1/billing/cloud-checkout", {
      body: ownerBody(owner, returnOptions),
    })
  ).data!;
}

export async function createTeamCheckoutSession(
  input: TeamCheckoutSessionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<TeamCheckoutResponse> {
  return (
    await (client as any).POST("/v1/billing/team-checkout", {
      body: input,
    })
  ).data!;
}

export async function getCurrentTeamCheckout(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CurrentTeamCheckoutResponse> {
  return (await (client as any).GET("/v1/billing/team-checkout/current")).data!;
}

export async function cancelTeamCheckout(
  intentId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CurrentTeamCheckoutResponse> {
  return (
    await (client as any).POST("/v1/billing/team-checkout/{intent_id}/cancel", {
      params: { path: { intent_id: intentId } },
    })
  ).data!;
}

export async function createBillingPortalSession(
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
  returnOptions?: BillingCheckoutReturnOptions,
): Promise<BillingUrlResponse> {
  return (
    await client.POST("/v1/billing/customer-portal", {
      body: ownerBody(owner, returnOptions),
    })
  ).data!;
}

export async function createRefillCheckoutSession(
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
  returnOptions?: BillingCheckoutReturnOptions,
): Promise<BillingUrlResponse> {
  return (
    await client.POST("/v1/billing/refill-checkout", {
      body: ownerBody(owner, returnOptions),
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

export type UsageTimeseriesGranularity = "day" | "week" | "month";
export type UsageTimeseriesKind = "compute" | "llm" | "all";

export interface UsageTimeseriesQuery {
  granularity?: UsageTimeseriesGranularity;
  days?: number;
  kind?: UsageTimeseriesKind;
}

export async function getUsageSummary(
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<UsageSummary> {
  return (
    await client.GET("/v1/billing/usage/summary", {
      params: { query: ownerQuery(owner) },
    })
  ).data!;
}

export async function getUsageTimeseries(
  query?: UsageTimeseriesQuery,
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<UsageTimeseries> {
  return (
    await client.GET("/v1/billing/usage/timeseries", {
      params: { query: { ...ownerQuery(owner), ...query } },
    })
  ).data!;
}

export async function getLlmBalance(
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LlmBalance> {
  return (
    await client.GET("/v1/billing/llm-balance", {
      params: { query: ownerQuery(owner) },
    })
  ).data!;
}

export async function getOrgUsageByUser(
  organizationId: string,
  days?: number,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrgUsageByUserResponse> {
  return (
    await client.GET("/v1/organizations/{organization_id}/usage/by-user", {
      params: {
        path: { organization_id: organizationId },
        query: { days },
      },
    })
  ).data!;
}

export async function getOrgUserUsageTimeseries(
  organizationId: string,
  userId: string,
  query?: UsageTimeseriesQuery,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrgUserUsageTimeseriesResponse> {
  return (
    await client.GET(
      "/v1/organizations/{organization_id}/usage/users/{user_id}/timeseries",
      {
        params: {
          path: { organization_id: organizationId, user_id: userId },
          query,
        },
      },
    )
  ).data!;
}

export async function getOrgLimits(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<BudgetLimitsResponse> {
  return (
    await client.GET("/v1/organizations/{organization_id}/limits", {
      params: { path: { organization_id: organizationId } },
    })
  ).data!;
}

export async function putOrgLimits(
  organizationId: string,
  limits: BudgetLimitInput[],
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<BudgetLimitsResponse> {
  return (
    await client.PUT("/v1/organizations/{organization_id}/limits", {
      params: { path: { organization_id: organizationId } },
      body: { limits },
    })
  ).data!;
}
