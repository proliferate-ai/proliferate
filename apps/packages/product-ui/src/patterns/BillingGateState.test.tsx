// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  BillingBalanceNotice,
  BillingGateState,
  billingGateView,
  type BillingGateReason,
} from "./BillingGateState";

const noop = () => {};

const MANAGER = {
  isPaidPlan: false,
  canManageBilling: true,
  onUpgrade: noop,
  onRefill: noop,
  onOpenBilling: noop,
};

describe("billingGateView", () => {
  it("routes a free subject's exhausted credits to upgrade", () => {
    const view = billingGateView("credits_exhausted", MANAGER);
    expect(view.kind).toBe("upgrade");
    expect(view.primaryAction?.label).toBe("Upgrade");
    expect(view.secondaryAction?.label).toBe("Billing settings");
  });

  it("routes a paid subject's exhausted credits to refill", () => {
    const view = billingGateView("credits_exhausted", { ...MANAGER, isPaidPlan: true });
    expect(view.kind).toBe("refill");
    expect(view.primaryAction?.label).toBe("Add credits");
  });

  it("gives non-admin members admin-managed copy and no action (U3: members cannot repair)", () => {
    const view = billingGateView("credits_exhausted", {
      ...MANAGER,
      canManageBilling: false,
    });
    expect(view.kind).toBe("admin");
    expect(view.primaryAction).toBeNull();
    expect(view.description).toContain("organization admin");
  });

  it("keeps limit_reached distinct from exhausted: limits point at settings, never refill (N3)", () => {
    const view = billingGateView("llm_limit_reached", { ...MANAGER, isPaidPlan: true });
    expect(view.kind).toBe("limit");
    expect(view.primaryAction?.label).toBe("Billing settings");
  });

  it("payment failure points at the portal path, not upgrade", () => {
    const view = billingGateView("payment_failed", { ...MANAGER, isPaidPlan: true });
    expect(view.kind).toBe("payment");
    expect(view.primaryAction?.label).toBe("Billing settings");
  });

  it("admin hold offers no self-service repair", () => {
    const view = billingGateView("admin_hold", MANAGER);
    expect(view.primaryAction).toBeNull();
    expect(view.secondaryAction?.label).toBe("Billing settings");
  });

  it("admin hold hides even the settings link from non-admin members", () => {
    const view = billingGateView("admin_hold", { ...MANAGER, canManageBilling: false });
    expect(view.primaryAction).toBeNull();
    expect(view.secondaryAction).toBeNull();
  });

  it("concurrency limit is not a billing repair: no billing CTA", () => {
    const view = billingGateView("concurrency_limit", MANAGER);
    expect(view.title).toBe("Sandbox limit reached");
    expect(view.primaryAction).toBeNull();
    expect(view.secondaryAction).toBeNull();
  });

  it("overage_disabled and cap_exhausted point admins at settings only", () => {
    for (const reason of ["overage_disabled", "cap_exhausted"] as const) {
      const view = billingGateView(reason, { ...MANAGER, isPaidPlan: true });
      expect(view.primaryAction?.label).toBe("Billing settings");
      expect(view.secondaryAction).toBeNull();
    }
  });

  it("external_billing_hold renders the payment path like payment_failed", () => {
    const view = billingGateView("external_billing_hold", { ...MANAGER, isPaidPlan: true });
    expect(view.kind).toBe("payment");
    expect(view.primaryAction?.label).toBe("Billing settings");
  });

  it("never leaks a raw reason code: unknown reasons render the generic state", () => {
    const view = billingGateView("unknown", MANAGER);
    expect(view.title).toBe("Cloud usage paused");
  });

  it("falls back to billing settings when the surface has no checkout wiring", () => {
    const view = billingGateView("credits_exhausted", {
      isPaidPlan: false,
      canManageBilling: true,
      onOpenBilling: noop,
    });
    expect(view.primaryAction?.label).toBe("Billing settings");
    expect(view.secondaryAction).toBeNull();
  });

  it("covers every typed reason without throwing", () => {
    const reasons: BillingGateReason[] = [
      "credits_exhausted",
      "overage_disabled",
      "cap_exhausted",
      "payment_failed",
      "external_billing_hold",
      "admin_hold",
      "concurrency_limit",
      "llm_credits_exhausted",
      "llm_limit_reached",
      "unknown",
    ];
    for (const reason of reasons) {
      const view = billingGateView(reason, MANAGER);
      expect(view.title.length).toBeGreaterThan(0);
      expect(view.description.length).toBeGreaterThan(0);
    }
  });
});

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
