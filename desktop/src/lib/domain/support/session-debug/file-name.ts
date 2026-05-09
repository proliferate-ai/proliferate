import type { SessionDebugScopeKind } from "@/lib/domain/support/session-debug/export-models";

export function suggestSessionDebugFileName(
  scope: SessionDebugScopeKind,
  id: string,
  date: Date,
): string {
  const idPrefix = sanitizeFileNamePart(id).slice(0, 8).replace(/[-_]+$/, "") || "unknown";
  return `proliferate-${scope}-debug-${idPrefix}-${formatUtcTimestamp(date)}.json`;
}

function formatUtcTimestamp(date: Date): string {
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    "-",
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
  ].join("");
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function sanitizeFileNamePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, "");
}
