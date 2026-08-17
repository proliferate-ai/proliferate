/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolCallSummary } from "#product/components/workspace/chat/tool-calls/ToolCallSummary";

let pendingFrames: FrameRequestCallback[];

beforeEach(() => {
  pendingFrames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    pendingFrames.push(callback);
    return pendingFrames.length;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ToolCallSummary", () => {
  it("keeps the completed-work divider mounted and collapses it in step with the disclosure", () => {
    const { container } = render(
      <ToolCallSummary
        label="Worked for 13m 25s"
        summary="2 messages, 3 tool calls"
        showWorkDivider
        borderless
        completionContent={<div>Edited files</div>}
        renderChildren={() => <div>Work ledger</div>}
      />,
    );

    const disclosure = screen.getByRole("button", { name: /Worked for 13m 25s/ });
    expect(container.querySelectorAll("[data-chat-transcript-ignore].border-t")).toHaveLength(1);
    expect(container.textContent).not.toContain("Final message");
    expect(container.innerHTML).not.toContain("flex-1 border-t");

    fireEvent.click(disclosure);
    expect(screen.getByText("Work ledger")).toBeTruthy();
    const ledger = screen.getByText("Work ledger");
    const summaryShell = container.querySelector("[data-completed-work-summary]");
    const ledgerShell = container.querySelector("[data-completed-work-ledger]");
    expect(summaryShell).not.toBeNull();
    expect(ledgerShell).not.toBeNull();
    expect(disclosure.className).toContain("border-0");
    expect(disclosure.className).toContain("rounded-none");
    expect(disclosure.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    expect(disclosure.className).not.toMatch(/(?:^|\s)rounded-md(?:\s|$)/);
    expect(ledgerShell?.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    expect(ledgerShell?.className).not.toMatch(/(?:^|\s)rounded(?:\s|$)/);
    expect(ledger.parentElement?.className).toContain("mt-4");
    expect(ledger.parentElement?.className).toContain("gap-transcript-turn");
    // The divider stays mounted while expanded — it exits through the same
    // disclosure motion as the ledger instead of popping out (PRO-181).
    const expandedDivider = container.querySelector("[data-completed-work-divider]");
    expect(expandedDivider).not.toBeNull();
    const expandedDividerShell = expandedDivider?.closest("[data-animated-collapsible-content]");
    expect(expandedDividerShell?.getAttribute("data-expanded")).toBe("false");
    expect((expandedDividerShell as HTMLElement | null)?.style.gridTemplateRows).toBe("0fr");

    fireEvent.click(disclosure);
    act(() => {
      // The first click left a cancelled ledger frame at the head of the
      // queue (its effect cleanup ran but the stale callback is still
      // enqueued); drain the queue rather than shifting once so the fresh
      // divider frame scheduled by this click actually flushes.
      while (pendingFrames.length > 0) {
        pendingFrames.shift()?.(0);
      }
    });
    const collapsedDivider = container.querySelector("[data-completed-work-divider]");
    expect(collapsedDivider).not.toBeNull();
    const collapsedDividerShell = collapsedDivider?.closest("[data-animated-collapsible-content]");
    expect(collapsedDividerShell?.getAttribute("data-expanded")).toBe("true");
    expect((collapsedDividerShell as HTMLElement | null)?.style.gridTemplateRows).toBe("1fr");
    const ledgerShellMotion = container
      .querySelector("[data-completed-work-ledger]")
      ?.closest("[data-animated-collapsible-content]");
    expect(screen.queryByText("Work ledger")).not.toBeNull();
    expect(ledgerShellMotion?.getAttribute("data-expanded")).toBe("false");
    expect((ledgerShellMotion as HTMLElement | null)?.style.gridTemplateRows).toBe("0fr");
    expect(ledgerShellMotion?.hasAttribute("inert")).toBe(true);
  });
});
