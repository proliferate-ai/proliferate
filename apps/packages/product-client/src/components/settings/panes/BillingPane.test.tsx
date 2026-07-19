// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillingPane } from "#product/components/settings/panes/BillingPane";

const state = vi.hoisted(() => ({
  activeOrganization: { id: "org-active", name: "Active org" } as {
    id: string;
    name: string;
  } | null,
  organizations: [
    { id: "org-active", name: "Active org" },
    { id: "org-meter", name: "Meter org" },
  ],
  organizationsQuery: { isLoading: false },
  isAdmin: vi.fn(() => ({ isAdmin: true, isLoading: false })),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@proliferate/product-surfaces/settings/BillingSettingsSurface", () => ({
  BillingSettingsSurface: ({
    organization,
    checkoutReturnState,
  }: {
    organization: { id: string; name: string } | null;
    checkoutReturnState: string | null;
  }) => (
    <div data-testid="billing-surface">
      {organization?.id ?? "personal"}:{checkoutReturnState ?? "none"}
    </div>
  ),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ links: { openExternal: vi.fn() } }),
}));

vi.mock("#product/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({
    activeOrganization: state.activeOrganization,
    organizations: state.organizations,
    organizationsQuery: state.organizationsQuery,
  }),
}));

vi.mock("#product/hooks/access/cloud/organizations/use-is-admin", () => ({
  useIsAdmin: state.isAdmin,
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({ billingEnabled: true, pricing: {} }),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: true }),
}));

describe("BillingPane owner routing", () => {
  beforeEach(() => {
    state.activeOrganization = { id: "org-active", name: "Active org" };
    state.organizations = [
      { id: "org-active", name: "Active org" },
      { id: "org-meter", name: "Meter org" },
    ];
    state.organizationsQuery = { isLoading: false };
    state.isAdmin.mockClear();
  });

  afterEach(cleanup);

  it("renders the exact routed organization rather than the unrelated active owner", () => {
    render(
      <BillingPane focus={{
        billingOwnerScope: "organization",
        billingOrganizationId: "org-meter",
        checkout: "success",
      }} />,
    );

    expect(screen.getByTestId("billing-surface").textContent).toBe("org-meter:success");
    expect(state.isAdmin).toHaveBeenCalledWith("org-meter");
  });

  it("fails closed instead of falling back when the routed owner is unavailable", () => {
    render(
      <BillingPane focus={{
        billingOwnerScope: "organization",
        billingOrganizationId: "org-missing",
      }} />,
    );

    expect(screen.queryByTestId("billing-surface")).toBeNull();
    expect(screen.getByText("Billing owner unavailable")).not.toBeNull();
  });

  it("preserves the existing active-organization behavior for ordinary settings navigation", () => {
    render(<BillingPane />);

    expect(screen.getByTestId("billing-surface").textContent).toBe("org-active:none");
    expect(state.isAdmin).toHaveBeenCalledWith("org-active");
  });
});
