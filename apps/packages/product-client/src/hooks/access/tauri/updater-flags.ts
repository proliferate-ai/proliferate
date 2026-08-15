import {
  readPersistedJsonValue,
  type ProductStorageContext,
} from "#product/lib/infra/persistence/product-storage";

/**
 * Client-local persisted feature flags for the updater flow (FR-2). Kept in
 * product storage rather than the server so the owned/persistent path can be
 * toggled per install without a deploy, and so a revert is just flipping the
 * flag off — the legacy in-memory plugin path stays wired underneath.
 */
export interface UpdaterFlags {
  /**
   * Owned Rust download + staging + verification path. DEFAULT ON (the spike
   * verified the plugin cannot abort/resume/verify at the install seam). OFF
   * restores the exact legacy `downloadAndInstall` plugin path.
   */
  ownedUpdaterEnabled: boolean;
  /**
   * When ON and a non-official server is connected, the owned check points at
   * `${serverBaseUrl}/desktop/updater/latest.json`. DEFAULT OFF — the ADR gates
   * the redirect to the baked feed until proven, and any failure falls back to
   * baked.
   */
  updaterServerRedirectEnabled: boolean;
}

export const UPDATER_FLAGS_KEY = "updater_flags";

export const DEFAULT_UPDATER_FLAGS: UpdaterFlags = {
  ownedUpdaterEnabled: true,
  updaterServerRedirectEnabled: false,
};

/**
 * Read the persisted flags, tolerantly: a missing key, malformed JSON, or a
 * wrong-typed field each falls back to the default for that field. Never
 * throws.
 */
export async function readUpdaterFlags(
  storage: ProductStorageContext,
): Promise<UpdaterFlags> {
  const raw = await readPersistedJsonValue<Partial<UpdaterFlags>>(
    storage,
    UPDATER_FLAGS_KEY,
  );
  return normalizeUpdaterFlags(raw);
}

export function normalizeUpdaterFlags(raw: unknown): UpdaterFlags {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_UPDATER_FLAGS };
  }
  const record = raw as Record<string, unknown>;
  return {
    ownedUpdaterEnabled:
      typeof record.ownedUpdaterEnabled === "boolean"
        ? record.ownedUpdaterEnabled
        : DEFAULT_UPDATER_FLAGS.ownedUpdaterEnabled,
    updaterServerRedirectEnabled:
      typeof record.updaterServerRedirectEnabled === "boolean"
        ? record.updaterServerRedirectEnabled
        : DEFAULT_UPDATER_FLAGS.updaterServerRedirectEnabled,
  };
}
