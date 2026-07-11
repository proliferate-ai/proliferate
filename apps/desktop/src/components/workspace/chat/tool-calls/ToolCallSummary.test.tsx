/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolCallSummary } from "./ToolCallSummary";

afterEach(cleanup);

describe("ToolCallSummary", () => {
  it("renders completed work as a left disclosure with one hairline below", () => {
    const { container } = render(
      <ToolCallSummary
        label="Worked for 13m 25s"
        summary="2 messages, 3 tool calls"
        showWorkDivider
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
    expect(ledger.parentElement?.className).toContain("mt-1");
    expect(ledger.parentElement?.className).not.toContain("mt-2");
    const completion = screen.getByText("Edited files");
    const divider = container.querySelector("[data-completed-work-divider]");
    expect(ledger.compareDocumentPosition(divider!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(completion.compareDocumentPosition(divider!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
