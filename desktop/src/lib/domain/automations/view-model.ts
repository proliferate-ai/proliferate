import { AUTOMATION_RUN_COPY } from "@/config/automations";
import type {
  AutomationResponse,
  AutomationRunResponse,
} from "@/lib/integrations/cloud/client";
import { formatAutomationTimestamp } from "./schedule";

export interface AutomationRowViewModel {
  id: string;
  title: string;
  repoLabel: string;
  statusLabel: string;
  scheduleLabel: string;
  nextRunLabel: string;
  nextRunPlainLabel: string;
  executionLabel: string;
}

const MAX_STATUS_MESSAGE_LENGTH = 140;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function compactStatusMessage(message: string): string {
  const firstLine = message.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length <= MAX_STATUS_MESSAGE_LENGTH) {
    return firstLine;
  }
  return `${firstLine.slice(0, MAX_STATUS_MESSAGE_LENGTH - 3)}...`;
}

export function buildAutomationRowViewModel(
  automation: AutomationResponse,
): AutomationRowViewModel {
  const paused = !automation.enabled;
  return {
    id: automation.id,
    title: automation.title,
    repoLabel: `${automation.gitOwner}/${automation.gitRepoName}`,
    statusLabel: paused ? "Paused" : "Enabled",
    scheduleLabel: automation.schedule.summary,
    nextRunLabel: paused
      ? "Paused"
      : formatAutomationTimestamp(
        automation.schedule.nextRunAt,
        automation.schedule.timezone,
      ),
    nextRunPlainLabel: paused
      ? "Paused"
      : formatAutomationNextRunPlain(
        automation.schedule.nextRunAt,
        automation.schedule.timezone,
      ),
    executionLabel: automation.executionTarget === "cloud" ? "Cloud" : "Local",
  };
}

export function formatAutomationNextRunPlain(
  value: string | null,
  timezone?: string | null,
  now: Date = new Date(),
): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const deltaMs = date.getTime() - now.getTime();
  if (deltaMs < MINUTE_MS) {
    return "Due now";
  }

  const roundedMinutes = Math.round(deltaMs / MINUTE_MS);
  if (roundedMinutes < 60) {
    return roundedMinutes === 1 ? "in a minute" : `in ${roundedMinutes} minutes`;
  }

  const roundedHours = Math.round(deltaMs / HOUR_MS);
  if (roundedHours === 1) {
    return "in an hour";
  }
  if (roundedHours < 6) {
    return `in ${roundedHours} hours`;
  }

  const dayDelta = calendarDayDelta(now, date, timezone);
  const timeLabel = formatTimeOnly(date, timezone);
  if (dayDelta === 0) {
    return `today at ${timeLabel}`;
  }
  if (dayDelta === 1) {
    return `tomorrow at ${timeLabel}`;
  }
  if (dayDelta > 1 && dayDelta < 7) {
    return `${formatWeekday(date, timezone)} at ${timeLabel}`;
  }
  return `${formatMonthDay(date, timezone)} at ${timeLabel}`;
}

function calendarDayDelta(from: Date, to: Date, timezone?: string | null): number {
  const fromParts = datePartsInTimezone(from, timezone);
  const toParts = datePartsInTimezone(to, timezone);
  const fromDay = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day);
  const toDay = Date.UTC(toParts.year, toParts.month - 1, toParts.day);
  return Math.round((toDay - fromDay) / DAY_MS);
}

function datePartsInTimezone(date: Date, timezone?: string | null): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: timezone ?? undefined,
  });
  const parts = formatter.formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "0"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "0"),
  };
}

function formatTimeOnly(date: Date, timezone?: string | null): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone ?? undefined,
  }).format(date);
}

function formatWeekday(date: Date, timezone?: string | null): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    timeZone: timezone ?? undefined,
  }).format(date);
}

function formatMonthDay(date: Date, timezone?: string | null): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: timezone ?? undefined,
  }).format(date);
}

export function automationRunStatusLabel(run: AutomationRunResponse): string {
  switch (run.status) {
    case "queued":
      return run.executionTarget === "local"
        ? AUTOMATION_RUN_COPY.localQueued
        : AUTOMATION_RUN_COPY.queued;
    case "claimed":
      return AUTOMATION_RUN_COPY.claimed;
    case "creating_workspace":
      return run.executionTarget === "local"
        ? AUTOMATION_RUN_COPY.creatingLocalWorkspace
        : AUTOMATION_RUN_COPY.creatingWorkspace;
    case "provisioning_workspace":
      return run.executionTarget === "local"
        ? AUTOMATION_RUN_COPY.provisioningLocalWorkspace
        : AUTOMATION_RUN_COPY.provisioningWorkspace;
    case "creating_session":
      return AUTOMATION_RUN_COPY.creatingSession;
    case "dispatching":
      return AUTOMATION_RUN_COPY.dispatching;
    case "dispatched":
      return AUTOMATION_RUN_COPY.dispatched;
    case "failed":
      return run.lastErrorMessage
        ? compactStatusMessage(run.lastErrorMessage)
        : AUTOMATION_RUN_COPY.failed;
    case "cancelled":
      return AUTOMATION_RUN_COPY.cancelled;
    default:
      return `Unknown status: ${run.status}`;
  }
}

export function automationRunTimestampLabel(run: AutomationRunResponse): string {
  if (run.triggerKind === "manual") {
    return `Requested ${formatAutomationTimestamp(run.createdAt)}`;
  }
  return `Scheduled ${formatAutomationTimestamp(run.scheduledFor)}`;
}
