// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SeatUsageSample } from "@proliferate/cloud-sdk";
import { SeatUsageMeter } from "#product/components/settings/panes/agents/harness/HarnessSeatUsageMeter";

afterEach(cleanup);

const NOW = new Date("2026-08-26T12:00:00Z");

function sampleFor(extra: Partial<SeatUsageSample> = {}): SeatUsageSample {
  // Seeded from the sanitized live capture of 2026-08-26.
  return {
    apiKeyId: "seat-1",
    sampledAt: "2026-08-26T11:55:00Z",
    util5h: 0.63,
    util7d: 0.51,
    reset5h: "2026-08-26T15:30:00Z",
    reset7d: "2026-08-28T02:00:00Z",
    bindingWindow: "five_hour",
    status: "allowed",
    ...extra,
  } as SeatUsageSample;
}

describe("SeatUsageMeter", () => {
  it("renders live 5h/7d bars with percents and reset times", () => {
    render(<SeatUsageMeter sample={sampleFor()} now={NOW} />);
    expect(screen.getByText("5-hour")).toBeTruthy();
    expect(screen.getByText("7-day")).toBeTruthy();
    expect(screen.getByText("63%")).toBeTruthy();
    expect(screen.getByText("51%")).toBeTruthy();
    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((bar) => bar.getAttribute("aria-valuenow"))).toEqual([
      "63",
      "51",
    ]);
    expect(screen.getAllByText(/^resets /)).toHaveLength(2);
  });

  it("shows the sample age on live bars too — never a stale bar reading as fresh", () => {
    const { container } = render(<SeatUsageMeter sample={sampleFor()} now={NOW} />);
    expect(
      container.querySelector("[data-seat-usage-age]")?.textContent,
    ).toBe("checked 5m ago");
  });

  it("suppresses a reset time already in the past", () => {
    render(
      <SeatUsageMeter
        sample={sampleFor({ reset5h: "2026-08-26T11:00:00Z" })}
        now={NOW}
      />,
    );
    // Only the (future) 7d reset renders; the passed 5h reset says nothing.
    expect(screen.getAllByText(/^resets /)).toHaveLength(1);
  });

  it("keeps the percent label and the warning treatment in agreement at the boundary", () => {
    const { container } = render(
      <SeatUsageMeter sample={sampleFor({ util5h: 0.745, util7d: 0.4 })} now={NOW} />,
    );
    expect(screen.getByText("75%")).toBeTruthy();
    const warned = container.querySelectorAll('[data-seat-usage-warning="true"]');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.textContent).toContain("5-hour");
  });

  it("emphasizes the binding window and not the other", () => {
    const { container } = render(<SeatUsageMeter sample={sampleFor()} now={NOW} />);
    const binding = container.querySelector('[data-seat-usage-window="binding"]');
    const secondary = container.querySelector('[data-seat-usage-window="secondary"]');
    expect(binding?.textContent).toContain("5-hour");
    expect(secondary?.textContent).toContain("7-day");
  });

  it("emphasizes neither window when no binding claim exists", () => {
    const { container } = render(
      <SeatUsageMeter sample={sampleFor({ bindingWindow: null })} now={NOW} />,
    );
    expect(container.querySelector('[data-seat-usage-window="binding"]')).toBeNull();
  });

  it("applies warning treatment at >= 75% utilization only", () => {
    const { container } = render(
      <SeatUsageMeter sample={sampleFor({ util5h: 0.82, util7d: 0.4 })} now={NOW} />,
    );
    const warned = container.querySelectorAll('[data-seat-usage-warning="true"]');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.textContent).toContain("5-hour");
  });

  it("marks the binding window limited when the account is limited", () => {
    render(
      <SeatUsageMeter
        sample={sampleFor({ status: "limited", util5h: 1, util7d: 0.6 })}
        now={NOW}
      />,
    );
    expect(screen.getAllByText("Limit reached")).toHaveLength(1);
  });

  it("renders a probe_failed sample as a dash with the sample age", () => {
    const { container } = render(
      <SeatUsageMeter
        sample={sampleFor({
          status: "probe_failed",
          util5h: null,
          util7d: null,
          reset5h: null,
          reset7d: null,
          bindingWindow: null,
        })}
        now={NOW}
      />,
    );
    const failed = container.querySelector("[data-seat-usage-failed]");
    expect(failed?.textContent).toContain("—");
    expect(failed?.textContent).toContain("Usage check failed");
    expect(failed?.textContent).toContain("checked 5m ago");
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("renders the no-sample-yet state honestly", () => {
    const { container } = render(<SeatUsageMeter sample={undefined} now={NOW} />);
    expect(container.querySelector("[data-seat-usage-empty]")?.textContent).toBe(
      "No usage data yet.",
    );
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });
});
