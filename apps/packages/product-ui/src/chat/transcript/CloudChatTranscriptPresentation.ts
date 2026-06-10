import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  SquareTerminal,
  User,
  Wrench,
} from "lucide-react";
import type { CloudChatTranscriptRowView } from "./CloudChatTranscriptTypes";
import type { CloudTranscriptActionStatus } from "./CloudChatTranscriptTypes";

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

export function userMessageStatusLabel(status: string | null | undefined): string | null {
  const value = status?.trim();
  if (!value) {
    return null;
  }
  return /\b(failed|error|rejected|expired|could not|timed out)\b/i.test(value)
    ? value
    : null;
}

export function iconForRow(row: CloudChatTranscriptRowView) {
  switch (row.kind) {
    case "error":
      return AlertTriangle;
    case "system":
      return Bot;
    case "thought":
      return Brain;
    case "tool":
      return row.status === "completed" ? CheckCircle2 : SquareTerminal;
    case "tool_group":
      return Wrench;
    case "user":
      return User;
    case "assistant":
    default:
      return row.streaming ? Clock3 : Bot;
  }
}

export function resolveActionStatus(row: CloudChatTranscriptRowView): CloudTranscriptActionStatus {
  const status = row.status?.toLowerCase() ?? "";
  if (
    row.kind === "error"
    || status.includes("fail")
    || status.includes("error")
    || status.includes("reject")
    || status.includes("expired")
  ) {
    return "failed";
  }
  if (
    row.streaming
    || status.includes("running")
    || status.includes("pending")
    || status.includes("queued")
    || status.includes("sending")
    || status.includes("progress")
    || status.includes("approval")
  ) {
    return "running";
  }
  return "completed";
}

export function firstLine(value: string): string | null {
  const line = value.trim().split(/\r?\n/, 1)[0]?.trim();
  return line || null;
}

export function titleForRow(row: CloudChatTranscriptRowView): string {
  switch (row.kind) {
    case "error":
      return "Error";
    case "system":
      return "System";
    case "thought":
      return "Reasoning";
    case "tool_group":
      return "Actions";
    case "tool":
      return "Tool call";
    case "user":
      return "User";
    case "assistant":
    default:
      return "Assistant";
  }
}
