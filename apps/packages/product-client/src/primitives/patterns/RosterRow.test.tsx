// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RosterRow } from "./RosterRow";

afterEach(cleanup);

function rowOf(text: string): HTMLElement {
  const element = screen.getByText(text).closest("[data-selected]");
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no roster row around ${text}`);
  }
  return element;
}

describe("RosterRow", () => {
  it("owns the whole interaction-state stack on an interactive row", () => {
    render(<RosterRow title="Run 12" onSelect={() => {}} />);
    const className = rowOf("Run 12").className;
    expect(className).toContain("hover:bg-hover");
    expect(className).toContain("active:bg-active");
    expect(className).toContain("focus-visible:ring-ring");
  });

  it("paints selection instead of hover so a committed selection reads stronger", () => {
    render(<RosterRow title="Run 12" selected onSelect={() => {}} />);
    const className = rowOf("Run 12").className;
    expect(className).toContain("bg-selected");
    expect(className).toContain("active:bg-active");
    expect(className).not.toContain("hover:bg-hover");
  });

  it("paints no interaction states and takes no button role without onSelect", () => {
    render(<RosterRow title="Run 12" />);
    const row = rowOf("Run 12");
    expect(row.getAttribute("role")).toBeNull();
    expect(row.className).not.toContain("hover:bg-hover");
  });

  it("activates from the keyboard, and not at all when disabled", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<RosterRow title="Run 12" onSelect={onSelect} />);
    fireEvent.keyDown(rowOf("Run 12"), { key: "Enter" });
    fireEvent.click(rowOf("Run 12"));
    expect(onSelect).toHaveBeenCalledTimes(2);

    rerender(<RosterRow title="Run 12" disabled onSelect={onSelect} />);
    fireEvent.click(rowOf("Run 12"));
    fireEvent.keyDown(rowOf("Run 12"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(rowOf("Run 12").getAttribute("aria-disabled")).toBe("true");
  });

  it("runs a caller's own onClick/onKeyDown instead of swallowing them", () => {
    const onSelect = vi.fn();
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <RosterRow title="Run 12" onSelect={onSelect} onClick={onClick} onKeyDown={onKeyDown} />,
    );

    fireEvent.click(rowOf("Run 12"));
    fireEvent.keyDown(rowOf("Run 12"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("keeps a read-only row out of the button role even when disabled", () => {
    render(<RosterRow title="Run 12" disabled />);
    expect(rowOf("Run 12").getAttribute("role")).toBeNull();
  });

  it("is a hover group so RowActionIconButton's reveal contract resolves", () => {
    render(<RosterRow title="Run 12" actions={<span>action</span>} onSelect={() => {}} />);
    expect(rowOf("Run 12").className.split(" ")).toContain("group");
  });
});
