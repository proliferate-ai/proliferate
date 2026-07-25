// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "../src/primitives/Button";
import { Tooltip } from "../src/primitives/Tooltip";

afterEach(cleanup);

describe("Tooltip", () => {
  it("renders multiline content with a title and quieter detail lines", () => {
    render(
      <Tooltip content={"Reasoning: Medium\nClick to cycle.\nSaving…"}>
        <Button>Reasoning</Button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "Reasoning" }).parentElement;
    expect(trigger).toBeTruthy();
    fireEvent.focus(trigger!);

    const tooltip = screen.getByRole("tooltip");
    const lines = tooltip.querySelectorAll("span");
    expect(lines).toHaveLength(3);
    expect(lines[0]?.textContent).toBe("Reasoning: Medium");
    expect(lines[0]?.className).toContain("font-medium");
    expect(lines[1]?.className).toContain("text-muted-foreground");
    expect(lines[2]?.textContent).toBe("Saving…");
  });

  it("keeps ordinary one-line tooltips compact", () => {
    render(
      <Tooltip content="Add file">
        <Button>Add</Button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "Add" }).parentElement;
    expect(trigger).toBeTruthy();
    fireEvent.focus(trigger!);

    const tooltipContent = document.querySelector('[data-slot="tooltip-content"]');
    expect(tooltipContent).toBeTruthy();
    expect(tooltipContent!.className).toContain("rounded-lg");
    expect(tooltipContent!.className).not.toContain("py-2.5");
  });
});
