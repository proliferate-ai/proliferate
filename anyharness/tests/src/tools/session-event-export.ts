import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { AnyHarnessClient } from "@anyharness/sdk";
import type {
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";

export interface ExportSessionEventsOptions {
  sessionId: string;
  baseUrl: string;
  authToken?: string;
  afterSeq?: number;
  outPath?: string;
}

export async function exportSessionEvents(
  options: ExportSessionEventsOptions,
): Promise<SessionEventEnvelope[]> {
  const client = new AnyHarnessClient({
    baseUrl: options.baseUrl,
    authToken: options.authToken,
  });
  const events = await client.sessions.listEvents(
    options.sessionId,
    options.afterSeq != null ? { afterSeq: options.afterSeq } : undefined,
  );
  const canonicalEvents = canonicalizeSessionEvents(events);
  if (options.outPath) {
    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, formatExportedSessionEvents(canonicalEvents));
  }
  return canonicalEvents;
}

export function canonicalizeSessionEvents(
  events: SessionEventEnvelope[],
): SessionEventEnvelope[] {
  return [...events].sort((left, right) => left.seq - right.seq);
}

export function formatExportedSessionEvents(
  events: SessionEventEnvelope[],
): string {
  return `${JSON.stringify(events, null, 2)}\n`;
}

export async function exportSessionRawNotifications(
  options: ExportSessionEventsOptions,
): Promise<SessionRawNotificationEnvelope[]> {
  const client = new AnyHarnessClient({
    baseUrl: options.baseUrl,
    authToken: options.authToken,
  });
  const rawNotifications = await client.sessions.listRawNotifications(
    options.sessionId,
    options.afterSeq != null ? { afterSeq: options.afterSeq } : undefined,
  );
  const canonicalRawNotifications = canonicalizeSessionRawNotifications(rawNotifications);
  if (options.outPath) {
    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(
      options.outPath,
      formatExportedSessionRawNotifications(canonicalRawNotifications),
    );
  }
  return canonicalRawNotifications;
}

export function canonicalizeSessionRawNotifications(
  notifications: SessionRawNotificationEnvelope[],
): SessionRawNotificationEnvelope[] {
  return [...notifications].sort((left, right) => left.seq - right.seq);
}

export function formatExportedSessionRawNotifications(
  notifications: SessionRawNotificationEnvelope[],
): string {
  return `${JSON.stringify(notifications, null, 2)}\n`;
}
