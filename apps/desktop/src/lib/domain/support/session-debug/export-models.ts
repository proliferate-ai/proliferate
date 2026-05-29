import type {
  GetSessionLiveConfigResponse,
  Session,
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import type { SessionDebugLocator } from "@/lib/domain/support/session-debug/locator";
import { sanitizeSessionDebugExportedSession } from "@/lib/domain/support/session-debug/sanitizer";

export type SessionDebugScopeKind = "session" | "workspace";

export interface SessionDebugError {
  scope: string;
  message: string;
}

export interface SessionDebugExportedSession {
  session: Session | null;
  normalizedEvents: SessionEventEnvelope[] | null;
  rawNotifications: SessionRawNotificationEnvelope[] | null;
  liveConfig: GetSessionLiveConfigResponse | null;
  errors: SessionDebugError[];
}

export interface SessionDebugExport {
  schemaVersion: 1;
  generatedAt: string;
  scope: {
    kind: SessionDebugScopeKind;
    id: string;
  };
  locator: SessionDebugLocator;
  sessions: SessionDebugExportedSession[];
  errors: SessionDebugError[];
}

export interface BuildSessionDebugExportInput {
  generatedAt: Date | string;
  scope: {
    kind: SessionDebugScopeKind;
    id: string;
  };
  locator: SessionDebugLocator;
  sessions: SessionDebugExportedSession[];
  errors?: SessionDebugError[];
}

export function buildSessionDebugExport(
  input: BuildSessionDebugExportInput,
): SessionDebugExport {
  return {
    schemaVersion: 1,
    generatedAt: normalizeDate(input.generatedAt),
    scope: input.scope,
    locator: input.locator,
    sessions: input.sessions.map(sanitizeSessionDebugExportedSession),
    errors: input.errors ?? [],
  };
}

function normalizeDate(date: Date | string): string {
  return typeof date === "string" ? date : date.toISOString();
}
