import {
  readPersistedJson,
  removePersistedKey,
  writePersistedJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

const SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY =
  "proliferate.session-replacement-tombstones.v1";

export interface PersistedSessionReplacementTombstone {
  runtimeSessionId: string;
  suppressedSessionIds: string[];
}

export type PersistedSessionReplacementTombstones = Record<
  string,
  PersistedSessionReplacementTombstone[]
>;

// The session-replacement workflow keeps its committed set in memory and calls
// `writeSessionReplacementTombstones` synchronously inside transactional commit
// logic, so persistence is best-effort through a ProductStorage context injected
// once at the product lifecycle mount (see
// `useSessionReplacementTombstonesPersistence`). Committed state is restored via
// `hydrateSessionReplacementTombstones`; a failed write keeps in-memory state.
let storageContext: ProductStorageContext | null = null;

export function setSessionReplacementTombstonesStorageContext(
  context: ProductStorageContext | null,
): void {
  storageContext = context;
}

function normalizeSessionReplacementTombstones(
  parsed: unknown,
): PersistedSessionReplacementTombstones {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([workspaceId, entries]) => {
      if (!Array.isArray(entries)) {
        return [];
      }
      const normalized = entries.flatMap(normalizePersistedTombstone);
      return normalized.length > 0 ? [[workspaceId, normalized]] : [];
    }),
  );
}

function normalizePersistedTombstone(
  value: unknown,
): PersistedSessionReplacementTombstone[] {
  // v1 stored only runtime ids. Read those as a one-id suppression set so
  // existing cleanup state survives the richer alias-aware representation.
  if (typeof value === "string" && value.trim().length > 0) {
    return [{
      runtimeSessionId: value,
      suppressedSessionIds: [value],
    }];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  const runtimeSessionId = typeof record.runtimeSessionId === "string"
    ? record.runtimeSessionId.trim()
    : "";
  if (!runtimeSessionId) {
    return [];
  }
  const aliases = Array.isArray(record.suppressedSessionIds)
    ? record.suppressedSessionIds.filter((id): id is string => (
      typeof id === "string" && id.trim().length > 0
    ))
    : [];
  return [{
    runtimeSessionId,
    suppressedSessionIds: [...new Set([runtimeSessionId, ...aliases])],
  }];
}

/**
 * One-shot async read of the persisted committed tombstones through the injected
 * ProductStorage. Returns `{}` when the read is stale (unmount) or rejects.
 */
export async function hydrateSessionReplacementTombstones(
  context: ProductStorageContext,
  isStale?: () => boolean,
): Promise<PersistedSessionReplacementTombstones> {
  const result = await readPersistedJson<PersistedSessionReplacementTombstones>(
    context,
    SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY,
    {
      parse: (raw) => normalizeSessionReplacementTombstones(raw),
      fallback: {},
      isStale,
    },
  );
  return result.status === "settled" ? result.value : {};
}

/**
 * Best-effort persist of the committed tombstone map. Returns `true` whenever a
 * storage backend is wired (the in-memory commit always stands); an async write
 * failure is captured once by the helper and does not roll back the commit.
 * Before wiring (no host yet) this is in-memory only and also reports success.
 */
export function writeSessionReplacementTombstones(
  value: PersistedSessionReplacementTombstones,
): boolean {
  if (!storageContext) {
    return true;
  }
  if (Object.keys(value).length === 0) {
    void removePersistedKey(storageContext, SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY);
    return true;
  }
  void writePersistedJson(storageContext, SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY, value);
  return true;
}

export function resetSessionReplacementTombstonesStorageForTests(): void {
  storageContext = null;
}
