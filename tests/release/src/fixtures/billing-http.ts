/**
 * Billing HTTP fixture for the tier-3 billing lifecycle scenarios that run
 * against a real deployment (T3-BILL-3, `--lane staging`).
 *
 * T3-BILL-1 / T3-BILL-2 read the billing ledger directly from the local
 * profile DB (`billing_probe.py`, via `RELEASE_E2E_LOCAL_DATABASE_URL`) because
 * the local server exposes those tables and the durable local user is
 * password-only. That seam is unusable against staging: the staging DB is
 * VPC-only, and staging's durable user (`proliferate-e2e-bot`) is a real
 * GitHub-OAuth account that passes `current_product_user`, so the honest way to
 * observe staging billing is the same billing HTTP surface a real client uses —
 * `GET /v1/billing/{overview,cloud-plan,usage/summary,llm-balance}` and the
 * checkout / overage-settings mutations. This module wraps those routes, owner
 * -scoped (personal or a specific org) via the `?ownerScope=…&organizationId=…`
 * query the server reads in `current_owner_context`.
 *
 * Path convention: `serverUrl` (RELEASE_E2E_SERVER_URL) already includes the
 * deployment's api prefix, so paths are written prefix-relative (`/v1/billing/…`).
 * Local has an empty api prefix (serverUrl `http://127.0.0.1:8086`); staging's
 * prefix is `/api` (serverUrl `https://staging-app.proliferate.com/api`), so the
 * same `/v1/billing/overview` resolves correctly on both — identical to how
 * `identity.ts` writes `/auth/…` and `/v1/organizations/…`.
 */

import { ApiClient } from "./http.js";

export type OwnerScope = "personal" | "organization";

export interface OwnerSelection {
  ownerScope: OwnerScope;
  /** Required when ownerScope is "organization". */
  organizationId?: string;
}

/** Subset of `BillingOverview` / `CloudPlanInfo` this runner asserts on. */
export interface BillingOverview {
  plan: string;
  billingMode: string;
  /** Whether the deployment has Pro (subscription) billing enabled (PRO_BILLING_ENABLED). */
  proBillingEnabled?: boolean;
  remainingHours: number;
  includedHours: number;
  usedHours: number;
  overQuota: boolean;
  isPaidCloud: boolean;
  paymentHealthy: boolean;
  overageEnabled: boolean;
  startBlocked: boolean;
  startBlockReason: string | null;
  activeSpendHold: boolean;
  holdReason: string | null;
}

export interface UsageSummary {
  computeUsedSecondsMtd: number;
  computeRemainingSeconds: number;
  llmUsedUsdMtd: number;
  llmRemainingUsd: number;
  computeLimit: number | null;
  llmLimit: number | null;
  canSelfServeTopUp: boolean;
}

export interface LlmBalance {
  grantedUsd: number;
  usedUsd: number;
  remainingUsd: number;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  membership?: { role: string; status: string };
}

export interface OverageSettingsResponse {
  overageEnabled: boolean;
  overageCapCentsPerSeat: number | null;
}

function ownerQuery(owner: OwnerSelection): string {
  if (owner.ownerScope === "personal") {
    return "?ownerScope=personal";
  }
  if (!owner.organizationId) {
    throw new Error("ownerQuery: organizationId is required for organization scope.");
  }
  return `?ownerScope=organization&organizationId=${encodeURIComponent(owner.organizationId)}`;
}

/** Small typed client over the billing HTTP surface for one authenticated session. */
export class BillingHttpClient {
  private readonly client: ApiClient;

  constructor(serverUrl: string, accessToken: string) {
    this.client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(accessToken);
  }

  /** Orgs the authenticated user belongs to (used to resolve the durable org). */
  async organizations(): Promise<OrganizationSummary[]> {
    const response = await this.client.get<{ organizations: OrganizationSummary[] }>("/v1/organizations");
    return response.organizations ?? [];
  }

  overview(owner: OwnerSelection): Promise<BillingOverview> {
    return this.client.get<BillingOverview>(`/v1/billing/overview${ownerQuery(owner)}`);
  }

  cloudPlan(owner: OwnerSelection): Promise<BillingOverview> {
    return this.client.get<BillingOverview>(`/v1/billing/cloud-plan${ownerQuery(owner)}`);
  }

  usageSummary(owner: OwnerSelection): Promise<UsageSummary> {
    return this.client.get<UsageSummary>(`/v1/billing/usage/summary${ownerQuery(owner)}`);
  }

  llmBalance(owner: OwnerSelection): Promise<LlmBalance> {
    return this.client.get<LlmBalance>(`/v1/billing/llm-balance${ownerQuery(owner)}`);
  }

  /** Sets the overage policy for the owner (reversible; scenarios restore it). */
  setOverage(
    owner: OwnerSelection,
    enabled: boolean,
    capCentsPerSeat?: number | null,
  ): Promise<OverageSettingsResponse> {
    return this.client.post<OverageSettingsResponse>("/v1/billing/overage-settings", {
      enabled,
      capCentsPerSeat: capCentsPerSeat ?? null,
      ownerScope: owner.ownerScope,
      organizationId: owner.ownerScope === "organization" ? owner.organizationId : null,
    });
  }

  /** Raw cloud-checkout create — returns the Stripe URL so the caller can detect test vs live mode. */
  cloudCheckout(owner: OwnerSelection): Promise<{ url: string }> {
    const body =
      owner.ownerScope === "organization"
        ? { ownerScope: "organization", organizationId: owner.organizationId }
        : {};
    return this.client.post<{ url: string }>("/v1/billing/cloud-checkout", body);
  }
}

/**
 * True when a Stripe URL was minted by a TEST-mode account. Covers both shapes
 * staging's billing routes return: a `cs_test_` Checkout Session (an
 * unsubscribed owner) and a `billing.stripe.com/p/session/test_…` customer
 * portal (an already-subscribed owner — `cloud-checkout` redirects there). The
 * test-mode swap is the whole point of this scenario, so recognise both.
 */
export function isStripeTestModeUrl(url: string): boolean {
  return url.includes("cs_test_") || url.includes("/test/") || url.includes("/session/test_");
}

/** True when a Stripe URL was minted by a LIVE-mode account (the pre-swap state finding #4 recorded). */
export function isStripeLiveModeUrl(url: string): boolean {
  return url.includes("cs_live_") || url.includes("/live/") || url.includes("/session/live_");
}

/** Resolves the durable org for the authenticated user: the env override, else the one owned org. */
export function resolveDurableOrgId(
  organizations: OrganizationSummary[],
  envOverride: string | undefined,
): string | undefined {
  const override = envOverride?.trim();
  if (override) {
    return override;
  }
  const owned = organizations.filter((org) => org.membership?.role === "owner");
  if (owned.length === 1) {
    return owned[0].id;
  }
  if (organizations.length === 1) {
    return organizations[0].id;
  }
  return undefined;
}
