/**
 * Pure normalization/validation for the docked file tree's durable record.
 *
 * The dock persists one versioned record under
 * {@link FILE_TREE_DOCK_STORAGE_KEY}. Exactly one legacy shape is accepted for a
 * one-time width migration: the unversioned `{ width: number }` object the
 * deleted floating overlay wrote under
 * {@link LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY}. Visibility, expansion state, and
 * any other legacy field were never part of that contract and are not migrated.
 *
 * This module owns no storage access, retry policy, or state: the raw adapter in
 * `lib/access/persistence/file-tree-dock-storage.ts` performs the I/O and the
 * workspace file-tree lifecycle coordinator owns every branching decision.
 */

export const FILE_TREE_DOCK_STORAGE_KEY = "proliferate.fileTreeDock.v1";
export const LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY = "proliferate.fileTreeOverlay.v1";

/** Default desired dock width; also the value a corrupt width normalizes to. */
export const FILE_TREE_DOCK_DEFAULT_WIDTH = 400;
/**
 * Durable lower bound. Only the lower bound is clamped here: the render-time
 * ceiling is geometry-derived, so a temporarily narrow window must never
 * overwrite a larger finite desired width.
 */
export const FILE_TREE_DOCK_MIN_WIDTH = 280;

export interface PersistedFileTreeDockV1 {
  version: 1;
  /** Desired global width, default 400. */
  width: number;
  requestedVisibilityByWorkspace: Record<string, boolean>;
}

/** Own-key presence test (ES2021 target: no `Object.hasOwn`). */
export function hasOwnKey(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Normalize non-finite/corrupt widths to the default and clamp the lower bound. */
export function normalizeFileTreeDockWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return FILE_TREE_DOCK_DEFAULT_WIDTH;
  }
  return Math.max(FILE_TREE_DOCK_MIN_WIDTH, value);
}

export function normalizeRequestedVisibilityByWorkspace(
  value: unknown,
): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] =>
        entry[0].length > 0 && typeof entry[1] === "boolean",
    ),
  );
}

export function defaultFileTreeDockRecord(): PersistedFileTreeDockV1 {
  return {
    version: 1,
    width: FILE_TREE_DOCK_DEFAULT_WIDTH,
    requestedVisibilityByWorkspace: {},
  };
}

/**
 * Parse a stored v1 record. Returns null when the decoded value is not a v1
 * record at all (missing/other `version`, non-object); a v1 record with corrupt
 * fields is recoverably normalized rather than rejected, because a present new
 * record always wins over the legacy key.
 */
export function parsePersistedFileTreeDockV1(
  raw: unknown,
): PersistedFileTreeDockV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) {
    return null;
  }
  return {
    version: 1,
    width: normalizeFileTreeDockWidth(record.width),
    requestedVisibilityByWorkspace: normalizeRequestedVisibilityByWorkspace(
      record.requestedVisibilityByWorkspace,
    ),
  };
}

/**
 * Parse the one accepted legacy payload: the unversioned `{ width: number }`
 * object. A `version` field, visibility map, expansion data, non-finite width,
 * or any other shape is not part of the old contract and yields null.
 */
export function parseLegacyFileTreeOverlayWidth(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if ("version" in record) {
    return null;
  }
  if (typeof record.width !== "number" || !Number.isFinite(record.width)) {
    return null;
  }
  return normalizeFileTreeDockWidth(record.width);
}

export function fileTreeDockRecordsEqual(
  left: PersistedFileTreeDockV1,
  right: PersistedFileTreeDockV1,
): boolean {
  if (left.width !== right.width) {
    return false;
  }
  const leftKeys = Object.keys(left.requestedVisibilityByWorkspace);
  const rightKeys = Object.keys(right.requestedVisibilityByWorkspace);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) =>
      hasOwnKey(right.requestedVisibilityByWorkspace, key)
      && left.requestedVisibilityByWorkspace[key]
        === right.requestedVisibilityByWorkspace[key],
  );
}
