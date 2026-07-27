// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageSummary } from "@proliferate/cloud-sdk";
import {
  ConsumptionCard,
  type SidebarConsumptionMeter,
  type SidebarConsumptionState,
} from "#product/components/app/sidebar/SidebarConsumptionCard";

afterEach(cleanup);

describe("sidebar consumption", () => {
  it("states usage as readable rows instead of concentric rings", () => {
    const { container } = render(
      <ConsumptionCard state={{ kind: "ready", usageSummary: usage() }} />,
    );

    // Rings are rejected: no meter geometry may come back to this surface.
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect(container.querySelectorAll("circle[data-meter]")).toHaveLength(0);
    expect(screen.getByText("Usage")).not.toBeNull();
    expect(screen.getByText("Compute").parentElement?.textContent).toContain("50% used");
    expect(screen.getByText("Compute").parentElement?.textContent).toContain("1h left");
    expect(screen.getByText("LLM").parentElement?.textContent).toContain("90% used");
    expect(screen.getByText("LLM").parentElement?.textContent).toContain("$1.00 left");
  });

  it("keeps loading and unavailable states explicit", () => {
    const { rerender } = render(
      <ConsumptionCard state={{ kind: "loading" }} />,
    );
    expect(screen.getByRole("status").textContent).toContain("Loading usage");

    const onRetry = vi.fn();
    rerender(
      <ConsumptionCard
        state={{ kind: "unavailable", message: "Usage service did not respond." }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Usage unavailable")).not.toBeNull();
    expect(screen.getByText("Usage service did not respond.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows one supported Billing action without a duplicate Top up label", () => {
    const onBilling = vi.fn();
    render(
      <ConsumptionCard
        state={{ kind: "ready", usageSummary: usage() }}
        actions={{ kind: "billing", onBilling }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Top up" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Billing" }));
    expect(onBilling).toHaveBeenCalledTimes(1);
  });

  it("keeps admin-managed billing singular and explains the limit owner", () => {
    const onBilling = vi.fn();
    const { rerender } = render(
      <ConsumptionCard
        state={{ kind: "ready", usageSummary: usage({ canSelfServeTopUp: false }) }}
        actions={{
          kind: "admin-managed",
          message: "Billing is managed by your organization admins.",
          onBilling,
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Top up" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Billing" }));
    expect(onBilling).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Billing is managed by your organization admins.")).not.toBeNull();

    rerender(
      <ConsumptionCard
        state={{
          kind: "ready",
          usageSummary: usage({ llmRemainingUsd: 0, canSelfServeTopUp: false }),
        }}
        actions={{
          kind: "admin-managed",
          message: "Billing is managed by your organization admins.",
          onBilling,
        }}
      />,
    );
    expect(screen.getByText("Ask your admin to raise your limit.")).not.toBeNull();
    expect(screen.queryByText("Billing is managed by your organization admins.")).toBeNull();
    expect(screen.getByRole("button", { name: "Billing" })).not.toBeNull();
  });

  describe.each([
    ["compute", "Compute"],
    ["llm", "LLM"],
  ] as const)("%s meter truthfulness", (meter, label) => {
    it.each([
      { name: "zero allocation", scenario: "zero-allocation", detail: "No allocation" },
      { name: "authoritative zero cap", scenario: "zero-cap", detail: "No allocation" },
      { name: "positive exhausted usage", scenario: "exhausted", detail: "100% used · Exhausted" },
      { name: "nonzero remaining usage", scenario: "available", detail: "10% used" },
      { name: "explicit blocked limit without usage", scenario: "blocked", detail: "Blocked" },
      {
        name: "positive explicit blocked limit",
        scenario: "positive-blocked",
        detail: "100% used · Exhausted · Blocked",
      },
      { name: "loading", scenario: "loading", detail: "Loading usage" },
      { name: "unavailable", scenario: "unavailable", detail: "Usage unavailable" },
    ] as const)("keeps $name stated in words", ({ scenario, detail }) => {
      const state = stateForMeterScenario(meter, scenario);
      render(<ConsumptionCard state={state} />);

      if (state.kind === "ready") {
        expect(screen.getByText(label).parentElement?.textContent).toContain(detail);
        if (scenario === "zero-allocation") {
          expect(screen.queryByText("0% used")).toBeNull();
        }
      } else {
        expect(screen.getByText(new RegExp(detail))).not.toBeNull();
      }
    });
  });

  it("preserves contractually supported unlimited Compute usage", () => {
    render(
      <ConsumptionCard
        state={{ kind: "ready", usageSummary: usage({ computeRemainingSeconds: null }) }}
      />,
    );

    expect(screen.getByText("Compute").parentElement?.textContent).toContain("No limit");
    expect(screen.getByText("Compute").parentElement?.textContent).toContain("Unlimited");
  });
});

type MeterScenario =
  | "zero-allocation"
  | "zero-cap"
  | "exhausted"
  | "available"
  | "blocked"
  | "positive-blocked"
  | "loading"
  | "unavailable";

function stateForMeterScenario(
  meter: SidebarConsumptionMeter,
  scenario: MeterScenario,
): SidebarConsumptionState {
  if (scenario === "loading") {
    return { kind: "loading" };
  }
  if (scenario === "unavailable") {
    return { kind: "unavailable", message: "Usage service did not respond." };
  }

  const usedValue = scenario === "zero-allocation"
    || scenario === "zero-cap"
    || scenario === "blocked"
    ? 0
    : 1;
  const remainingValue = scenario === "zero-allocation" || scenario === "exhausted" ? 0 : 9;
  const limit = scenario === "zero-cap"
    ? { window: "month", capValue: 0, usedValue: 0, blocked: true }
    : scenario === "blocked" || scenario === "positive-blocked"
      ? {
        window: "month",
        capValue: 10,
        usedValue: scenario === "positive-blocked" ? 1 : 0,
        blocked: true,
      }
      : null;

  return {
    kind: "ready",
    usageSummary: usage(meter === "compute"
      ? {
        computeUsedSecondsMtd: usedValue,
        computeRemainingSeconds: remainingValue,
        computeLimit: limit,
      }
      : {
        llmUsedUsdMtd: usedValue,
        llmRemainingUsd: remainingValue,
        llmLimit: limit,
      }),
  };
}

function usage(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    computeUsedSecondsMtd: 3600,
    computeRemainingSeconds: 3600,
    llmUsedUsdMtd: 9,
    llmRemainingUsd: 1,
    computeLimit: null,
    llmLimit: null,
    canSelfServeTopUp: true,
    ...overrides,
  };
}
