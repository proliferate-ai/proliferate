// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageSummary } from "@proliferate/cloud-sdk";
import {
  ConsumptionCard,
  SidebarUsageTrigger,
  type SidebarConsumptionMeter,
  type SidebarConsumptionState,
} from "#product/components/app/sidebar/SidebarConsumptionCard";

afterEach(cleanup);

describe("sidebar consumption", () => {
  it("renders one keyboard-focusable trigger that labels both concentric rings", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const state = { kind: "ready", usageSummary: usage() } as const;
    render(<SidebarUsageTrigger state={state} onClick={onOpen} />);

    const trigger = screen.getByRole("button", {
      name: /Usage\. Compute, 50% used\. LLM, 90% used/,
    });
    expect(trigger.getAttribute("type")).toBe("button");
    expect(trigger.querySelectorAll("circle[data-meter]")).toHaveLength(4);
    const computeRadius = Number(trigger
      .querySelector('circle[data-meter="compute"][data-part="track"]')
      ?.getAttribute("r"));
    const llmRadius = Number(trigger
      .querySelector('circle[data-meter="llm"][data-part="track"]')
      ?.getAttribute("r"));
    expect(computeRadius).toBeGreaterThan(llmRadius);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(2);
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
      {
        name: "zero allocation",
        scenario: "zero-allocation",
        ariaStatus: "No allocation",
        detail: "No allocation",
        fullRing: true,
      },
      {
        name: "authoritative zero cap",
        scenario: "zero-cap",
        ariaStatus: "No allocation",
        detail: "No allocation",
        fullRing: true,
      },
      {
        name: "positive exhausted usage",
        scenario: "exhausted",
        ariaStatus: "100% used, exhausted",
        detail: "100% used · Exhausted",
        fullRing: true,
      },
      {
        name: "nonzero remaining usage",
        scenario: "available",
        ariaStatus: "10% used",
        detail: "10% used",
        fullRing: false,
      },
      {
        name: "explicit blocked limit without usage",
        scenario: "blocked",
        ariaStatus: "blocked",
        detail: "Blocked",
        fullRing: true,
      },
      {
        name: "positive explicit blocked limit",
        scenario: "positive-blocked",
        ariaStatus: "100% used, exhausted, blocked",
        detail: "100% used · Exhausted · Blocked",
        fullRing: true,
      },
      {
        name: "loading",
        scenario: "loading",
        ariaStatus: "loading",
        detail: "Loading usage",
        fullRing: false,
      },
      {
        name: "unavailable",
        scenario: "unavailable",
        ariaStatus: "unavailable",
        detail: "Usage unavailable",
        fullRing: false,
      },
    ] as const)("keeps $name visual text and ARIA aligned", ({
      scenario,
      ariaStatus,
      detail,
      fullRing,
    }) => {
      const state = stateForMeterScenario(meter, scenario);
      render(
        <>
          <SidebarUsageTrigger state={state} />
          <ConsumptionCard state={state} />
        </>,
      );

      const trigger = screen.getByRole("button", { name: /Open usage details/ });
      expect(trigger.getAttribute("aria-label")).toContain(`${label}, ${ariaStatus}`);
      const dashOffset = trigger
        .querySelector(`circle[data-meter="${meter}"][data-part="progress"]`)
        ?.getAttribute("stroke-dashoffset");
      expect(dashOffset === "0").toBe(fullRing);

      if (state.kind === "ready") {
        expect(screen.getByText(label).parentElement?.textContent).toContain(detail);
        expect(screen.getByText(label).parentElement?.textContent).toContain(
          meter === "compute" ? "Outer ring" : "Inner ring",
        );
        if (scenario === "zero-allocation") {
          expect(screen.queryByText("0% used")).toBeNull();
        }
      } else {
        expect(screen.getByText(new RegExp(detail))).not.toBeNull();
      }
    });
  });

  it("preserves contractually supported unlimited Compute usage", () => {
    const state = {
      kind: "ready",
      usageSummary: usage({ computeRemainingSeconds: null }),
    } as const;
    render(
      <>
        <SidebarUsageTrigger state={state} />
        <ConsumptionCard state={state} />
      </>,
    );

    expect(screen.getByRole("button", { name: /Compute, unlimited/ })).not.toBeNull();
    expect(screen.getByText("Compute").parentElement?.textContent).toContain("No limit");
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
