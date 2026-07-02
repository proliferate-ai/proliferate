// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
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
    expect(strip?.textContent).toContain("1/3 tasks");
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
    expect(strip?.textContent).toContain("1/3 tasks");
    expect(strip?.textContent).not.toContain("Wire the strip");
  });
});

describe("TodoTrackerPanel", () => {
  it("renders every entry with uniform 12px status icons", () => {
    const { container } = render(<TodoTrackerPanel entries={entries()} />);

    expect(container.textContent).toContain("1 out of 3 tasks completed");
    expect(container.textContent).toContain("Ship it");
    // One status icon per entry (spinner/check/circle), all on the same
    // 12px (size-3) grid.
    expect(container.querySelectorAll('[class*="size-3 "]')).toHaveLength(3);
  });
});

function entries(): PlanEntry[] {
  return [
    { content: "Land the panel", status: "completed" },
    { content: "Wire the strip", status: "in_progress" },
    { content: "Ship it", status: "pending" },
  ];
}
