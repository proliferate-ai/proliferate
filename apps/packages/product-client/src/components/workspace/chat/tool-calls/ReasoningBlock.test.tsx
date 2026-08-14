// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReasoningBlock } from "#product/components/workspace/chat/tool-calls/ReasoningBlock";

describe("ReasoningBlock", () => {
  afterEach(() => {
    cleanup();
  });

  // PRO-153 follow-on: reasoning content is natural-language prose and must
  // render in the sans stack, not the mono/code treatment.
  it("renders expanded reasoning content as prose, not mono", () => {
    // The first line doubles as the collapsed row's hint; matching on the
    // second line isolates the expanded body.
    render(<ReasoningBlock content={"Considering the layout options.\nWeighing the trade-offs."} />);

    fireEvent.click(screen.getByRole("button"));

    const body = screen.getByText(/Weighing the trade-offs\./);
    const classes = body.className.split(" ");
    expect(classes).not.toContain("font-mono");
    expect(classes).toContain("text-chat");
  });
});
