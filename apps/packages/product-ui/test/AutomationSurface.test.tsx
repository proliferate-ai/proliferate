// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutomationRunsList } from "../src/automations/AutomationRunsList";
import { AutomationDetailSurface } from "../src/automations/AutomationDetailSurface";
import { AutomationSurface } from "../src/automations/AutomationSurface";
import type {
  AutomationCalendarDayView,
  AutomationInventoryGroupView,
  AutomationRunInventoryItemView,
} from "@proliferate/product-domain/automations/inventory";

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

    fireEvent.click(screen.getByRole("button", { name: "Run workflow now" }));
    expect(onRunNow).toHaveBeenCalledWith("auto-1");
  });

  it("keeps soft-disabled run actions visible and explains why", () => {
    const onRunNow = vi.fn();

    render(
      <AutomationSurface
        mode="list"
        groups={[
          {
            ...automationGroups()[0],
            items: [
              {
                ...automationGroups()[0].items[0],
                enabled: false,
                statusLabel: "Paused",
                runNowDisabledReason: "Resume before queueing a run.",
              },
            ],
          },
        ]}
        calendarDays={calendarDays()}
        includePaused={false}
        onModeChange={vi.fn()}
        onIncludePausedChange={vi.fn()}
        onNew={vi.fn()}
        onAutomationSelect={vi.fn()}
        onEdit={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onRunNow={onRunNow}
      />,
    );

    const runButton = screen.getByRole("button", {
      name: "Run workflow now: Resume before queueing a run.",
    });
    fireEvent.click(runButton);
    expect(onRunNow).not.toHaveBeenCalled();
  });

  it("hides create and row actions when callbacks are omitted", () => {
    render(
      <AutomationSurface
        mode="list"
        groups={automationGroups()}
        calendarDays={calendarDays()}
        includePaused={false}
        onModeChange={vi.fn()}
        onIncludePausedChange={vi.fn()}
        onAutomationSelect={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /New workflow/u })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run workflow now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Workflow actions" })).toBeNull();
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

  it("shows desktop-required run rows without making them look disabled", () => {
    render(
      <AutomationRunsList
        runs={[
          runItem({
            id: "run-local",
            title: "Dispatched",
            statusLabel: "Dispatched",
            openState: "desktop_required",
            openLabel: "Check this out on the desktop.",
            openDisabledReason: "Check this out on the desktop.",
          }),
        ]}
        onRunSelect={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Dispatched/u })).toBeNull();
    expect(screen.getAllByText("Dispatched").length).toBeGreaterThan(0);
    expect(screen.getByText(/Check this out on the desktop/u)).toBeTruthy();
  });

  it("includes transient opening state in the row label", () => {
    render(
      <AutomationRunsList
        runs={[
          runItem({
            id: "run-opening",
            title: "Session started",
            statusLabel: "Session started",
            openState: "opening",
          }),
        ]}
        onRunSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("listitem", { name: /Opening/u })).toBeTruthy();
  });
});

describe("AutomationDetailSurface", () => {
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

  it("renders a compact automation summary above run history", () => {
    render(
      <AutomationDetailSurface
        automation={automationGroups()[0].items[0]}
        runs={[]}
        summary={{
          prompt: "Check recent failures and open a concise fix plan.",
          configName: "Nightly Codex",
          agentLabel: "Codex",
          modelLabel: "gpt-5",
        }}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText("Prompt")).toBeTruthy();
    expect(screen.getByText("Check recent failures and open a concise fix plan.")).toBeTruthy();
    expect(screen.getByText("Nightly Codex")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("gpt-5")).toBeTruthy();
    expect(
      screen.getByText("Check recent failures and open a concise fix plan.")
        .compareDocumentPosition(screen.getByText("Run history"))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
          targetAvailability: "managed_cloud",
          statusKind: "waiting",
          statusLabel: "Enabled",
          enabled: true,
          runNowDisabledReason: null,
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
    openLabel: "Open workspace",
    openDisabledReason: null,
    ...overrides,
  };
}
