// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolCallSummary } from "./ToolCallSummary";

afterEach(() => {
  cleanup();
});

describe("ToolCallSummary", () => {
  it("keeps the final-response rule visible below a collapsed work disclosure", () => {
    const { container, getByRole } = render(
      <ToolCallSummary
        icon={null}
        label="Worked for 1m 5s"
        summary="2 messages, 3 tool calls"
        typeIcons={[]}
        showFinalSeparator
        renderChildren={() => <div>Completed work</div>}
      />,
    );

    const disclosure = getByRole("button", { name: /Worked for 1m 5s/ });
    const separator = getByRole("separator", { name: "Final message" });
    expect(disclosure.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    fireEvent.click(disclosure);
    expect(container.textContent).toContain("Completed work");
    expect(getByRole("separator", { name: "Final message" })).toBeTruthy();
  });
});
