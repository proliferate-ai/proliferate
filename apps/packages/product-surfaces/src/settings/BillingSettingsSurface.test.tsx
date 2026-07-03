// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillingSettingsSurface } from "./BillingSettingsSurface";

const cloudHooks = vi.hoisted(() => ({
  useCloudBilling: vi.fn(),
  useCloudBillingActions: vi.fn(),
  createCloudCheckout: vi.fn(),
  createBillingPortal: vi.fn(),
  createRefillCheckout: vi.fn(),
  updateOverageEnabled: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCloudBilling: cloudHooks.useCloudBilling,
  useCloudBillingActions: cloudHooks.useCloudBillingActions,
}));

function billingPlan(overrides: Record<string, unknown> = {}) {
  return {
    plan: "free",
    billingMode: "enforce",
    proBillingEnabled: false,
    isUnlimited: false,
    hasUnlimitedCloudHours: false,
    freeSandboxHours: 5,
    usedSandboxHours: 1,
    remainingSandboxHours: 4,
    cloudRepoLimit: 3,
    activeCloudRepoCount: 1,
    concurrentSandboxLimit: 1,
    activeSandboxCount: 0,
    isPaidCloud: false,
    overageEnabled: false,
    hostedInvoiceUrl: null,
    startBlocked: false,
    startBlockReason: null,
    activeSpendHold: false,
    billableSeatCount: 1,
    includedManagedCloudHours: null,
    remainingManagedCloudHours: null,
    managedCloudOverageEnabled: false,
    managedCloudOverageCapCents: null,
    managedCloudOverageUsedCents: null,
    overagePricePerHourCents: 100,
    repoEnvironmentLimit: 3,
    legacyCloudSubscription: false,
    grantAllocations: [],
    ...overrides,
  };
}

describe("BillingSettingsSurface", () => {
  beforeEach(() => {
    cloudHooks.createCloudCheckout.mockResolvedValue({ url: "https://billing.example/checkout" });
    cloudHooks.createBillingPortal.mockResolvedValue({ url: "https://billing.example/portal" });
    cloudHooks.createRefillCheckout.mockResolvedValue({ url: "https://billing.example/refill" });
    cloudHooks.updateOverageEnabled.mockResolvedValue({});
    cloudHooks.useCloudBilling.mockImplementation((owner: { ownerScope?: string } | undefined) => ({
      data: owner?.ownerScope === "organization"
        ? billingPlan({ plan: "pro", isPaidCloud: true, repoEnvironmentLimit: 20 })
        : billingPlan(),
      isLoading: false,
      isError: false,
      refetch: cloudHooks.refetch,
    }));
    cloudHooks.useCloudBillingActions.mockReturnValue({
      createCloudCheckout: cloudHooks.createCloudCheckout,
      creatingCloudCheckout: false,
      createBillingPortal: cloudHooks.createBillingPortal,
      creatingBillingPortal: false,
      createRefillCheckout: cloudHooks.createRefillCheckout,
      creatingRefillCheckout: false,
      updateOverageEnabled: cloudHooks.updateOverageEnabled,
      updatingOverage: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the no-organization state and delegates organization navigation", () => {
    const onOpenOrganizationSettings = vi.fn();

    render(
      <BillingSettingsSurface
        organization={null}
        onOpenUrl={vi.fn()}
        onOpenOrganizationSettings={onOpenOrganizationSettings}
      />,
    );

    expect(screen.queryByText("Organization billing")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));

    expect(onOpenOrganizationSettings).toHaveBeenCalledTimes(1);
  });

  it("opens returned billing portal URLs through the app callback", async () => {
    const onOpenUrl = vi.fn();

    render(
      <BillingSettingsSurface
        organization={{
          id: "org_1",
          name: "Team One",
          canManageBilling: true,
          loading: false,
        }}
        onOpenUrl={onOpenUrl}
        onOpenOrganizationSettings={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("heading", { name: "Billing" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText(/tracked, budgeted, and topped up separately/)).toBeTruthy();
    expect(screen.getByText("360 PCUs")).toBeTruthy();
    expect(screen.getByText("12,000 LLM credits")).toBeTruthy();
    expect(screen.queryByText("Loading")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add compute units" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add LLM credits" }).disabled).toBe(true);
    expect(screen.getAllByText("Credit pack checkout for organizations is coming soon.")).toHaveLength(2);
    expect(screen.getByLabelText("Auto top-up")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    const dialog = screen.getByRole("dialog", { name: "Choose your plan" });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Core" })).toBeTruthy();
    expect(within(dialog).getByText("20 PCUs / month")).toBeTruthy();
    expect(within(dialog).getByText("2,500 LLM credits / month")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Billing portal" }));

    await waitFor(() => {
      expect(onOpenUrl).toHaveBeenCalledWith("https://billing.example/portal");
    });
    expect(cloudHooks.createBillingPortal).toHaveBeenCalledTimes(1);
    expect(cloudHooks.createRefillCheckout).not.toHaveBeenCalled();
  });

  it("passes the selected return surface to billing actions", () => {
    render(
      <BillingSettingsSurface
        billingReturnSurface="desktop"
        organization={{
          id: "org_1",
          name: "Team One",
          canManageBilling: true,
          loading: false,
        }}
        onOpenUrl={vi.fn()}
        onOpenOrganizationSettings={vi.fn()}
      />,
    );

    expect(cloudHooks.useCloudBillingActions).toHaveBeenCalledWith(
      { ownerScope: "organization", organizationId: "org_1" },
      { returnSurface: "desktop" },
    );
  });

  it("shows billing action errors from failed checkout starts", async () => {
    cloudHooks.useCloudBilling.mockImplementation(() => ({
      data: billingPlan(),
      isLoading: false,
      isError: false,
      refetch: cloudHooks.refetch,
    }));
    cloudHooks.createCloudCheckout.mockRejectedValueOnce(new Error("checkout offline"));

    render(
      <BillingSettingsSurface
        organization={{
          id: "org_1",
          name: "Team One",
          canManageBilling: true,
          loading: false,
        }}
        onOpenUrl={vi.fn()}
        onOpenOrganizationSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    const dialog = screen.getByRole("dialog", { name: "Choose your plan" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Upgrade to Core" }),
    );

    await waitFor(() => {
      expect(within(dialog).queryByText("checkout offline")).not.toBeNull();
    });
  });
});
