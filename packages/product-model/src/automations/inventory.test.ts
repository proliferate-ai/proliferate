import { describe, expect, it } from "vitest";
import {
  buildAutomationCalendarWeek,
  buildAutomationInventoryItems,
  buildAutomationRunInventoryItems,
  groupAutomationInventoryItems,
  type AutomationInventoryRecord,
  type AutomationRunInventoryRecord,
} from "./inventory";

const NOW = new Date(2026, 4, 23, 12, 0, 0, 0);
const ANCHOR = new Date(2026, 4, 23, 0, 0, 0, 0);

function iso(year: number, monthIndex: number, day: number, hour: number, minute = 0): string {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).toISOString();
}

function localDateId(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function automation(
  overrides: Partial<AutomationInventoryRecord> = {},
): AutomationInventoryRecord {
  return {
    id: "auto-1",
    gitOwner: "proliferate-ai",
    gitRepoName: "proliferate",
    title: "Daily briefing",
    schedule: {
      rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
      summary: "Daily at 9:00 AM",
      nextRunAt: iso(2026, 4, 24, 9),
      timezone: undefined,
    },
    ownerScope: "personal",
    targetMode: "personal_cloud",
    enabled: true,
    updatedAt: "2026-05-20T00:00:00Z",
    ...overrides,
  };
}

function run(
  status: AutomationRunInventoryRecord["status"],
  overrides: Partial<AutomationRunInventoryRecord> = {},
): AutomationRunInventoryRecord {
  return {
    id: `run-${status}`,
    triggerKind: "scheduled",
    scheduledFor: "2026-05-23T12:00:00Z",
    targetMode: "personal_cloud",
    status,
    titleSnapshot: "Daily briefing",
    cloudWorkspaceId: null,
    anyharnessWorkspaceId: null,
    lastErrorMessage: null,
    createdAt: "2026-05-23T12:00:00Z",
    updatedAt: "2026-05-23T12:00:00Z",
    ...overrides,
  };
}

describe("automation inventory", () => {
  it("groups active and paused automations", () => {
    const items = buildAutomationInventoryItems([
      automation({ id: "active", title: "Active" }),
      automation({ id: "paused", title: "Paused", enabled: false }),
    ], { now: NOW });

    expect(groupAutomationInventoryItems(items)).toMatchObject([
      { id: "active", count: 1, items: [{ id: "active", statusLabel: "Enabled" }] },
      { id: "paused", count: 1, items: [{ id: "paused", statusLabel: "Paused" }] },
    ]);
  });

  it("preserves source ordering within inventory groups", () => {
    const items = buildAutomationInventoryItems([
      automation({ id: "recent", title: "Z recent" }),
      automation({ id: "older", title: "A older" }),
      automation({ id: "paused", title: "Paused", enabled: false }),
    ], { now: NOW });

    expect(groupAutomationInventoryItems(items).map((group) => ({
      id: group.id,
      itemIds: group.items.map((item) => item.id),
    }))).toEqual([
      { id: "active", itemIds: ["recent", "older"] },
      { id: "paused", itemIds: ["paused"] },
    ]);
  });

  it("marks non-managed targets as desktop-required on web", () => {
    const [local] = buildAutomationInventoryItems([
      automation({ targetMode: "local" }),
    ], { clientSurface: "web", now: NOW });
    const [ssh] = buildAutomationInventoryItems([
      automation({ executionTarget: "ssh", targetKind: "ssh" }),
    ], { clientSurface: "web", now: NOW });
    const [desktopLocal] = buildAutomationInventoryItems([
      automation({ targetMode: "local" }),
    ], { clientSurface: "desktop", now: NOW });

    expect(local).toMatchObject({
      targetAvailability: "desktop_required",
      runNowDisabledReason: "Check this out on the desktop.",
    });
    expect(ssh).toMatchObject({
      targetLabel: "SSH target",
      targetAvailability: "desktop_required",
      runNowDisabledReason: "Check this out on the desktop.",
    });
    expect(desktopLocal).toMatchObject({
      targetAvailability: "desktop_required",
      runNowDisabledReason: null,
    });
  });

  it("builds a seven day daily calendar", () => {
    const week = buildAutomationCalendarWeek([
      automation(),
    ], {
      anchorDate: ANCHOR,
      now: NOW,
    });

    expect(week).toHaveLength(7);
    expect(week[0]).toMatchObject({ sectionLabel: "Today", isToday: true });
    expect(week[1].occurrences).toMatchObject([
      { automationId: "auto-1", title: "Daily briefing" },
    ]);
  });

  it("builds distinct local calendar days across daylight saving changes", () => {
    const week = buildAutomationCalendarWeek([], {
      anchorDate: new Date(2026, 9, 31, 12, 0, 0, 0),
      now: new Date(2026, 9, 31, 12, 0, 0, 0),
    });

    expect(week.map((day) => day.id)).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
  });

  it("respects weekday and weekend schedules", () => {
    const week = buildAutomationCalendarWeek([
      automation({
        id: "weekdays",
        title: "Weekdays",
        schedule: {
          rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
          summary: "Weekdays at 9:00 AM",
          nextRunAt: iso(2026, 4, 25, 9),
          timezone: undefined,
        },
      }),
      automation({
        id: "weekends",
        title: "Weekends",
        schedule: {
          rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=SA,SU;BYHOUR=10;BYMINUTE=0",
          summary: "Weekends at 10:00 AM",
          nextRunAt: iso(2026, 4, 24, 10),
          timezone: undefined,
        },
      }),
    ], {
      anchorDate: ANCHOR,
      now: NOW,
    });

    expect(week[0].occurrences.map((item) => item.automationId)).toEqual([]);
    expect(week[1].occurrences.map((item) => item.automationId)).toEqual(["weekends"]);
    expect(week[2].occurrences.map((item) => item.automationId)).toEqual(["weekdays"]);
  });

  it("supports accepted daily interval and multiple time variants", () => {
    const week = buildAutomationCalendarWeek([
      automation({
        id: "multi",
        title: "Morning and afternoon",
        schedule: {
          rrule: "RRULE:FREQ=DAILY;INTERVAL=3;BYHOUR=9,17;BYMINUTE=0",
          summary: "Every 3 days at 9:00 AM and 5:00 PM",
          nextRunAt: iso(2026, 4, 23, 17),
          timezone: undefined,
        },
      }),
    ], {
      anchorDate: ANCHOR,
      now: NOW,
    });

    expect(week.flatMap((day) => day.occurrences.map((item) => (
      `${day.id}:${new Date(item.sortTimeMs ?? 0).getHours()}`
    )))).toEqual([
      "2026-05-23:17",
      "2026-05-26:9",
      "2026-05-26:17",
      "2026-05-29:9",
      "2026-05-29:17",
    ]);
  });

  it("keeps timezone-crossing occurrences in the local visible week", () => {
    const week = buildAutomationCalendarWeek([
      automation({
        id: "tokyo",
        title: "Tokyo briefing",
        schedule: {
          rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
          summary: "Daily at 9:00 AM in Asia/Tokyo",
          nextRunAt: "2026-05-24T00:00:00.000Z",
          timezone: "Asia/Tokyo",
        },
      }),
    ], {
      anchorDate: ANCHOR,
      now: NOW,
    });

    const expectedLocalDay = localDateId(new Date("2026-05-24T00:00:00.000Z"));
    expect(week.find((day) => day.id === expectedLocalDay)?.occurrences).toMatchObject([
      { automationId: "tokyo" },
    ]);
  });

  it("limits hourly schedules and adds overflow", () => {
    const week = buildAutomationCalendarWeek([
      automation({
        schedule: {
          rrule: "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
          summary: "Hourly",
          nextRunAt: iso(2026, 4, 23, 13),
          timezone: undefined,
        },
      }),
    ], {
      anchorDate: ANCHOR,
      now: NOW,
    });

    expect(week[0].occurrences).toHaveLength(5);
    expect(week[0].occurrences[4]).toMatchObject({ title: "+8 more", overflowCount: 8 });
  });

  it("hides paused calendar items unless requested", () => {
    const paused = automation({ enabled: false });
    expect(buildAutomationCalendarWeek([paused], { now: NOW })[1].occurrences).toHaveLength(0);
    expect(buildAutomationCalendarWeek([paused], { now: NOW, includePaused: true })[1].occurrences).toHaveLength(1);
  });

  it("falls back to nextRunAt for unsupported custom schedules", () => {
    const week = buildAutomationCalendarWeek([
      automation({
        schedule: {
          rrule: "RRULE:FREQ=WEEKLY;INTERVAL=1",
          summary: "Custom",
          nextRunAt: iso(2026, 4, 24, 9),
          timezone: undefined,
        },
      }),
    ], {
      anchorDate: ANCHOR,
      now: NOW,
    });

    expect(week[1].occurrences).toMatchObject([{ automationId: "auto-1" }]);
  });

  it("uses target kind when labeling calendar occurrences", () => {
    const week = buildAutomationCalendarWeek([
      automation({
        targetMode: "personal_cloud",
        targetKind: "ssh",
      }),
    ], {
      anchorDate: ANCHOR,
      now: NOW,
    });

    expect(week[1].occurrences).toMatchObject([
      { targetLabel: "SSH target" },
    ]);
  });

  it("maps run statuses", () => {
    const items = buildAutomationRunInventoryItems([
      run("queued"),
      run("creating_workspace"),
      run("dispatching"),
      run("dispatched", { cloudWorkspaceId: "cw-1" }),
      run("dispatched", { id: "run-ssh", anyharnessWorkspaceId: "aw-1", cloudTargetKindSnapshot: "ssh" }),
      run("failed", { lastErrorMessage: "Boom" }),
      run("cancelled"),
    ]);

    expect(items.map((item) => [item.statusLabel, item.statusKind, item.openState, item.targetLabel])).toEqual([
      ["Queued", "waiting", "none", "Personal cloud"],
      ["Creating cloud workspace", "working", "none", "Personal cloud"],
      ["Sending prompt", "working", "none", "Personal cloud"],
      ["Session started", "done", "openable", "Personal cloud"],
      ["Session started", "done", "openable", "SSH target"],
      ["Failed", "blocked", "none", "Personal cloud"],
      ["Cancelled", "done", "none", "Personal cloud"],
    ]);
  });

  it("preserves local automation run status copy", () => {
    const items = buildAutomationRunInventoryItems([
      run("queued", { id: "queued-local-mode", targetMode: "local" }),
      run("creating_workspace", { id: "creating-local-mode", targetMode: "local" }),
      run("provisioning_workspace", {
        id: "provisioning-local-execution",
        executionTarget: "local",
      }),
    ]);

    expect(items.map((item) => [item.id, item.statusLabel])).toEqual([
      ["queued-local-mode", "Queued, local executor not available yet"],
      ["creating-local-mode", "Creating local worktree"],
      ["provisioning-local-execution", "Preparing worktree"],
    ]);
  });

  it("keeps local and ssh runs visible but desktop-required on web", () => {
    const items = buildAutomationRunInventoryItems([
      run("dispatched", {
        id: "run-local",
        targetMode: "local",
        anyharnessWorkspaceId: "aw-local",
      }),
      run("dispatched", {
        id: "run-ssh",
        targetMode: "personal_cloud",
        anyharnessWorkspaceId: "aw-ssh",
        cloudTargetKindSnapshot: "ssh",
      }),
      run("dispatched", {
        id: "run-cloud",
        cloudWorkspaceId: "cw-1",
      }),
    ], { clientSurface: "web" });

    expect(items.map((item) => [
      item.id,
      item.openState,
      item.openDisabledReason,
      item.targetLabel,
    ])).toEqual([
      ["run-local", "desktop_required", "Check this out on the desktop.", "Local"],
      ["run-ssh", "desktop_required", "Check this out on the desktop.", "SSH target"],
      ["run-cloud", "openable", null, "Personal cloud"],
    ]);
  });

  it("does not replace run status with desktop-required before a desktop workspace exists", () => {
    const items = buildAutomationRunInventoryItems([
      run("queued", {
        id: "run-local-queued",
        targetMode: "local",
      }),
      run("failed", {
        id: "run-ssh-failed",
        targetMode: "personal_cloud",
        cloudTargetKindSnapshot: "ssh",
        lastErrorMessage: "Could not create workspace",
      }),
    ], { clientSurface: "web" });

    expect(items.map((item) => [
      item.id,
      item.statusLabel,
      item.openState,
      item.openDisabledReason,
    ])).toEqual([
      ["run-local-queued", "Queued, local executor not available yet", "none", null],
      ["run-ssh-failed", "Failed", "none", null],
    ]);
  });
});
