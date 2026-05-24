// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutomationRunsList } from "../src/automations/AutomationRunsList";
import { AutomationSurface } from "../src/automations/AutomationSurface";
import type {
  AutomationCalendarDayView,
  AutomationInventoryGroupView,
  AutomationRunInventoryItemView,
} from "@proliferate/product-model/automations/inventory";

describe("AutomationSurface", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders list groups and emits row actions", () => {
    const onAutomationSelect = vi.fn();
    const onRunNow = vi.fn();

    render(
      <AutomationSurface
        mode="list"
        groups={automationGroups()}
        calendarDays={calendarDays()}
        includePaused={false}
        onModeChange={vi.fn()}
        onIncludePausedChange={vi.fn()}
        onNew={vi.fn()}
        onAutomationSelect={onAutomationSelect}
        onEdit={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onRunNow={onRunNow}
      />,
    );

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Nightly skill index")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Nightly skill index/u }));
    expect(onAutomationSelect).toHaveBeenCalledWith("auto-1");

    fireEvent.click(screen.getByRole("button", { name: "Run automation now" }));
    expect(onRunNow).toHaveBeenCalledWith("auto-1");
  });

  it("renders calendar days and scheduled occurrences", () => {
    const onModeChange = vi.fn();
    const onAutomationSelect = vi.fn();

    render(
      <AutomationSurface
        mode="calendar"
        groups={automationGroups()}
        calendarDays={calendarDays()}
        includePaused={false}
        onModeChange={onModeChange}
        onIncludePausedChange={vi.fn()}
        onNew={vi.fn()}
        onAutomationSelect={onAutomationSelect}
        onEdit={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onRunNow={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Calendar" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(onModeChange).toHaveBeenCalledWith("list");

    const monday = screen.getByRole("button", { name: /Mon/u });
    fireEvent.click(monday);
    expect(screen.getByText("Mon, May 25")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Nightly skill index, 9:00 AM/u }));
    expect(onAutomationSelect).toHaveBeenCalledWith("auto-1");
  });
});

describe("AutomationRunsList", () => {
  afterEach(cleanup);

  it("renders openable and non-openable runs without disabling rows", () => {
    const onRunSelect = vi.fn();

    render(
      <AutomationRunsList
        runs={[
          runItem({ id: "run-open", title: "Dispatched", statusLabel: "Dispatched", openState: "openable" }),
          runItem({ id: "run-pending", title: "Queued", openState: "none" }),
        ]}
        onRunSelect={onRunSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Dispatched/u }));
    expect(onRunSelect).toHaveBeenCalledWith("run-open");
    expect(screen.queryByRole("button", { name: /Queued/u })).toBeNull();
    expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
  });
});

function automationGroups(): AutomationInventoryGroupView[] {
  return [
    {
      id: "active",
      label: "Active",
      count: 1,
      items: [
        {
          id: "auto-1",
          title: "Nightly skill index",
          repoLabel: "proliferate-ai/proliferate",
          scheduleLabel: "Daily at 9:00 AM",
          nextRunLabel: "tomorrow at 9:00 AM",
          scopeLabel: "Personal",
          targetLabel: "Personal cloud",
          statusKind: "waiting",
          statusLabel: "Enabled",
          enabled: true,
          updatedAt: "2026-05-23T00:00:00Z",
          searchText: "Nightly skill index",
        },
      ],
    },
  ];
}

function calendarDays(): AutomationCalendarDayView[] {
  return [
    {
      id: "2026-05-23",
      date: "2026-05-23",
      weekdayLabel: "Sat",
      dayNumberLabel: "23",
      sectionLabel: "Today",
      isToday: true,
      hasOccurrences: false,
      occurrences: [],
    },
    {
      id: "2026-05-25",
      date: "2026-05-25",
      weekdayLabel: "Mon",
      dayNumberLabel: "25",
      sectionLabel: "Mon, May 25",
      isToday: false,
      hasOccurrences: true,
      occurrences: [
        {
          id: "auto-1:occurrence",
          automationId: "auto-1",
          title: "Nightly skill index",
          timeLabel: "9:00 AM",
          scopeLabel: "Personal",
          targetLabel: "Personal cloud",
          scheduleLabel: "Daily at 9:00 AM",
          statusKind: "waiting",
          statusLabel: "Enabled",
        },
      ],
    },
  ];
}

function runItem(
  overrides: Partial<AutomationRunInventoryItemView> = {},
): AutomationRunInventoryItemView {
  return {
    id: "run",
    title: "Queued",
    statusKind: "waiting",
    statusLabel: "Queued",
    timestampLabel: "Scheduled May 23, 2026, 9:00 AM",
    triggerLabel: "Scheduled",
    targetLabel: "Personal cloud",
    errorLabel: null,
    openState: "none",
    ...overrides,
  };
}
