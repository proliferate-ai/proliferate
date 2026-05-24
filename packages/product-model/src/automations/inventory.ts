export type AutomationSurfaceViewMode = "list" | "calendar";

export type AutomationInventoryStatusKind =
  | "waiting"
  | "working"
  | "review"
  | "blocked"
  | "done";

export type AutomationTargetMode =
  | "local"
  | "personal_cloud"
  | "shared_cloud"
  | string;

export interface AutomationInventorySchedule {
  rrule?: string | null;
  summary: string;
  nextRunAt: string | null;
  timezone?: string | null;
}

export interface AutomationInventoryRecord {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  title: string;
  schedule: AutomationInventorySchedule;
  ownerScope?: "personal" | "organization" | string | null;
  targetMode?: AutomationTargetMode | null;
  executionTarget?: string | null;
  enabled: boolean;
  updatedAt?: string | null;
}

export interface AutomationInventoryItemView {
  id: string;
  title: string;
  repoLabel: string;
  scheduleLabel: string;
  nextRunLabel: string;
  scopeLabel: string;
  targetLabel: string;
  statusKind: AutomationInventoryStatusKind;
  statusLabel: string;
  enabled: boolean;
  updatedAt: string | null;
  searchText: string;
}

export interface AutomationInventoryGroupView {
  id: "active" | "paused";
  label: string;
  count: number;
  items: AutomationInventoryItemView[];
}

export interface AutomationCalendarOccurrenceView {
  id: string;
  automationId: string;
  title: string;
  timeLabel: string;
  scopeLabel: string;
  targetLabel: string;
  scheduleLabel: string;
  statusKind: AutomationInventoryStatusKind;
  statusLabel: string;
  overflowCount?: number;
  sortTimeMs?: number;
}

export interface AutomationCalendarDayView {
  id: string;
  date: string;
  weekdayLabel: string;
  dayNumberLabel: string;
  sectionLabel: string;
  isToday: boolean;
  hasOccurrences: boolean;
  occurrences: AutomationCalendarOccurrenceView[];
}

