import type { PendingConfigChange } from "@proliferate/product-domain/chats/cloud/composer-controls";

import {
  isFresh,
  numberOrDefault,
  readSessionStorageValue,
  removeSessionStorageValue,
  stringOrNull,
  writeSessionStorageValue,
} from "./web-cloud-state-storage";

type StoredPendingConfigChange = PendingConfigChange & { storedAt: number };

const PENDING_CONFIG_CHANGES_KEY_PREFIX = "proliferate.web.cloudPendingConfigChanges:";
const MAX_PENDING_CONFIG_CHANGE_AGE_MS = 30 * 60 * 1000;

const memoryPendingConfigChanges = new Map<string, Record<string, StoredPendingConfigChange>>();

export function saveWebCloudPendingConfigChanges(
  workspaceId: string,
  changes: Record<string, PendingConfigChange>,
): void {
  const now = Date.now();
  const storedEntries = Object.entries(changes)
    .filter(([, change]) => isPendingConfigChange(change))
    .map(([key, change]) => [key, { ...change, storedAt: now }] as const);
  const stored = Object.fromEntries(storedEntries);
  memoryPendingConfigChanges.set(workspaceId, stored);
  if (storedEntries.length === 0) {
    removeSessionStorageValue(pendingConfigChangesKey(workspaceId));
    return;
  }
  writeSessionStorageValue(pendingConfigChangesKey(workspaceId), JSON.stringify(stored));
}

export function loadWebCloudPendingConfigChanges(
  workspaceId: string,
): Record<string, PendingConfigChange> {
  const memoryValue = memoryPendingConfigChanges.get(workspaceId);
  if (memoryValue) {
    const fresh = parsePendingConfigChanges(memoryValue);
    memoryPendingConfigChanges.set(workspaceId, stampPendingConfigChanges(fresh));
    return fresh;
  }
  const raw = readSessionStorageValue(pendingConfigChangesKey(workspaceId));
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    const changes = parsePendingConfigChanges(parsed);
    memoryPendingConfigChanges.set(workspaceId, stampPendingConfigChanges(changes));
    return changes;
  } catch {
    return {};
  }
}

function pendingConfigChangesKey(workspaceId: string): string {
  return `${PENDING_CONFIG_CHANGES_KEY_PREFIX}${workspaceId}`;
}

function parsePendingConfigChanges(value: unknown): Record<string, PendingConfigChange> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const changes: Record<string, PendingConfigChange> = {};
  for (const [key, item] of Object.entries(value)) {
    const change = parsePendingConfigChange(item);
    if (change) {
      changes[key] = change;
    }
  }
  return changes;
}

function stampPendingConfigChanges(
  changes: Record<string, PendingConfigChange>,
): Record<string, StoredPendingConfigChange> {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(changes).map(([key, change]) => [key, { ...change, storedAt: now }]),
  );
}

function parsePendingConfigChange(value: unknown): PendingConfigChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isFresh(numberOrDefault(record.storedAt, 0), MAX_PENDING_CONFIG_CHANGE_AGE_MS)) {
    return null;
  }
  const sessionId = stringOrNull(record.sessionId);
  const rawConfigId = stringOrNull(record.rawConfigId);
  const updateValue = stringOrNull(record.value);
  if (!sessionId || !rawConfigId || !updateValue) {
    return null;
  }
  return {
    sessionId,
    rawConfigId,
    value: updateValue,
    status: record.status === "sending" ? "sending" : "queued",
    mutationId: numberOrDefault(record.mutationId, 0),
    commandId: stringOrNull(record.commandId),
  };
}

function isPendingConfigChange(value: PendingConfigChange): boolean {
  return Boolean(value.sessionId && value.rawConfigId && value.value);
}
