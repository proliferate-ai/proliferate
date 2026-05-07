import type { PendingPromptEntry, TranscriptItem, TurnRecord } from "@anyharness/sdk";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatTranscriptActionTime(
  value: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const date = parseValidDate(value);
  if (!date) {
    return null;
  }

  const time = formatLocalTime(date);
  if (isSameLocalDate(date, now)) {
    return time;
  }

  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${time}`;
}

export function resolveUserMessageActionTime(
  item: Pick<Extract<TranscriptItem, { kind: "user_message" }>, "timestamp">,
  now: Date = new Date(),
): string | null {
  return formatTranscriptActionTime(item.timestamp, now);
}

export function resolveOptimisticPromptActionTime(
  prompt: Pick<PendingPromptEntry, "queuedAt">,
  now: Date = new Date(),
): string | null {
  return formatTranscriptActionTime(prompt.queuedAt, now);
}

export function resolveAssistantTurnActionTime({
  assistantItem,
  turn,
  now = new Date(),
}: {
  assistantItem: Pick<Extract<TranscriptItem, { kind: "assistant_prose" }>, "completedAt" | "timestamp"> | null;
  turn: Pick<TurnRecord, "completedAt" | "startedAt">;
  now?: Date;
}): string | null {
  return formatTranscriptActionTime(
    assistantItem?.completedAt
      ?? assistantItem?.timestamp
      ?? turn.completedAt
      ?? turn.startedAt,
    now,
  );
}

function parseValidDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatLocalTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes} ${period}`;
}

function isSameLocalDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
