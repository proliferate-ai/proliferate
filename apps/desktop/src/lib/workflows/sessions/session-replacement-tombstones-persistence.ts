import {
  readProductStorageJson,
  removeProductStorageItem,
  writeProductStorageJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

export const SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY =
  "proliferate.session-replacement-tombstones.v1";

export interface PersistedSessionReplacementTombstone {
  runtimeSessionId: string;
  suppressedSessionIds: string[];
}

export type PersistedSessionReplacementTombstones = Record<
  string,
  PersistedSessionReplacementTombstone[]
>;

export async function readSessionReplacementTombstones(
  context: ProductStorageContext,
): Promise<PersistedSessionReplacementTombstones> {
  const persisted = await readProductStorageJson<unknown>(
    context,
    SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY,
  );
  if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(persisted).flatMap(([workspaceId, entries]) => {
      if (!Array.isArray(entries)) return [];
      const normalized = entries.flatMap(normalizePersistedTombstone);
      return normalized.length > 0 ? [[workspaceId, normalized]] : [];
    }),
  );
}

export async function writeSessionReplacementTombstones(
  context: ProductStorageContext,
  value: PersistedSessionReplacementTombstones,
): Promise<boolean> {
  if (Object.keys(value).length === 0) {
    return await removeProductStorageItem(
      context,
      SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY,
    );
  }
  return await writeProductStorageJson(
    context,
    SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY,
    value,
  );
}

function normalizePersistedTombstone(
  value: unknown,
): PersistedSessionReplacementTombstone[] {
  if (typeof value === "string" && value.trim().length > 0) {
    return [{ runtimeSessionId: value, suppressedSessionIds: [value] }];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const runtimeSessionId = typeof record.runtimeSessionId === "string"
    ? record.runtimeSessionId.trim()
    : "";
  if (!runtimeSessionId) return [];
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
