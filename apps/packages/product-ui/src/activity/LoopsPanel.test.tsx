/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoopCapabilities, LoopWire } from "@proliferate/product-domain/activity/loop";
import { LoopsPanel } from "./LoopsPanel";

afterEach(() => {
  cleanup();
});

const SUPPORTED: LoopCapabilities = { supported: true, native: true };

function loop(overrides: Partial<LoopWire> = {}): LoopWire {
  return {
    loopId: "cron-1",
    prompt: "append ping + timestamp to PING.log",
    schedule: { kind: "cron", expr: "*/5 * * * *" },
    recurring: true,
    status: "active",
    native: true,
    lastFiredAtMs: null,
    fireCount: 3,
    updatedAtMs: 1_751_450_000_000,
    ...overrides,
  };
}

describe("LoopsPanel", () => {
  it("opens the composer by default when there are no loops yet", () => {
    const onArm = vi.fn();
    render(
      <LoopsPanel
        loops={[]}
        capabilities={SUPPORTED}
        nowMs={1_751_450_100_000}
        onArm={onArm}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Loop prompt")).toBeTruthy();
  });

  it("shows the empty state once the composer is cancelled", () => {
    render(
      <LoopsPanel
        loops={[]}
        capabilities={SUPPORTED}
        nowMs={1_751_450_100_000}
        onArm={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("No loops armed.")).toBeTruthy();
  });

  it("arms a loop from the composer with the prompt and interval sugar", () => {
    const onArm = vi.fn();
    render(
      <LoopsPanel
        loops={[]}
        capabilities={SUPPORTED}
        nowMs={1_751_450_100_000}
        onArm={onArm}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Loop prompt"), {
      target: { value: "check build status" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Arm loop" }));
    expect(onArm).toHaveBeenCalledWith({
      prompt: "check build status",
      schedule: { kind: "interval", expr: "5m" },
      recurring: true,
    });
  });

  it("renders armed loops with cadence, next-fire, fire count, and a native badge", () => {
    render(
      <LoopsPanel
        loops={[loop()]}
        capabilities={SUPPORTED}
        nowMs={1_751_450_100_000}
        onArm={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("every 5 minutes")).toBeTruthy();
    expect(screen.getByText("3 fires")).toBeTruthy();
    expect(screen.getByText("native")).toBeTruthy();
  });

  it("labels a runtime-emulated loop distinctly from native ones", () => {
    render(
      <LoopsPanel
        loops={[loop({ native: false })]}
        capabilities={SUPPORTED}
        nowMs={1_751_450_100_000}
        onArm={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("emulated")).toBeTruthy();
  });

  it("deletes a loop via its row action", () => {
    const onDelete = vi.fn();
    render(
      <LoopsPanel
        loops={[loop()]}
        capabilities={SUPPORTED}
        nowMs={1_751_450_100_000}
        onArm={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Delete loop/ }));
    expect(onDelete).toHaveBeenCalledWith("cron-1");
  });

  it("makes the fire count a link when a fire-history handler is supplied", () => {
    const onOpenFireHistory = vi.fn();
    render(
      <LoopsPanel
        loops={[loop()]}
        capabilities={SUPPORTED}
        nowMs={1_751_450_100_000}
        onArm={vi.fn()}
        onDelete={vi.fn()}
        onOpenFireHistory={onOpenFireHistory}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "3 fires" }));
    expect(onOpenFireHistory).toHaveBeenCalledWith("cron-1");
  });
});
