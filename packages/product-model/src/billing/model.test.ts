import { describe, expect, it } from "vitest";

import type {
  AccountCreditsOverview,
  TeamBillingEnvelope,
} from "@proliferate/cloud-sdk";

import {
  buildAccountCreditsPanelView,
  buildBillingEventViews,
  buildTeamBillingPanelView,
} from "./model";

describe("billing view models", () => {
  it("builds Account credits with compute and LLM readiness", () => {
    const view = buildAccountCreditsPanelView(accountCredits());

    expect(view).toMatchObject({
      title: "Account credits",
      status: { label: "Available", tone: "success" },
      managedLlm: {
        status: { label: "Ready", tone: "success" },
        budgetLabel: "$5",
      },
      primaryActionIntent: "ensure_account_credits",
    });
    expect(view?.metrics.map((metric) => metric.label)).toEqual([
      "Cloud credits",
      "LLM credits",
      "Launch readiness",
    ]);
  });

  it("surfaces blocked Account credit launch reasons", () => {
    const view = buildAccountCreditsPanelView(accountCredits({
      startBlocked: true,
      startBlockReason: "llm_credits_exhausted",
      blockedResource: "llm",
      freeLlm: {
        enabled: true,
        status: "exhausted",
        includedBudgetUsd: "5",
        periodKey: "registration",
        launchEnabled: false,
        readyAgentModels: [],
        lastErrorCode: "budget_exhausted",
        lastErrorMessage: null,
      },
    }));

    expect(view?.status).toEqual({ label: "Blocked", tone: "warning" });
    expect(view?.notices[0]).toMatchObject({
      title: "LLM credits exhausted",
      actionIntent: "start_team",
    });
  });

  it("builds an empty Team billing state with pending checkout", () => {
    const view = buildTeamBillingPanelView({
      team: null,
      canCreateTeam: true,
      pendingCheckout: {
        id: "intent-1",
        organizationId: "org-1",
        teamName: "Acme",
        status: "pending",
        activationStatus: "waiting",
        checkoutUrl: "https://checkout.example",
        expiresAt: "2026-06-01T00:00:00Z",
      },
    });

    expect(view).toMatchObject({
      hasTeam: false,
      canCreateTeam: false,
      status: { label: "Checkout pending", tone: "warning" },
      pendingCheckout: { teamName: "Acme" },
    });
  });

  it("builds Team billing actions and read-only member notices", () => {
    const ownerView = buildTeamBillingPanelView(teamBilling({ canManageBilling: true }));
    const memberView = buildTeamBillingPanelView(teamBilling({ canManageBilling: false }));

    expect(ownerView).toMatchObject({
      title: "Acme billing",
      hasTeam: true,
      canManageBilling: true,
      status: { label: "Active", tone: "success" },
      overage: { enabled: false },
      managedLlm: { status: { label: "Ready", tone: "success" } },
    });
    expect(memberView?.notices).toContainEqual(expect.objectContaining({
      title: "Read-only Team billing",
      actionIntent: "none",
    }));
  });

  it("normalizes billing events to stable display rows", () => {
    expect(buildBillingEventViews([
      {
        id: "event-1",
        kind: "invoice_paid",
        severity: "success",
        occurredAt: "2026-05-24T12:00:00Z",
        recordedAt: "2026-05-24T12:00:01Z",
        summary: "Invoice paid",
      },
    ])).toEqual([
      {
        id: "event-1",
        kind: "invoice_paid",
        status: { label: "Success", tone: "success" },
        occurredAtLabel: "2026-05-24",
        summary: "Invoice paid",
      },
    ]);
  });

  it("omits Team billing event history for read-only members", () => {
    const view = buildTeamBillingPanelView(
      teamBilling({ canManageBilling: false, role: "member" }),
      [
        {
          id: "event-1",
          kind: "invoice_paid",
          severity: "success",
          occurredAt: "2026-05-24T12:00:00Z",
          recordedAt: "2026-05-24T12:00:01Z",
          summary: "Invoice paid",
        },
      ],
    );

    expect(view?.events).toEqual([]);
  });
});

function accountCredits(
  overrides: Partial<AccountCreditsOverview> = {},
): AccountCreditsOverview {
  return {
    billingSubjectId: "subject-1",
    freeCloud: {
      includedHours: 10,
      usedHours: 1.25,
      remainingHours: 8.75,
      status: "available",
    },
    freeLlm: {
      enabled: true,
      status: "active",
      includedBudgetUsd: "5",
      periodKey: "registration",
      launchEnabled: true,
      readyAgentModels: [{ agentKind: "claude", modelId: "sonnet" }],
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    githubRequired: false,
    freeAllocationStatus: "available",
    startBlocked: false,
    startBlockReason: null,
    blockedResource: null,
    ...overrides,
  };
}

function teamBilling(
  teamOverrides: Partial<NonNullable<TeamBillingEnvelope["team"]>> = {},
): TeamBillingEnvelope {
  return {
    canCreateTeam: false,
    pendingCheckout: null,
    team: {
      organizationId: "org-1",
      name: "Acme",
      role: "owner",
      canManageBilling: true,
      plan: "team",
      subscriptionStatus: "active",
      paymentHealthy: true,
      seatQuantity: 3,
      activeMemberCount: 3,
      currentPeriodStart: "2026-05-01T00:00:00Z",
      currentPeriodEnd: "2026-06-01T00:00:00Z",
      hostedInvoiceUrl: "https://invoice.example",
      managedCloud: {
        includedHours: 60,
        usedHours: 8.5,
        remainingHours: 51.5,
        overageEnabled: false,
        overageCapCents: 9000,
        overageUsedCents: 0,
      },
      managedLlm: {
        includedBudgetUsd: "30",
        status: "ready",
        periodKey: "stripe:sub",
        litellmSyncStatus: "synced",
        lastErrorCode: null,
      },
      startBlocked: false,
      startBlockReason: null,
      blockedResource: null,
      ...teamOverrides,
    },
  };
}
