import type {
  AutomationCalendarDayView,
  AutomationCalendarOccurrenceView,
  AutomationInventoryRecord,
  BuildAutomationCalendarWeekOptions,
} from "./inventory";
import {
  addLocalDays,
  DAY_MS,
  formatTimeOnly,
  localDateId,
  normalizeDate,
  startOfLocalDay,
  zonedDateTimeToDate,
} from "./inventory-dates";
import {
  dailyRuleMatches,
  hourlyIntervalMatches,
  parseRrule,
  type ParsedRrule,
} from "./inventory-rrule";
import { automationTargetLabel } from "./inventory-targets";

const MAX_HOURLY_OCCURRENCES_PER_DAY = 4;

export function buildAutomationCalendarWeekView(
  automations: readonly AutomationInventoryRecord[],
  options: BuildAutomationCalendarWeekOptions = {},
): AutomationCalendarDayView[] {
  const now = normalizeDate(options.now);
  const anchor = startOfLocalDay(normalizeDate(options.anchorDate ?? now));
  const includePaused = options.includePaused ?? false;
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addLocalDays(anchor, index);
    return calendarDayShell(date, anchor);
  });

  for (const automation of automations) {
    if (!automation.enabled && !includePaused) {
      continue;
    }
    addAutomationOccurrences(days, automation, now);
  }

  return days.map((day) => ({
    ...day,
    hasOccurrences: day.occurrences.length > 0,
    occurrences: [...day.occurrences].sort(compareCalendarOccurrences),
  }));
}

function addAutomationOccurrences(
  days: AutomationCalendarDayView[],
  automation: AutomationInventoryRecord,
  now: Date,
) {
  const parsed = parseRrule(automation.schedule.rrule);
  const occurrenceGroups = parsed
    ? occurrencesForParsedRule(days, automation, parsed, now)
    : occurrencesFromNextRun(days, automation, now);

  for (const [dayId, occurrences] of occurrenceGroups) {
    const day = days.find((candidate) => candidate.id === dayId);
    if (!day) {
      continue;
    }
    day.occurrences.push(...occurrences);
  }
}

function occurrencesForParsedRule(
  days: AutomationCalendarDayView[],
  automation: AutomationInventoryRecord,
  parsed: ParsedRrule,
  now: Date,
): Map<string, AutomationCalendarOccurrenceView[]> {
  if (parsed.freq === "HOURLY") {
    return hourlyOccurrences(days, automation, parsed, now);
  }
  if (parsed.freq === "DAILY") {
    return dailyOccurrences(days, automation, parsed, now);
  }
  return occurrencesFromNextRun(days, automation, now);
}

function dailyOccurrences(
  days: AutomationCalendarDayView[],
  automation: AutomationInventoryRecord,
  parsed: ParsedRrule,
  now: Date,
): Map<string, AutomationCalendarOccurrenceView[]> {
  const byHours = parsed.byHour ?? [0];
  const byMinutes = parsed.byMinute ?? [0];
  const result = new Map<string, AutomationCalendarOccurrenceView[]>();
  const dayIds = new Set(days.map((day) => day.id));
  for (const dateId of expandedCalendarDateIds(days)) {
    for (const hour of byHours) {
      for (const minute of byMinutes) {
        const occurrenceDate = zonedDateTimeToDate({
          date: dateId,
          hour,
          minute,
          timeZone: automation.schedule.timezone ?? undefined,
        });
        if (occurrenceDate.getTime() < now.getTime()) {
          continue;
        }
        if (!dailyRuleMatches(occurrenceDate, parsed, automation.schedule.timezone)) {
          continue;
        }
        const targetDayId = localDateId(occurrenceDate);
        if (dayIds.has(targetDayId)) {
          result.set(targetDayId, [
            ...(result.get(targetDayId) ?? []),
            calendarOccurrence(automation, occurrenceDate),
          ]);
        }
      }
    }
  }
  return result;
}

