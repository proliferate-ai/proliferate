// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSummary } from "@proliferate/cloud-sdk";
import { SidebarUsageSection } from "#product/components/app/sidebar/SidebarUsageSection";
import { useOrganizationStore } from "#product/stores/organizations/organization-store";

const useUsageSummary = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
  authStatus: "authenticated" as "loading" | "anonymous" | "authenticated",
  usageMeteringEnabled: true,
  billingEnabled: true,
  query: {
    data: undefined as ReturnType<typeof usage> | undefined,
    isLoading: true,
    refetch: vi.fn(),
  },
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-router-dom")>(),
  useNavigate: () => state.navigate,
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useUsageSummary,
}));

vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthStatus: () => state.authStatus,
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({
    usageMeteringEnabled: state.usageMeteringEnabled,
    billingEnabled: state.billingEnabled,
  }),
}));

describe("SidebarUsageSection", () => {
  beforeEach(() => {
    state.authStatus = "authenticated";
    state.usageMeteringEnabled = true;
    state.billingEnabled = true;
    state.query = { data: undefined, isLoading: true, refetch: vi.fn() };
    state.navigate.mockClear();
    useUsageSummary.mockReset();
    useUsageSummary.mockImplementation(() => state.query);
    useOrganizationStore.setState({
      activeOrganizationId: null,
      activeOrganizationValidated: false,
    });
  });

  afterEach(cleanup);

  it("hides the concern when signed out or usage metering is unavailable", () => {
    state.authStatus = "anonymous";
    const { container, rerender } = render(<SidebarUsageSection />);
    expect(container.childElementCount).toBe(0);

    state.authStatus = "authenticated";
    state.usageMeteringEnabled = false;
    rerender(<SidebarUsageSection />);
    expect(container.childElementCount).toBe(0);
  });

  it("renders truthful loading and unavailable states", () => {
    const { rerender } = render(<SidebarUsageSection />);
    expect(screen.getByText(/Loading usage/)).not.toBeNull();

    state.query = { data: undefined, isLoading: false, refetch: vi.fn() };
    rerender(<SidebarUsageSection />);
    expect(screen.getByText("Usage unavailable")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.query.refetch).toHaveBeenCalledTimes(1);
  });

  it("reads usage as status rows, never as a meter ring", () => {
    state.query = { data: usage(), isLoading: false, refetch: vi.fn() };
    const { container } = render(<SidebarUsageSection />);

    expect(container.querySelectorAll("circle[data-meter]")).toHaveLength(0);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("Compute")).not.toBeNull();
    expect(screen.getByText("LLM")).not.toBeNull();
    // Both meters sit at the same fraction in this fixture, so each row prints it.
    expect(screen.getAllByText("10% used")).toHaveLength(2);
  });

  it("reads personal usage explicitly and explains why its unsupported route has no action", () => {
    state.query = { data: usage(), isLoading: false, refetch: vi.fn() };
    render(<SidebarUsageSection />);

    expect(useUsageSummary).toHaveBeenLastCalledWith(
      { ownerScope: "personal", organizationId: null },
      true,
    );
    expect(screen.queryByRole("button", { name: "Top up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Billing" })).toBeNull();
    expect(screen.getByText(
      "Billing for personal usage isn't available from this menu.",
    )).not.toBeNull();
  });

  it("preserves the selected organization owner in the single Billing destination", () => {
    useOrganizationStore.setState({
      activeOrganizationId: "org-1",
      activeOrganizationValidated: true,
    });
    state.query = { data: usage(), isLoading: false, refetch: vi.fn() };
    render(<SidebarUsageSection />);

    expect(useUsageSummary).toHaveBeenLastCalledWith(
      { ownerScope: "organization", organizationId: "org-1" },
      true,
    );
    expect(screen.queryByRole("button", { name: "Top up" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Billing" }));
    expect(state.navigate).toHaveBeenCalledWith(
      "/settings?section=billing&billingOwnerScope=organization&billingOrganizationId=org-1",
    );
  });

  it("keeps organization-member billing admin-managed and owner-correct", () => {
    useOrganizationStore.setState({
      activeOrganizationId: "org-member",
      activeOrganizationValidated: true,
    });
    state.query = {
      data: usage({ canSelfServeTopUp: false }),
      isLoading: false,
      refetch: vi.fn(),
    };
    render(<SidebarUsageSection />);

    expect(screen.getByText("Billing is managed by your organization admins.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Billing" }));
    expect(state.navigate).toHaveBeenCalledWith(
      "/settings?section=billing&billingOwnerScope=organization&billingOrganizationId=org-member",
    );
  });

  it("does not invent an organization admin for a non-self-service personal owner", () => {
    state.query = {
      data: usage({ canSelfServeTopUp: false }),
      isLoading: false,
      refetch: vi.fn(),
    };
    render(<SidebarUsageSection />);

    expect(screen.queryByText(/organization admins/)).toBeNull();
    expect(screen.getByText(
      "Billing for personal usage isn't available from this menu.",
    )).not.toBeNull();
  });

  it("hides billing actions when the deployment capability is disabled", () => {
    useOrganizationStore.setState({
      activeOrganizationId: "org-1",
      activeOrganizationValidated: true,
    });
    state.query = { data: usage(), isLoading: false, refetch: vi.fn() };
    state.billingEnabled = false;
    render(<SidebarUsageSection />);

    expect(screen.queryByRole("button", { name: "Top up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Billing" })).toBeNull();
    expect(screen.getByText("Billing actions aren't available on this deployment.")).not.toBeNull();
  });

  it("does not direct billing-disabled users to an admin when usage has no allocation", () => {
    state.billingEnabled = false;
    state.query = {
      data: usage({
        computeUsedSecondsMtd: 0,
        computeRemainingSeconds: 0,
        llmUsedUsdMtd: 0,
        llmRemainingUsd: 0,
      }),
      isLoading: false,
      refetch: vi.fn(),
    };
    render(<SidebarUsageSection />);

    expect(screen.queryByText(/Ask your admin/)).toBeNull();
    expect(screen.getByText("Billing actions aren't available on this deployment.")).not.toBeNull();
    expect(screen.getAllByText("No allocation")).toHaveLength(2);
  });
});

function usage(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    computeUsedSecondsMtd: 1,
    computeRemainingSeconds: 9,
    llmUsedUsdMtd: 1,
    llmRemainingUsd: 9,
    computeLimit: null,
    llmLimit: null,
    canSelfServeTopUp: true,
    ...overrides,
  };
}
