// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PlanEntry } from "@anyharness/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { TodoTrackerPanel, TodoTrackerStrip } from "./TodoTrackerPanel";

afterEach(() => {
  cleanup();
});

describe("TodoTrackerStrip", () => {
  it("summarizes progress with the in-flight task on one line", () => {
    const { container } = render(<TodoTrackerStrip entries={entries()} />);

    const strip = container.querySelector("[data-todo-tracker-strip]");
    expect(strip).toBeTruthy();
    expect(strip?.textContent).toContain("1/3");
    expect(strip?.textContent).toContain("Wire the strip");
    // Strip stays one line: no per-entry rows.
    expect(strip?.textContent).not.toContain("Ship it");
  });

  it("omits the current-task segment when nothing is in progress", () => {
    const { container } = render(
      <TodoTrackerStrip
        entries={entries().map((entry) =>
          entry.status === "in_progress" ? { ...entry, status: "pending" } : entry,
        )}
      />,
    );

    const strip = container.querySelector("[data-todo-tracker-strip]");
    expect(strip?.textContent).toContain("1/3");
    expect(strip?.textContent).not.toContain("Wire the strip");
  });
});

describe("TodoTrackerPanel", () => {
  it("renders the structured header with a transform-scaled progress fill", () => {
    const { container, getByText } = render(<TodoTrackerPanel entries={entries()} />);

    expect(getByText("Tasks")).toBeTruthy();
    expect(container.textContent).toContain("1 of 3 done");
    // Compositor-only progress: the fill scales, it never animates width.
    const fill = container.querySelector<HTMLElement>("[data-todo-progress]");
    expect(fill?.style.transform).toBe("scaleX(0.3333333333333333)");
  });

  it("renders one unnumbered row per entry with uniform status icons", () => {
    const { container } = render(<TodoTrackerPanel entries={entries()} />);

    const rows = container.querySelectorAll("[data-todo-status]");
    expect(rows).toHaveLength(3);
    // Numbered prefixes are gone — the state icons carry the grid line.
    expect(container.textContent).not.toContain("1.");
    // One 14px (size-3.5) status icon per row, all on the same grid.
    expect(container.querySelectorAll('[data-todo-status] [class*="size-3.5"]')).toHaveLength(3);
    // Completed rows strike through and fade.
    const completedRow = container.querySelector('[data-todo-status="completed"]');
    expect(completedRow?.textContent).toContain("Land the panel");
    expect(completedRow?.querySelector('[class*="line-through"]')).toBeTruthy();
  });

  it("collapses to just the header on header click, keeping progress visible", () => {
    const { container, getByText } = render(<TodoTrackerPanel entries={entries()} />);

    fireEvent.click(getByText("Tasks"));

    expect(container.textContent).not.toContain("Ship it");
    expect(container.textContent).toContain("1 of 3 done");
    expect(container.querySelector("[data-todo-progress]")).toBeTruthy();

    fireEvent.click(getByText("Tasks"));
    expect(container.textContent).toContain("Ship it");
  });
});

function entries(): PlanEntry[] {
  return [
    { content: "Land the panel", status: "completed" },
    { content: "Wire the strip", status: "in_progress" },
    { content: "Ship it", status: "pending" },
  ];
}
