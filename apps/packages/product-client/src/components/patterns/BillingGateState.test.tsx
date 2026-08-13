// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { BillingBalanceNotice, BillingGateState } from "./BillingGateState";
import { billingGateView } from "#product/lib/domain/billing/billing-gate-presentation";

const noop = () => {};

const MANAGER = {
  isPaidPlan: false,
  canManageBilling: true,
  onUpgrade: noop,
  onRefill: noop,
  onOpenBilling: noop,
};

describe("BillingGateState", () => {
  it("renders title, description, and both actions", () => {
    render(
      <BillingGateState
        view={billingGateView("credits_exhausted", MANAGER)}
      />,
    );
    expect(screen.getByText("Out of free credits")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Billing settings" })).toBeTruthy();
  });

  it("renders no buttons when the view offers no actions", () => {
    const { container } = render(
      <BillingGateState
        view={billingGateView("credits_exhausted", {
          isPaidPlan: false,
          canManageBilling: false,
        })}
      />,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("BillingBalanceNotice", () => {
  it("renders the inline action", () => {
    render(
      <BillingBalanceNotice
        view={{
          kind: "refill",
          title: "Credits running low",
          description: "2 hours of compute remaining this period.",
          primaryAction: { label: "Add credits", onClick: noop },
        }}
      />,
    );
    expect(screen.getByText("Credits running low")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add credits" })).toBeTruthy();
  });
});
