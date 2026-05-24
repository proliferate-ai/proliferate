// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AccountCreditsOverview,
  TeamBillingEnvelope,
} from "@proliferate/cloud-sdk";
import {
  buildAccountCreditsPanelView,
  buildTeamBillingPanelView,
} from "@proliferate/product-model/billing/model";
import { findForbiddenBillingTerms } from "@proliferate/product-model/billing/presentation";

import { AccountCreditsPanel } from "../src/billing/AccountCreditsPanel";
import { BillingSettingsPane } from "../src/billing/BillingSettingsPane";
import { TeamBillingPanel } from "../src/billing/TeamBillingPanel";

describe("billing panels", () => {
  afterEach(cleanup);

  it("renders Account credits and exposes account actions", () => {
    const ensure = vi.fn();
    const startTeam = vi.fn();
    render(
      <AccountCreditsPanel
        view={buildAccountCreditsPanelView(accountCredits())}
        ensureAction={{ label: "Check credits", onClick: ensure }}
        startTeamAction={{ label: "Start Team", onClick: startTeam }}
      />,
    );

    expect(screen.getByText("Account credits")).toBeTruthy();
    expect(screen.getByText("Cloud credits")).toBeTruthy();
    expect(screen.getByText("Managed LLM credits")).toBeTruthy();

    fireEvent.click(screen.getByText("Check credits"));
    fireEvent.click(screen.getByText("Start Team"));
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(startTeam).toHaveBeenCalledTimes(1);
  });

  it("renders Team owner billing controls and event history", () => {
    const portal = vi.fn();
    const toggle = vi.fn();
    render(
      <TeamBillingPanel
        view={buildTeamBillingPanelView(teamBilling(), [
          {
            id: "event-1",
            kind: "invoice_paid",
            severity: "success",
            occurredAt: "2026-05-24T12:00:00Z",
            recordedAt: "2026-05-24T12:00:01Z",
            summary: "Invoice paid",
          },
        ])}
        manageBillingAction={{ label: "Manage Team billing", onClick: portal }}
        toggleOverageAction={{ label: "Turn on overage", onClick: toggle }}
      />,
    );

    expect(screen.getByText("Acme billing")).toBeTruthy();
    expect(screen.getByText("Managed cloud overage")).toBeTruthy();
    expect(screen.getByText("Invoice paid")).toBeTruthy();

    fireEvent.click(screen.getByText("Manage Team billing"));
    fireEvent.click(screen.getByText("Turn on overage"));
    expect(portal).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("renders read-only Team billing for members", () => {
    render(
      <TeamBillingPanel
        view={buildTeamBillingPanelView(
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
        )}
        manageBillingAction={{ label: "Manage Team billing", onClick: vi.fn() }}
      />,
    );

    expect(screen.getByText("Read-only Team billing")).toBeTruthy();
    expect(screen.queryByText("Manage Team billing")).toBeNull();
    expect(screen.queryByText("Invoice paid")).toBeNull();
  });

  it("renders no-team and pending checkout states", () => {
    const startTeam = vi.fn();
    const continueCheckout = vi.fn();
    const { rerender } = render(
      <TeamBillingPanel
        view={buildTeamBillingPanelView({ team: null, canCreateTeam: true, pendingCheckout: null })}
        startTeamAction={{ label: "Start Team", onClick: startTeam }}
      />,
    );

    fireEvent.click(screen.getByText("Start Team"));
    expect(startTeam).toHaveBeenCalledTimes(1);

    rerender(
      <TeamBillingPanel
        view={buildTeamBillingPanelView({
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
        })}
        startTeamAction={{ label: "Start Team", onClick: startTeam }}
        continueCheckoutAction={{ label: "Continue checkout", onClick: continueCheckout }}
      />,
    );

    expect(screen.getByText("Team checkout pending")).toBeTruthy();
    expect(screen.queryByText("Start Team")).toBeNull();
    fireEvent.click(screen.getByText("Continue checkout"));
    expect(continueCheckout).toHaveBeenCalledTimes(1);
  });

  it("does not render forbidden billing terminology", () => {
    const { container } = render(
      <BillingSettingsPane
        currentPlanKey="free"
        planComparisonAction={{ label: "Start Team", onClick: vi.fn() }}
      >
        <AccountCreditsPanel view={buildAccountCreditsPanelView(accountCredits())} />
        <TeamBillingPanel view={buildTeamBillingPanelView(teamBilling())} />
      </BillingSettingsPane>,
    );

    expect(findForbiddenBillingTerms(container.textContent ?? "")).toEqual([]);
  });
});

function accountCredits(): AccountCreditsOverview {
  return {
    billingSubjectId: "subject-1",
    freeCloud: {
      includedHours: 10,
      usedHours: 1,
      remainingHours: 9,
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
        usedHours: 8,
        remainingHours: 52,
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
