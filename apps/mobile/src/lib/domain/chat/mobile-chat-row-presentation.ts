import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";

export function toolSummary(row: CloudChatTranscriptRowView): string {
  if (isWorkHistoryRow(row)) {
    return workHistorySummary(row);
  }
  const count = row.children?.length ?? 0;
  if (count > 0) {
    return `${count} ${count === 1 ? "tool call" : "tool calls"}${row.status ? ` · ${row.status}` : ""}`;
  }
  return row.status ?? row.detail ?? "Tap for details";
}

export function isWorkHistoryRow(row: CloudChatTranscriptRowView): boolean {
  return row.kind === "system" && (row.title ?? "").toLowerCase() === "work history";
}

export function workHistorySummary(row: CloudChatTranscriptRowView): string {
  const detailFragments = (row.detail ?? "")
    .split(",")
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment && !/\btool calls?\b/i.test(fragment));
  const actionFragments = (row.children ?? [])
    .filter((child) => child.kind === "tool_group" && child.title)
    .map((child) => pastTenseActionSummary(child.title ?? ""))
    .filter((value): value is string => Boolean(value));
  const fragments = [...detailFragments, ...actionFragments];
  if (fragments.length > 0) {
    return sentenceCase(fragments.join(", "));
  }
  return row.detail ?? row.body ?? "Work history";
}

export function isAssistantLoadingRow(row: CloudChatTranscriptRowView): boolean {
  return row.kind === "assistant"
    && Boolean(row.streaming)
    && (
      !row.body?.trim()
      || row.id.includes(":assistant-waiting")
      || row.id.includes(":pending-assistant")
    );
}

export function loadingStatusText(row: CloudChatTranscriptRowView): string | null {
  const value = row.detail ?? row.body ?? row.status ?? null;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function loadingStatusLabel(row: CloudChatTranscriptRowView): string {
  const status = loadingStatusText(row) ?? "Loading";
  return `${status.replace(/[\s.]+$/g, "")}...`;
}

export function isPromptProgressStatus(message: string | null): boolean {
  return /^(preparing|starting|sending|waiting|queued|using selected cloud agent credential|workspace is provisioning|command (queued|leased|accepted|delivered))/i
    .test(message ?? "");
}

export function userMessageStatusLabel(status: string | null | undefined): string | null {
  const value = status?.trim();
  if (!value) {
    return null;
  }
  return /\b(failed|error|rejected|expired|could not|timed out)\b/i.test(value)
    ? value
    : null;
}

export function messageLabel(row: CloudChatTranscriptRowView): string {
  switch (row.kind) {
    case "assistant":
      return "assistant";
    case "user":
      return "you";
    case "thought":
      return "reasoning";
    case "tool":
    case "tool_group":
      return "tool";
    case "error":
      return "error";
    case "system":
    default:
      return "system";
  }
}

function pastTenseActionSummary(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .replace(/^Running\b/, "ran")
    .replace(/\brunning\b/g, "ran")
    .replace(/^Explored\b/, "explored")
    .replace(/^Edited\b/, "edited")
    .replace(/^Worked\b/, "worked");
}

function sentenceCase(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}
