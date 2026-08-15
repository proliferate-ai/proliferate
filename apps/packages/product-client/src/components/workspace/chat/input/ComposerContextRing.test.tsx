// @vitest-environment jsdom

import type { UsageState } from "@anyharness/sdk";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerContextRing } from "#product/components/workspace/chat/input/ComposerContextRing";

const mocks = vi.hoisted(() => ({
  usage: null as UsageState | null,
}));

vi.mock("#product/hooks/chat/derived/use-active-session-usage", () => ({
  useActiveSessionUsage: () => mocks.usage,
}));

function createUsage(overrides: Partial<UsageState> = {}): UsageState {
  return {
    used: 33100,
    size: 300000,
    cost: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mocks.usage = null;
});

describe("ComposerContextRing", () => {
  it("renders nothing when there is no active-session usage", () => {
    mocks.usage = null;
    const { container } = render(<ComposerContextRing />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the harness never emitted a usage size", () => {
    mocks.usage = createUsage({ size: 0 });
    const { container } = render(<ComposerContextRing />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when used or size is not a finite number", () => {
    mocks.usage = createUsage({ used: Number.NaN });
    const { container } = render(<ComposerContextRing />);
    expect(container.innerHTML).toBe("");
  });

  it("clamps the arc and rows at 100% when used exceeds size", () => {
    mocks.usage = createUsage({ used: 320000, size: 300000 });
    render(<ComposerContextRing />);

    const trigger = screen.getByRole("button", { name: /320\.0k of 300\.0k used/ });
    fireEvent.click(trigger);
    const arc = trigger.querySelectorAll("circle")[1]!;
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBe(0);
    expect(screen.getByText("Used").nextElementSibling?.textContent).toBe("100.0%");
    expect(screen.getByText("Free space").nextElementSibling?.textContent).toBe("0.0%");
  });

  it("draws the arc from used/size and stays neutral below the threshold", () => {
    mocks.usage = createUsage();
    render(<ComposerContextRing />);

    const trigger = screen.getByRole("button", { name: /33\.1k of 300\.0k used/ });
    const arc = trigger.querySelectorAll("circle")[1]!;
    // 43.98 × (1 − 33100/300000): the ring's own dash math, not a rounded percentage.
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(39.1275, 3);
    expect(arc.getAttribute("class")).toContain("stroke-muted-foreground");
    expect(trigger.getAttribute("data-context-usage-over-threshold")).toBeNull();
  });

  it("turns destructive at 90% of the session's context budget", () => {
    mocks.usage = createUsage({ used: 270000, size: 300000 });
    render(<ComposerContextRing />);

    const trigger = screen.getByRole("button", { name: /270\.0k of 300\.0k used/ });
    const arc = trigger.querySelectorAll("circle")[1]!;
    expect(arc.getAttribute("class")).toContain("stroke-destructive");
    expect(trigger.getAttribute("data-context-usage-over-threshold")).toBe("");
  });

  it("opens a popover with header, progress bar, and used/free rows", () => {
    mocks.usage = createUsage();
    render(<ComposerContextRing />);

    fireEvent.click(screen.getByRole("button", { name: /33\.1k of 300\.0k used/ }));

    expect(screen.getByText("Context")).toBeTruthy();
    expect(screen.getByText("33.1k/300.0k")).toBeTruthy();
    expect(screen.getByText("Used")).toBeTruthy();
    expect(screen.getByText("11.0%")).toBeTruthy();
    expect(screen.getByText("Free space")).toBeTruthy();
    expect(screen.getByText("89.0%")).toBeTruthy();
    expect(screen.queryByText("Session cost")).toBeNull();
  });

  it("shows a session-cost row only for a well-formed cost", () => {
    mocks.usage = createUsage({ cost: { amount: 0.11003595, currency: "USD" } });
    render(<ComposerContextRing />);

    fireEvent.click(screen.getByRole("button", { name: /33\.1k of 300\.0k used/ }));

    expect(screen.getByText("Session cost")).toBeTruthy();
    expect(screen.getByText("$0.11")).toBeTruthy();
  });

  it("hides the cost row when cost is malformed", () => {
    mocks.usage = createUsage({ cost: { amount: "0.11", currency: "USD" } as never });
    render(<ComposerContextRing />);

    fireEvent.click(screen.getByRole("button", { name: /33\.1k of 300\.0k used/ }));

    expect(screen.queryByText("Session cost")).toBeNull();
  });
});
