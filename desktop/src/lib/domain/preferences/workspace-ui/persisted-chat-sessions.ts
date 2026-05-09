import { sanitizeManualChatGroupsByWorkspace, type ManualChatGroup } from "@/lib/domain/workspaces/tabs/manual-groups";
import { uniqueIds } from "@/lib/domain/workspaces/tabs/visibility";

export function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return typeof value === "object"
    && value !== null
    && Object.values(value).every((entry) =>
      Array.isArray(entry) && entry.every((item) => typeof item === "string")
    );
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object"
    && value !== null
    && Object.values(value).every((entry) => typeof entry === "string");
}

export function sanitizeSessionIdArrayRecord(value: unknown): Record<string, string[]> {
  if (!isStringArrayRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([workspaceId, sessionIds]) => {
      const sanitized = uniqueIds(sessionIds.filter((sessionId) =>
        !isTransientClientSessionId(sessionId)
      ));
      return sanitized.length > 0 ? [[workspaceId, sanitized]] : [];
    }),
  );
}

export function sanitizeLastViewedSessionByWorkspace(value: unknown): Record<string, string> {
  if (!isStringRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, sessionId]) => !isTransientClientSessionId(sessionId)),
  );
}

export function sanitizeManualChatGroupsWithoutTransientSessions(
  value: Record<string, ManualChatGroup[]>,
): Record<string, ManualChatGroup[]> {
  return Object.fromEntries(
    Object.entries(sanitizeManualChatGroupsByWorkspace(value)).flatMap(([workspaceId, groups]) => {
      const nextGroups = groups.flatMap((group) => {
        const sessionIds = uniqueIds(group.sessionIds.filter((sessionId) =>
          !isTransientClientSessionId(sessionId)
        ));
        return sessionIds.length > 0 ? [{ ...group, sessionIds }] : [];
      });
      return nextGroups.length > 0 ? [[workspaceId, nextGroups]] : [];
    }),
  );
}

export function isTransientClientSessionId(sessionId: string): boolean {
  return sessionId.startsWith("client-session:")
    || sessionId.startsWith("pending-session:");
}
