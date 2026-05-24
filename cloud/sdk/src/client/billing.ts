import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  BillingPlanInfo,
  BillingUrlResponse,
  CurrentTeamCheckoutResponse,
  OverageSettingsResponse,
  TeamCheckoutRequest,
  TeamCheckoutIntentResponse,
  TeamCheckoutResponse,
} from "../types/index.js";

export type BillingBlockedResource =
  | "compute"
  | "llm"
  | "gateway"
  | "billing"
  | "seat"
  | (string & {})
  | null;

export type BillingBlockReason =
  | "compute_credits_exhausted"
  | "llm_credits_exhausted"
  | "overage_disabled"
  | "cap_exhausted"
  | "payment_failed"
  | "admin_hold"
  | "external_billing_hold"
  | "subscription_required_for_team"
  | "subject_not_allowed_for_cloud"
  | "concurrency_limit"
  | "agent_gateway_disabled"
  | "managed_credit_agent_not_configured"
  | "free_credits_github_allocation_unavailable"
  | (string & {});

export type AccountFreeCloudCreditsStatus =
  | "available"
  | "requires_github"
  | "already_allocated_elsewhere"
  | "disabled"
  | "exhausted"
  | (string & {});

export type AccountFreeLlmCreditsStatus =
  | "active"
  | "ready"
  | "disabled"
  | "exhausted"
  | "not_configured"
  | "sync_failed"
  | (string & {});

export interface AccountFreeCloudCredits {
  includedHours: number;
  usedHours: number;
  remainingHours: number;
  status: AccountFreeCloudCreditsStatus;
}

export interface AccountFreeLlmReadyAgentModel {
  agentKind: string;
  modelId: string;
}

export interface AccountFreeLlmCredits {
  enabled: boolean;
  status: AccountFreeLlmCreditsStatus;
  includedBudgetUsd: string;
  periodKey: string;
  launchEnabled: boolean;
  readyAgentModels: AccountFreeLlmReadyAgentModel[];
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export interface AccountCreditsOverview {
  billingSubjectId: string | null;
  freeCloud: AccountFreeCloudCredits;
  freeLlm: AccountFreeLlmCredits;
  githubRequired: boolean;
  freeAllocationStatus: AccountFreeCloudCreditsStatus;
  startBlocked: boolean;
  startBlockReason?: BillingBlockReason | null;
  blockedResource?: BillingBlockedResource;
}

export type AccountCreditsEnsureOutcome =
  | "created"
  | "existing_same_subject"
  | "missing_github_identity"
  | "github_identity_already_allocated"
  | "disabled_by_deployment"
  | "not_applicable"
  | (string & {});

export interface AccountCreditsEnsureResponse {
  accountCredits: AccountCreditsOverview;
  freeAllocationOutcome: AccountCreditsEnsureOutcome;
  freeAllocationBlockedReason?: BillingBlockReason | string | null;
}

export interface TeamManagedCloudBilling {
  includedHours: number | null;
  usedHours: number;
  remainingHours: number | null;
  overageEnabled: boolean;
  overageCapCents: number | null;
  overageUsedCents: number;
}

export type TeamManagedLlmBillingStatus =
  | "ready"
  | "active"
  | "disabled"
  | "exhausted"
  | "sync_failed"
  | "not_configured"
  | (string & {});

export interface TeamManagedLlmBilling {
  includedBudgetUsd: string | null;
  status: TeamManagedLlmBillingStatus;
  periodKey: string | null;
  litellmSyncStatus?: string | null;
  lastErrorCode?: string | null;
}

export interface TeamBillingOverview {
  organizationId: string;
  name: string;
  role: string;
  canManageBilling: boolean;
  plan: string;
  subscriptionStatus: string | null;
  paymentHealthy: boolean;
  seatQuantity: number | null;
  activeMemberCount: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  hostedInvoiceUrl?: string | null;
  managedCloud: TeamManagedCloudBilling;
  managedLlm: TeamManagedLlmBilling;
  startBlocked: boolean;
  startBlockReason?: BillingBlockReason | null;
  blockedResource?: BillingBlockedResource;
}

export interface TeamBillingEnvelope {
  team: TeamBillingOverview | null;
  canCreateTeam: boolean;
  pendingCheckout: TeamCheckoutIntentResponse | null;
}

export type BillingEventSeverity =
  | "info"
  | "warning"
  | "error"
  | "success"
  | (string & {});

export interface BillingEventSummary {
  id: string;
  kind: string;
  severity: BillingEventSeverity;
  occurredAt: string;
  recordedAt: string;
  summary: string;
  stripeObjectId?: string | null;
}

export interface TeamBillingEventsResponse {
  events: BillingEventSummary[];
}

export interface TeamOverageSettingsInput {
  enabled: boolean;
  capCentsPerSeat?: number | null;
}

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

export async function createTeamCheckoutSession(
  input: TeamCheckoutRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<TeamCheckoutResponse> {
  return client.requestJson<TeamCheckoutResponse>({
    method: "POST",
    path: "/v1/billing/team-checkout",
    body: input,
  });
}

export async function getCurrentTeamCheckout(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CurrentTeamCheckoutResponse> {
  return client.requestJson<CurrentTeamCheckoutResponse>({
    method: "GET",
    path: "/v1/billing/team-checkout/current",
  });
}

export async function cancelTeamCheckout(
  intentId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CurrentTeamCheckoutResponse> {
  return client.requestJson<CurrentTeamCheckoutResponse>({
    method: "POST",
    path: "/v1/billing/team-checkout/{intent_id}/cancel",
    pathParams: { intent_id: intentId },
  });
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

export async function getAccountCredits(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AccountCreditsOverview> {
  return client.requestJson<AccountCreditsOverview>({
    method: "GET",
    path: "/v1/billing/account-credits",
  });
}

export async function ensureAccountCredits(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AccountCreditsEnsureResponse> {
  return client.requestJson<AccountCreditsEnsureResponse>({
    method: "POST",
    path: "/v1/billing/account-credits/ensure",
  });
}

export async function getTeamBilling(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<TeamBillingEnvelope> {
  return client.requestJson<TeamBillingEnvelope>({
    method: "GET",
    path: "/v1/billing/team",
  });
}

export async function createTeamCheckout(
  input: TeamCheckoutRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<TeamCheckoutResponse> {
  return client.requestJson<TeamCheckoutResponse>({
    method: "POST",
    path: "/v1/billing/team/checkout",
    body: input,
  });
}

export async function createTeamBillingPortal(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<BillingUrlResponse> {
  return client.requestJson<BillingUrlResponse>({
    method: "POST",
    path: "/v1/billing/team/customer-portal",
  });
}

export async function updateTeamOverageSettings(
  input: TeamOverageSettingsInput,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OverageSettingsResponse> {
  return client.requestJson<OverageSettingsResponse>({
    method: "PATCH",
    path: "/v1/billing/team/overage",
    body: input,
  });
}

export async function getTeamBillingEvents(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<TeamBillingEventsResponse> {
  return client.requestJson<TeamBillingEventsResponse>({
    method: "GET",
    path: "/v1/billing/team/events",
  });
}
