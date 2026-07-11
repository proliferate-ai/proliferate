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

export function readSessionReplacementTombstones(): PersistedSessionReplacementTombstones {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
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
  } catch {
    return {};
  }
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

export function writeSessionReplacementTombstones(
  value: PersistedSessionReplacementTombstones,
): boolean {
  // Replacement workflows cannot run during SSR. Treat the no-window path as
  // a no-op success so pure workflow tests do not need a fake browser.
  if (typeof window === "undefined") {
    return true;
  }
  try {
    if (Object.keys(value).length === 0) {
      window.localStorage.removeItem(SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY);
      return true;
    }
    window.localStorage.setItem(
      SESSION_REPLACEMENT_TOMBSTONES_STORAGE_KEY,
      JSON.stringify(value),
    );
    return true;
  } catch {
    return false;
  }
}
