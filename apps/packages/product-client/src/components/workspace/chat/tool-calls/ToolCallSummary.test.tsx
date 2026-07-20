/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolCallSummary } from "#product/components/workspace/chat/tool-calls/ToolCallSummary";

afterEach(cleanup);

describe("ToolCallSummary", () => {
  it("shows the completed-work divider only while collapsed and restores turn spacing when expanded", () => {
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
    expect(ledger.parentElement?.className).toContain("gap-4");
    expect(container.querySelector("[data-completed-work-divider]")).toBeNull();

    fireEvent.click(disclosure);
    const motionShell = container.querySelector("[data-animated-collapsible-content]");
    expect(screen.queryByText("Work ledger")).not.toBeNull();
    expect(motionShell?.getAttribute("data-expanded")).toBe("false");
    expect((motionShell as HTMLElement | null)?.style.gridTemplateRows).toBe("0fr");
    expect(motionShell?.hasAttribute("inert")).toBe(true);
    expect(container.querySelectorAll("[data-completed-work-divider]")).toHaveLength(1);
  });
});
