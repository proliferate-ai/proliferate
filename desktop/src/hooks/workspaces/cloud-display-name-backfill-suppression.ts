const CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY =
  "proliferate.cloudDisplayNameBackfillSuppression.v1";

type SuppressionMap = Record<string, true>;

function readSuppressionMap(): SuppressionMap {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as SuppressionMap;
  } catch {
    return {};
  }
}

function writeSuppressionMap(map: SuppressionMap): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const entries = Object.entries(map);
    if (entries.length === 0) {
      window.localStorage.removeItem(CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY);
      return;
    }
    window.localStorage.setItem(
      CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Storage can be unavailable in privacy modes; runtime clearing still prevents stale backfill.
  }
}

export function isCloudDisplayNameBackfillSuppressed(cloudWorkspaceId: string): boolean {
  return readSuppressionMap()[cloudWorkspaceId] === true;
}

export function suppressCloudDisplayNameBackfill(cloudWorkspaceId: string): void {
  writeSuppressionMap({
    ...readSuppressionMap(),
    [cloudWorkspaceId]: true,
  });
}

export function clearCloudDisplayNameBackfillSuppression(cloudWorkspaceId: string): void {
  const map = readSuppressionMap();
  if (map[cloudWorkspaceId] !== true) {
    return;
  }
  const next = { ...map };
  delete next[cloudWorkspaceId];
  writeSuppressionMap(next);
}