export interface AutomationRunInventoryRecord {
  id: string;
  triggerKind: "scheduled" | "manual" | string;
  scheduledFor: string | null;
  targetMode?: AutomationTargetMode | null;
  executionTarget?: string | null;
  status:
    | "queued"
    | "claimed"
    | "creating_workspace"
    | "provisioning_workspace"
    | "creating_session"
    | "dispatching"
    | "dispatched"
    | "failed"
    | "cancelled"
    | string;
  titleSnapshot?: string | null;
  cloudWorkspaceId?: string | null;
  anyharnessWorkspaceId?: string | null;
  cloudTargetKindSnapshot?: string | null;
  targetKindSnapshot?: string | null;
  lastErrorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunOpenState = "none" | "openable" | "opening";

export interface AutomationRunInventoryItemView {
  id: string;
  title: string;
  statusKind: AutomationInventoryStatusKind;
  statusLabel: string;
  timestampLabel: string;
  triggerLabel: string;
  targetLabel: string;
  errorLabel: string | null;
  openState: AutomationRunOpenState;
}

export interface BuildAutomationInventoryOptions {
  now?: Date | number;
}

export interface BuildAutomationCalendarWeekOptions extends BuildAutomationInventoryOptions {
  anchorDate?: Date | number;
  includePaused?: boolean;
}

export interface BuildAutomationRunInventoryOptions {
  pendingCloudWorkspaceId?: string | null;
}

interface ParsedRrule {
  freq: string;
  interval: number;
  byDay: string[] | null;
  byHour: number[] | null;
  byMinute: number[] | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURLY_OCCURRENCES_PER_DAY = 4;
const WEEKDAY_VALUES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export function buildAutomationInventoryItems(
  automations: readonly AutomationInventoryRecord[],
  options: BuildAutomationInventoryOptions = {},
): AutomationInventoryItemView[] {
  const now = normalizeDate(options.now);
  return automations.map((automation) => automationInventoryItem(automation, now));
}

export function groupAutomationInventoryItems(
  items: readonly AutomationInventoryItemView[],
): AutomationInventoryGroupView[] {
  const active = items.filter((item) => item.enabled);
  const paused = items.filter((item) => !item.enabled);
  const groups: AutomationInventoryGroupView[] = [
    { id: "active", label: "Active", count: active.length, items: active },
    { id: "paused", label: "Paused", count: paused.length, items: paused },
  ];
  return groups.filter((group) => group.items.length > 0);
}

export function buildAutomationCalendarWeek(
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

export function buildAutomationRunInventoryItems(
  runs: readonly AutomationRunInventoryRecord[],
  options: BuildAutomationRunInventoryOptions = {},
): AutomationRunInventoryItemView[] {
  return runs.map((run) => {
    const openable = Boolean(run.cloudWorkspaceId || run.anyharnessWorkspaceId);
    const opening = Boolean(
      run.cloudWorkspaceId
      && options.pendingCloudWorkspaceId
      && run.cloudWorkspaceId === options.pendingCloudWorkspaceId,
    );
    return {
      id: run.id,
      title: automationRunTitle(run),
      statusKind: automationRunStatusKind(run.status),
      statusLabel: automationRunStatusLabel(run),
      timestampLabel: automationRunTimestampLabel(run),
      triggerLabel: run.triggerKind === "manual" ? "Manual" : "Scheduled",
      targetLabel: automationTargetLabel(
        run.targetMode,
        run.executionTarget,
        run.targetKindSnapshot ?? run.cloudTargetKindSnapshot,
      ),
      errorLabel: run.status === "failed" ? run.lastErrorMessage ?? null : null,
      openState: opening ? "opening" : openable ? "openable" : "none",
    };
  });
}

function automationInventoryItem(
  automation: AutomationInventoryRecord,
  now: Date,
): AutomationInventoryItemView {
  const repoLabel = `${automation.gitOwner}/${automation.gitRepoName}`;
  const scopeLabel = automation.ownerScope === "organization" ? "Team" : "Personal";
  const targetLabel = automationTargetLabel(automation.targetMode, automation.executionTarget);
  const nextRunLabel = automation.enabled
    ? formatNextRunLabel(automation.schedule.nextRunAt, automation.schedule.timezone, now)
    : "Paused";
  const statusLabel = automation.enabled ? "Enabled" : "Paused";
  return {
    id: automation.id,
    title: automation.title,
    repoLabel,
    scheduleLabel: automation.schedule.summary,
    nextRunLabel,
    scopeLabel,
    targetLabel,
    statusKind: "waiting",
    statusLabel,
    enabled: automation.enabled,
    updatedAt: automation.updatedAt ?? null,
    searchText: [
      automation.title,
      repoLabel,
      automation.schedule.summary,
      nextRunLabel,
      scopeLabel,
      targetLabel,
      statusLabel,
    ].join(" "),
  };
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
      visible.push({
        ...calendarOccurrence(automation, new Date(`${dayId}T23:59:00`)),
        id: `${automation.id}:${dayId}:overflow`,
        title: `+${overflowCount} more`,
        timeLabel: "",
        overflowCount,
        sortTimeMs: new Date(`${dayId}T23:59:00`).getTime(),
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
    targetLabel: automationTargetLabel(automation.targetMode, automation.executionTarget),
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

function automationRunTitle(run: AutomationRunInventoryRecord): string {
  if (run.status === "failed" && run.lastErrorMessage) {
    return compactMessage(run.lastErrorMessage);
  }
  return automationRunStatusLabel(run);
}

function automationRunStatusKind(status: string): AutomationInventoryStatusKind {
  switch (status) {
    case "queued":
    case "claimed":
      return "waiting";
    case "creating_workspace":
    case "provisioning_workspace":
    case "creating_session":
    case "dispatching":
      return "working";
    case "failed":
      return "blocked";
    case "dispatched":
    case "cancelled":
      return "done";
    default:
      return "waiting";
  }
}

function automationRunStatusLabel(run: AutomationRunInventoryRecord): string {
  switch (run.status) {
    case "queued":
      return "Queued";
    case "claimed":
      return "Claimed";
    case "creating_workspace":
      return run.targetMode === "local" ? "Creating local workspace" : "Creating workspace";
    case "provisioning_workspace":
      return run.targetMode === "local" ? "Preparing local workspace" : "Provisioning workspace";
    case "creating_session":
      return "Creating session";
    case "dispatching":
      return "Dispatching";
    case "dispatched":
      return "Dispatched";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return `Unknown status: ${run.status}`;
  }
}

function automationRunTimestampLabel(run: AutomationRunInventoryRecord): string {
  if (run.triggerKind === "manual") {
    return `Requested ${formatTimestamp(run.createdAt)}`;
  }
  return `Scheduled ${formatTimestamp(run.scheduledFor ?? run.createdAt)}`;
}

function automationTargetLabel(
  targetMode?: AutomationTargetMode | null,
  executionTarget?: string | null,
  targetKind?: string | null,
): string {
  if (executionTarget === "ssh" || targetKind === "ssh") {
    return "SSH target";
  }
  if (targetMode === "local" || executionTarget === "local") {
    return "Local";
  }
  if (targetMode === "shared_cloud") {
    return "Shared cloud";
  }
  if (targetMode === "personal_cloud") {
    return "Personal cloud";
  }
  return "Cloud";
}

function parseRrule(rrule: string | null | undefined): ParsedRrule | null {
  if (!rrule) {
    return null;
  }
  const parts = parseRruleParts(rrule);
  if (!parts?.FREQ) {
    return null;
  }
  const freq = parts.FREQ;
  if (freq !== "DAILY" && freq !== "HOURLY") {
    return null;
  }
  const interval = parsePositiveInt(parts.INTERVAL ?? "1") ?? 1;
  const byHour = parts.BYHOUR ? parsePositiveIntList(parts.BYHOUR) : null;
  const byMinute = parts.BYMINUTE ? parsePositiveIntList(parts.BYMINUTE) : null;
  if (
    (byHour !== null && byHour.some((value) => value > 23))
    || (byMinute !== null && byMinute.some((value) => value > 59))
  ) {
    return null;
  }
  return {
    freq,
    interval,
    byDay: parts.BYDAY ? parts.BYDAY.split(",").filter(isWeekdayValue) : null,
    byHour,
    byMinute,
  };
}

function parseRruleParts(rrule: string): Record<string, string> | null {
  const line = rrule.trim().toUpperCase().replace(/^RRULE:/, "");
  if (!line) {
    return null;
  }
  const parts: Record<string, string> = {};
  for (const segment of line.split(";")) {
    const [key, ...valueParts] = segment.split("=");
    const value = valueParts.join("=");
    if (!key || !value) {
      return null;
    }
    parts[key] = value;
  }
  return parts;
}

function isWeekdayValue(value: string): value is typeof WEEKDAY_VALUES[number] {
  return (WEEKDAY_VALUES as readonly string[]).includes(value);
}

function parsePositiveInt(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveIntList(value: string): number[] | null {
  const values = value.split(",").map((part) => parsePositiveInt(part));
  if (values.length === 0 || values.some((part) => part === null)) {
    return null;
  }
  return [...new Set(values as number[])].sort((left, right) => left - right);
}

function dailyRuleMatches(
  date: Date,
  parsed: ParsedRrule,
  timeZone?: string | null,
): boolean {
  const parts = ruleDateTimeParts(date, timeZone);
  const weekday = WEEKDAY_VALUES[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
  if (parsed.byDay?.length && !parsed.byDay.includes(weekday)) {
    return false;
  }
  if (parsed.interval <= 1) {
    return true;
  }
  const daysSinceAnchor = (
    Date.UTC(parts.year, parts.month - 1, parts.day)
    - Date.UTC(2020, 0, 1)
  ) / DAY_MS;
  return Number.isInteger(daysSinceAnchor) && daysSinceAnchor % parsed.interval === 0;
}

function hourlyIntervalMatches(
  date: Date,
  interval: number,
  timeZone?: string | null,
): boolean {
  if (interval <= 1) {
    return true;
  }
  const parts = ruleDateTimeParts(date, timeZone);
  const hoursSinceAnchor = (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour)
    - Date.UTC(2020, 0, 1, 0)
  ) / HOUR_MS;
  return Number.isInteger(hoursSinceAnchor) && hoursSinceAnchor % interval === 0;
}

function ruleDateTimeParts(date: Date, timeZone?: string | null) {
  if (timeZone) {
    return dateTimePartsInZone(date, timeZone);
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

function zonedDateTimeToDate(args: {
  date: string;
  hour: number;
  minute: number;
  timeZone?: string;
}): Date {
  const [year, month, day] = args.date.split("-").map((part) => Number.parseInt(part, 10));
  if (!args.timeZone) {
    return new Date(year, month - 1, day, args.hour, args.minute, 0, 0);
  }
  let candidate = new Date(Date.UTC(year, month - 1, day, args.hour, args.minute, 0, 0));
  for (let i = 0; i < 3; i += 1) {
    const parts = dateTimePartsInZone(candidate, args.timeZone);
    const desired = Date.UTC(year, month - 1, day, args.hour, args.minute, 0, 0);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const delta = desired - actual;
    if (delta === 0) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + delta);
  }
  return candidate;
}

function dateTimePartsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);
  const hour = value("hour");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: hour === 24 ? 0 : hour,
    minute: value("minute"),
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

function addLocalDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
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

function formatNextRunLabel(
  value: string | null,
  timezone: string | null | undefined,
  now: Date,
): string {
  if (!value) {
    return "Not scheduled";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  const deltaMs = date.getTime() - now.getTime();
  if (deltaMs >= 0 && deltaMs < 60 * 1000) {
    return "Due now";
  }
  if (deltaMs >= 0 && deltaMs < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(deltaMs / (60 * 1000)));
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }
  return formatTimestamp(value, timezone);
}

function formatTimestamp(value: string | null | undefined, timezone?: string | null): string {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone ?? undefined,
  }).format(date);
}

function formatTimeOnly(date: Date, timezone?: string | null): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone ?? undefined,
  }).format(date);
}

function compactMessage(message: string): string {
  const firstLine = message.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length <= 140) {
    return firstLine;
  }
  return `${firstLine.slice(0, 137)}...`;
}

function normalizeDate(value?: Date | number): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  return new Date();
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateId(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}
