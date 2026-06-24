const PENDING_ORGANIZATION_JOIN_TARGET_KEY = "proliferate.organizationJoinTarget";
const PENDING_ORGANIZATION_JOIN_TARGET_MAX_AGE_MS = 60 * 60 * 1000;

interface StoredOrganizationJoinTarget {
  organizationId: string;
  createdAt: number;
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && "localStorage" in window;
}

function isStoredTargetFresh(target: StoredOrganizationJoinTarget): boolean {
  return Date.now() - target.createdAt <= PENDING_ORGANIZATION_JOIN_TARGET_MAX_AGE_MS;
}

export function readPendingOrganizationJoinTarget(): string | null {
  if (!isBrowserStorageAvailable()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(PENDING_ORGANIZATION_JOIN_TARGET_KEY);
    if (!raw) {
      return null;
    }
    const target = JSON.parse(raw) as StoredOrganizationJoinTarget;
    if (!target.organizationId || !isStoredTargetFresh(target)) {
      clearPendingOrganizationJoinTarget();
      return null;
    }
    return target.organizationId;
  } catch {
    clearPendingOrganizationJoinTarget();
    return null;
  }
}

export function writePendingOrganizationJoinTarget(organizationId: string): void {
  if (!isBrowserStorageAvailable()) {
    return;
  }
  try {
    window.localStorage.setItem(
      PENDING_ORGANIZATION_JOIN_TARGET_KEY,
      JSON.stringify({
        organizationId,
        createdAt: Date.now(),
      } satisfies StoredOrganizationJoinTarget),
    );
  } catch {
    // Ignore browser persistence failures; the in-memory join state still covers
    // the common desktop auth callback path.
  }
}

export function clearPendingOrganizationJoinTarget(): void {
  if (!isBrowserStorageAvailable()) {
    return;
  }
  try {
    window.localStorage.removeItem(PENDING_ORGANIZATION_JOIN_TARGET_KEY);
  } catch {
    // Ignore browser persistence failures.
  }
}