function hourlyOccurrences(
  days: AutomationCalendarDayView[],
  automation: AutomationInventoryRecord,
  parsed: ParsedRrule,
  now: Date,
): Map<string, AutomationCalendarOccurrenceView[]> {
  const byMinutes = parsed.byMinute ?? [0];
  const interval = Math.max(parsed.interval, 1);
  const rawByDay = new Map<string, AutomationCalendarOccurrenceView[]>();
  const dayIds = new Set(days.map((day) => day.id));
  for (const dateId of expandedCalendarDateIds(days)) {
    for (let hour = 0; hour < 24; hour += 1) {
      for (const minute of byMinutes) {
        const occurrenceDate = zonedDateTimeToDate({
          date: dateId,
          hour,
          minute,
          timeZone: automation.schedule.timezone ?? undefined,
        });
        if (occurrenceDate.getTime() < now.getTime()) {
          continue;
        }
        if (!hourlyIntervalMatches(occurrenceDate, interval, automation.schedule.timezone)) {
          continue;
        }
        const targetDayId = localDateId(occurrenceDate);
        if (dayIds.has(targetDayId)) {
          rawByDay.set(targetDayId, [
            ...(rawByDay.get(targetDayId) ?? []),
            calendarOccurrence(automation, occurrenceDate),
          ]);
        }
      }
    }
  }

  const result = new Map<string, AutomationCalendarOccurrenceView[]>();
  for (const [dayId, occurrences] of rawByDay) {
    const sorted = [...occurrences].sort(compareCalendarOccurrences);
    const visible = sorted.slice(0, MAX_HOURLY_OCCURRENCES_PER_DAY);
    const overflowCount = Math.max(0, sorted.length - MAX_HOURLY_OCCURRENCES_PER_DAY);
    if (overflowCount > 0) {
      const overflowDate = new Date(`${dayId}T23:59:00`);
      visible.push({
        ...calendarOccurrence(automation, overflowDate),
        id: `${automation.id}:${dayId}:overflow`,
        title: `+${overflowCount} more`,
        timeLabel: "",
        overflowCount,
        sortTimeMs: overflowDate.getTime(),
      });
    }
    if (visible.length > 0) {
      result.set(dayId, visible);
    }
  }
  return result;
}

function occurrencesFromNextRun(
  days: AutomationCalendarDayView[],
  automation: AutomationInventoryRecord,
  now: Date,
): Map<string, AutomationCalendarOccurrenceView[]> {
  const nextRunAt = automation.schedule.nextRunAt;
  if (!nextRunAt) {
    return new Map();
  }
  const date = new Date(nextRunAt);
  if (Number.isNaN(date.getTime()) || date.getTime() < now.getTime()) {
    return new Map();
  }
  const day = days.find((candidate) => isDateInCalendarDay(date, candidate.date));
  if (!day) {
    return new Map();
  }
  return new Map([[day.id, [calendarOccurrence(automation, date)]]]);
}

function calendarOccurrence(
  automation: AutomationInventoryRecord,
  date: Date,
): AutomationCalendarOccurrenceView {
  return {
    id: `${automation.id}:${date.toISOString()}`,
    automationId: automation.id,
    title: automation.title,
    timeLabel: formatTimeOnly(date, automation.schedule.timezone),
    scopeLabel: automation.ownerScope === "organization" ? "Team" : "Personal",
    targetLabel: automationTargetLabel(
      automation.targetMode,
      automation.executionTarget,
      automation.targetKind,
    ),
    scheduleLabel: automation.schedule.summary,
    statusKind: "waiting",
    statusLabel: automation.enabled ? "Enabled" : "Paused",
    sortTimeMs: date.getTime(),
  };
}

function calendarDayShell(date: Date, anchor: Date): AutomationCalendarDayView {
  const dayDelta = Math.round((startOfLocalDay(date).getTime() - anchor.getTime()) / DAY_MS);
  const dateId = localDateId(date);
  return {
    id: dateId,
    date: dateId,
    weekdayLabel: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
    dayNumberLabel: new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(date),
    sectionLabel: dayDelta === 0
      ? "Today"
      : dayDelta === 1
        ? "Tomorrow"
        : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date),
    isToday: dayDelta === 0,
    hasOccurrences: false,
    occurrences: [],
  };
}

function isDateInCalendarDay(date: Date, calendarDay: string): boolean {
  return localDateId(date) === calendarDay;
}

function expandedCalendarDateIds(days: readonly AutomationCalendarDayView[]): string[] {
  const first = days[0];
  if (!first) {
    return [];
  }
  const start = new Date(`${first.date}T00:00:00`);
  return Array.from({ length: days.length + 2 }, (_, index) =>
    localDateId(addLocalDays(start, index - 1))
  );
}

function compareCalendarOccurrences(
  left: AutomationCalendarOccurrenceView,
  right: AutomationCalendarOccurrenceView,
): number {
  const timeDelta = (left.sortTimeMs ?? 0) - (right.sortTimeMs ?? 0);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return left.title.localeCompare(right.title);
}
