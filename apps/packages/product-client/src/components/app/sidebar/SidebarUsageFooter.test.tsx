// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSummary } from "@proliferate/cloud-sdk";
import { SidebarUsageFooter } from "#product/components/app/sidebar/SidebarUsageFooter";

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
  useUsageSummary: () => state.query,
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

vi.mock("@proliferate/ui/primitives/PopoverButton", () => ({
  POPOVER_SURFACE_CLASS: "surface",
  PopoverButton: ({
    trigger,
    children,
  }: {
    trigger: ReactElement<{ meter?: "compute" | "llm" }>;
    children: (close: () => void) => ReactNode;
  }) => (
    <div>
      {trigger}
      {trigger.props.meter === "compute" ? (
        <div>{children(vi.fn())}</div>
      ) : null}
    </div>
  ),
}));

describe("SidebarUsageFooter", () => {
  beforeEach(() => {
    state.authStatus = "authenticated";
    state.usageMeteringEnabled = true;
    state.billingEnabled = true;
    state.query = { data: undefined, isLoading: true, refetch: vi.fn() };
    state.navigate.mockClear();
  });

  afterEach(cleanup);

  it("hides the concern when signed out or usage metering is unavailable", () => {
    state.authStatus = "anonymous";
    const { container, rerender } = render(<SidebarUsageFooter />);
    expect(container.childElementCount).toBe(0);

    state.authStatus = "authenticated";
    state.usageMeteringEnabled = false;
    rerender(<SidebarUsageFooter />);
    expect(container.childElementCount).toBe(0);
  });

  it("renders truthful loading and unavailable states", () => {
    const { rerender } = render(<SidebarUsageFooter />);
    expect(screen.getByRole("button", { name: /Compute usage, loading/ })).not.toBeNull();
    expect(screen.getByText(/Loading usage/)).not.toBeNull();

    state.query = { data: undefined, isLoading: false, refetch: vi.fn() };
    rerender(<SidebarUsageFooter />);
    expect(screen.getByRole("button", { name: /LLM usage, unavailable/ })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.query.refetch).toHaveBeenCalledTimes(1);
  });

  it("exposes top-up and billing only when the server supports them", () => {
    state.query = { data: usage(), isLoading: false, refetch: vi.fn() };
    const { rerender } = render(<SidebarUsageFooter />);
    expect(screen.getByRole("button", { name: "Top up" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Billing" })).not.toBeNull();

    state.billingEnabled = false;
    rerender(<SidebarUsageFooter />);
    expect(screen.queryByRole("button", { name: "Top up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Billing" })).toBeNull();
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
    render(<SidebarUsageFooter />);

    expect(screen.queryByText(/Ask your admin/)).toBeNull();
    expect(screen.getByText("Billing actions aren't available on this deployment.")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Compute usage, No allocation/ })).not.toBeNull();
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
