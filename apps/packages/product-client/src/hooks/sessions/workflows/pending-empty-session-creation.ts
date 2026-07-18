import type { ProductStorageContext } from "#product/lib/infra/persistence/product-storage";
import type { CreateEmptySessionWithResolvedConfigOptions } from "#product/hooks/sessions/workflows/session-creation-types";

const STORAGE_KEY_PREFIX = "proliferate.pending-empty-session-creations.v1";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PendingEmptySessionCreation {
  workspaceId: string;
  clientSessionId: string;
  runtimeSessionId: string;
  agentKind: string;
  modelId: string;
  modeId: string | null;
  launchControlValues?: Record<string, string>;
  replacesSessionId: string | null;
  createdAt: number;
}

const mutationQueues = new WeakMap<object, Map<string, Promise<void>>>();

function storageKey(workspaceId: string): string {
  return `${STORAGE_KEY_PREFIX}:${workspaceId}`;
}

function captureStorageFailure(
  context: ProductStorageContext,
  error: unknown,
  action: "read" | "write" | "remove",
): void {
  try {
    const captured = context.captureException(error, {
      tags: {
        domain: "pending_empty_session_creation",
        action,
      },
    }) as unknown;
    if (
      captured !== null
      && typeof captured === "object"
      && typeof (captured as PromiseLike<unknown>).then === "function"
    ) {
      void (captured as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Telemetry is best-effort and cannot change persistence semantics.
  }
}

function normalizeLaunchControlValues(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeEntry(value: unknown, workspaceId: string): PendingEmptySessionCreation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.workspaceId !== workspaceId
    || typeof record.clientSessionId !== "string"
    || !record.clientSessionId.startsWith("client-session:")
    || typeof record.runtimeSessionId !== "string"
    || !UUID_V4_PATTERN.test(record.runtimeSessionId)
    || typeof record.agentKind !== "string"
    || record.agentKind.length === 0
    || typeof record.modelId !== "string"
    || record.modelId.length === 0
    || !(record.modeId === null || typeof record.modeId === "string")
    || !(record.replacesSessionId === null || typeof record.replacesSessionId === "string")
    || typeof record.createdAt !== "number"
    || !Number.isFinite(record.createdAt)
  ) {
    return null;
  }
  return {
    workspaceId,
    clientSessionId: record.clientSessionId,
    runtimeSessionId: record.runtimeSessionId,
    agentKind: record.agentKind,
    modelId: record.modelId,
    modeId: record.modeId,
    launchControlValues: normalizeLaunchControlValues(record.launchControlValues),
    replacesSessionId: record.replacesSessionId,
    createdAt: record.createdAt,
  };
}

async function readEntries(
  context: ProductStorageContext,
  workspaceId: string,
  throwOnFailure = false,
): Promise<PendingEmptySessionCreation[]> {
  let raw: string | null;
  try {
    raw = await context.storage.getItem(storageKey(workspaceId));
  } catch (error) {
    captureStorageFailure(context, error, "read");
    if (throwOnFailure) {
      throw error;
    }
    return [];
  }
  if (raw === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => normalizeEntry(entry, workspaceId))
      .filter((entry): entry is PendingEmptySessionCreation => entry !== null)
      .sort((left, right) => left.createdAt - right.createdAt);
  } catch {
    return [];
  }
}

function enqueueMutation<T>(
  context: ProductStorageContext,
  workspaceId: string,
  operation: () => Promise<T>,
): Promise<T> {
  let queues = mutationQueues.get(context.storage);
  if (!queues) {
    queues = new Map();
    mutationQueues.set(context.storage, queues);
  }
  const key = storageKey(workspaceId);
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  queues.set(key, result.then(() => undefined, () => undefined));
  return result;
}

async function writeEntries(
  context: ProductStorageContext,
  workspaceId: string,
  entries: PendingEmptySessionCreation[],
  throwOnFailure: boolean,
): Promise<void> {
  try {
    if (entries.length === 0) {
      await context.storage.removeItem(storageKey(workspaceId));
    } else {
      await context.storage.setItem(storageKey(workspaceId), JSON.stringify(entries));
    }
  } catch (error) {
    captureStorageFailure(context, error, entries.length === 0 ? "remove" : "write");
    if (throwOnFailure) {
      throw error;
    }
  }
}

/**
 * Durably records an empty-session create before its POST begins. A failed
 * write rejects so the caller can fail closed without issuing remote work.
 */
export function persistPendingEmptySessionCreation(
  context: ProductStorageContext,
  entry: PendingEmptySessionCreation,
): Promise<void> {
  return enqueueMutation(context, entry.workspaceId, async () => {
    const entries = await readEntries(context, entry.workspaceId, true);
    const next = entries.filter((existing) => (
      existing.runtimeSessionId !== entry.runtimeSessionId
      && existing.clientSessionId !== entry.clientSessionId
    ));
    next.push(entry);
    next.sort((left, right) => left.createdAt - right.createdAt);
    await writeEntries(context, entry.workspaceId, next, true);
  });
}

export function loadPendingEmptySessionCreations(
  context: ProductStorageContext,
  workspaceId: string,
): Promise<PendingEmptySessionCreation[]> {
  // Bootstrap must fail closed when the ledger cannot be read. Treating a
  // transient read failure as "no pending create" could mint a duplicate id.
  return enqueueMutation(
    context,
    workspaceId,
    () => readEntries(context, workspaceId, true),
  );
}

/** Best-effort acknowledgement after the create response is known. */
export function clearPendingEmptySessionCreation(
  context: ProductStorageContext,
  workspaceId: string,
  runtimeSessionId: string,
): Promise<void> {
  return enqueueMutation(context, workspaceId, async () => {
    const entries = await readEntries(context, workspaceId, true);
    await writeEntries(
      context,
      workspaceId,
      entries.filter((entry) => entry.runtimeSessionId !== runtimeSessionId),
      false,
    );
  }).catch(() => undefined);
}

/** Only transport failures have an unknown commit outcome and remain resumable. */
export function isAmbiguousSessionCreateFailure(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof Error && error.name === "AbortError");
}

export async function resumePendingEmptySessionCreations(
  context: ProductStorageContext,
  workspaceId: string,
  isCurrent: () => boolean,
  createEmptySession: (
    options: CreateEmptySessionWithResolvedConfigOptions,
  ) => Promise<string>,
): Promise<number> {
  const entries = await loadPendingEmptySessionCreations(context, workspaceId);
  let resumed = 0;
  for (const entry of entries) {
    if (!isCurrent()) {
      break;
    }
    await createEmptySession({
      workspaceId,
      clientSessionId: entry.clientSessionId,
      runtimeSessionId: entry.runtimeSessionId,
      agentKind: entry.agentKind,
      modelId: entry.modelId,
      modeId: entry.modeId ?? undefined,
      launchControlValues: entry.launchControlValues,
      reuseInFlightEmptySession: false,
      preserveProjectedSessionOnCreateFailure: true,
      replacesSessionId: entry.replacesSessionId,
    });
    resumed += 1;
  }
  return resumed;
}
