// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageSummary } from "@proliferate/cloud-sdk";
import {
  ConsumptionCard,
  SidebarUsageMeterTrigger,
} from "#product/components/app/sidebar/SidebarConsumptionCard";

afterEach(cleanup);

describe("sidebar consumption", () => {
  it("renders independently labeled keyboard-focusable Compute and LLM rings", () => {
    const onComputeOpen = vi.fn();
    const onLlmOpen = vi.fn();
    const state = { kind: "ready", usageSummary: usage() } as const;
    render(
      <>
        <SidebarUsageMeterTrigger meter="compute" state={state} onClick={onComputeOpen} />
        <SidebarUsageMeterTrigger meter="llm" state={state} onClick={onLlmOpen} />
      </>,
    );

    const compute = screen.getByRole("button", { name: /Compute usage, 50% used/ });
    const llm = screen.getByRole("button", { name: /LLM usage, 90% used/ });
    expect(compute.getAttribute("type")).toBe("button");
    expect(llm.getAttribute("type")).toBe("button");
    compute.focus();
    expect(document.activeElement).toBe(compute);
    llm.focus();
    expect(document.activeElement).toBe(llm);
    fireEvent.keyDown(compute, { key: "Enter" });
    fireEvent.keyDown(llm, { key: " " });
    expect(onComputeOpen).toHaveBeenCalledTimes(1);
    expect(onLlmOpen).toHaveBeenCalledTimes(1);
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

  it("shows only supported billing actions and a truthful admin limit message", () => {
    const onBilling = vi.fn();
    render(
      <ConsumptionCard
        state={{
          kind: "ready",
          usageSummary: usage({ llmRemainingUsd: 0, canSelfServeTopUp: false }),
        }}
        onBilling={onBilling}
      />,
    );

    expect(screen.queryByRole("button", { name: "Top up" })).toBeNull();
    expect(screen.getByText("Ask your admin to raise your limit.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Billing" }));
    expect(onBilling).toHaveBeenCalledTimes(1);
  });
});

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
