import {
  FILE_TREE_DOCK_STORAGE_KEY,
  LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY,
  defaultFileTreeDockRecord,
  fileTreeDockRecordsEqual,
  hasOwnKey,
  parseLegacyFileTreeOverlayWidth,
  parsePersistedFileTreeDockV1,
  type PersistedFileTreeDockV1,
} from "#product/lib/domain/files/file-tree-dock-state";
import {
  readFileTreeDockRecord,
  removeFileTreeDockKey,
  writeFileTreeDockRecord,
} from "#product/lib/access/persistence/file-tree-dock-storage";
import {
  canCommitUi,
  ensurePromotion,
  pump,
  rebasePromotions,
  resetBoundedRetries,
  settleIdle,
  type FileTreeDockCoordinatorState,
} from "./file-tree-dock-persistence-coordinator";

type Authority = FileTreeDockCoordinatorState;

/**
 * The docked file tree's read/write lane: the required-read gate (current
 * record, then legacy fallback), the merge of a settled read with any user
 * activity that landed before it, the bounded write, and the bounded legacy
 * key removal. Pure authority-state transitions and the promotion-transform
 * chain live in the sibling coordinator module this file is split from.
 */
export function ensureReadCycle(coordinator: Authority): void {
  if (coordinator.readPhase === "clear" || coordinator.readPhase === "pending") {
    return;
  }
  coordinator.readPhase = "pending";
  coordinator.readAttempts = 0;
  coordinator.legacyReadAttempts = 0;
  void runCurrentRead(coordinator);
}

async function runCurrentRead(coordinator: Authority): Promise<void> {
  coordinator.busy = true;
  const outcome = await readFileTreeDockRecord(
    coordinator.storage,
    FILE_TREE_DOCK_STORAGE_KEY,
  );
  coordinator.busy = false;
  if (outcome.status === "failed") {
    coordinator.sink({ operation: "read-current", outcome: "failed" });
    coordinator.readAttempts += 1;
    if (coordinator.readAttempts >= 2) {
      coordinator.readPhase = "blocked";
      settleIdle(coordinator);
      return;
    }
    void runCurrentRead(coordinator);
    return;
  }
  if (outcome.status === "settled") {
    // A present (even corrupt) new record wins; the old key is never live-read.
    coordinator.newRecordWritten = true;
    finishReads(
      coordinator,
      parsePersistedFileTreeDockV1(outcome.raw) ?? defaultFileTreeDockRecord(),
    );
    return;
  }
  void runLegacyRead(coordinator);
}

async function runLegacyRead(coordinator: Authority): Promise<void> {
  coordinator.busy = true;
  const outcome = await readFileTreeDockRecord(
    coordinator.storage,
    LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY,
  );
  coordinator.busy = false;
  if (outcome.status === "failed") {
    coordinator.sink({ operation: "read-legacy", outcome: "failed" });
    coordinator.legacyReadAttempts += 1;
    if (coordinator.legacyReadAttempts >= 2) {
      coordinator.readPhase = "blocked";
      settleIdle(coordinator);
      return;
    }
    void runLegacyRead(coordinator);
    return;
  }
  const legacyWidth =
    outcome.status === "settled" ? parseLegacyFileTreeOverlayWidth(outcome.raw) : null;
  if (legacyWidth === null) {
    finishReads(coordinator, defaultFileTreeDockRecord());
    return;
  }
  coordinator.legacyKeyPending = true;
  finishReads(coordinator, {
    version: 1,
    width: legacyWidth,
    requestedVisibilityByWorkspace: {},
  });
}

/**
 * Field-wise merge of the normalized persisted (new or legacy) record with the
 * user activity that landed before the reads settled: dirty fields win.
 */
function finishReads(coordinator: Authority, persisted: PersistedFileTreeDockV1): void {
  coordinator.readPhase = "clear";
  const live = canCommitUi(coordinator)
    ? coordinator.statePort.getDurableSnapshot()
    : coordinator.latestSnapshot;
  const merged: PersistedFileTreeDockV1 = {
    version: 1,
    width: coordinator.dirtyWidth ? live.width : persisted.width,
    requestedVisibilityByWorkspace: mergeVisibility(
      persisted.requestedVisibilityByWorkspace,
      live.requestedVisibilityByWorkspace,
      coordinator.dirtyVisibilityKeys,
    ),
  };
  coordinator.latestSnapshot = merged;
  if (canCommitUi(coordinator)) {
    coordinator.statePort.applyHydratedState({
      expectedDurableRevision: coordinator.recordRevision,
      desiredWidth: merged.width,
      requestedVisibilityByWorkspace: merged.requestedVisibilityByWorkspace,
    });
  }
  if (
    coordinator.legacyKeyPending
    || coordinator.dirtyWidth
    || coordinator.dirtyVisibilityKeys.size > 0
    || coordinator.promotions.length > 0
    || !fileTreeDockRecordsEqual(merged, persisted)
  ) {
    coordinator.pendingWrite = true;
    resetBoundedRetries(coordinator);
  }
  if (coordinator.promotionCandidate) {
    ensurePromotion(coordinator, coordinator.promotionCandidate);
  }
  pump(coordinator);
}

function mergeVisibility(
  persisted: Readonly<Record<string, boolean>>,
  live: Readonly<Record<string, boolean>>,
  dirtyKeys: ReadonlySet<string>,
): Record<string, boolean> {
  const merged: Record<string, boolean> = { ...persisted };
  for (const key of dirtyKeys) {
    if (hasOwnKey(live, key)) {
      merged[key] = live[key];
    } else {
      delete merged[key];
    }
  }
  return merged;
}

export async function runWrite(coordinator: Authority): Promise<void> {
  coordinator.busy = true;
  const rebased = rebasePromotions(coordinator.latestSnapshot, coordinator.promotions);
  coordinator.promotions = rebased.chain;
  const token = {
    revision: coordinator.recordRevision,
    attachment: coordinator.attachmentToken,
    chain: rebased.chain,
  };
  coordinator.pendingWrite = false;
  const outcome = await writeFileTreeDockRecord(
    coordinator.storage,
    FILE_TREE_DOCK_STORAGE_KEY,
    rebased.record,
  );
  coordinator.busy = false;
  if (outcome.status === "succeeded") {
    coordinator.newRecordWritten = true;
  } else {
    coordinator.sink({ operation: "write", outcome: "failed" });
  }
  if (token.revision !== coordinator.recordRevision) {
    // An older completion — successful or failed — cannot commit a promotion,
    // clear dirty state, remove the legacy key, or consume a retry.
    coordinator.pendingWrite = true;
    pump(coordinator);
    return;
  }
  if (outcome.status === "failed") {
    coordinator.writeAttempts += 1;
    coordinator.pendingWrite = true;
    if (coordinator.writeAttempts >= 2) {
      // Retain the latest full snapshot as dirty and stop: no timer, no loop.
      coordinator.writeBlocked = true;
      settleIdle(coordinator);
      return;
    }
    pump(coordinator);
    return;
  }
  coordinator.dirtyWidth = false;
  coordinator.dirtyVisibilityKeys.clear();
  coordinator.writeAttempts = 0;
  coordinator.writeBlocked = false;
  coordinator.latestSnapshot = rebased.record;
  if (
    token.chain.length > 0
    && coordinator.attachmentToken === token.attachment
    && canCommitUi(coordinator)
    && coordinator.statePort.commitPromotions({
      expectedDurableRevision: token.revision,
      promotions: token.chain,
    })
  ) {
    coordinator.promotions = coordinator.promotions.filter(
      (promotion) => !token.chain.includes(promotion),
    );
  }
  pump(coordinator);
}

export async function runLegacyRemoval(coordinator: Authority): Promise<void> {
  coordinator.busy = true;
  const outcome = await removeFileTreeDockKey(
    coordinator.storage,
    LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY,
  );
  coordinator.busy = false;
  if (outcome.status === "succeeded") {
    coordinator.legacyKeyPending = false;
    coordinator.legacyRemovalAttempts = 0;
    pump(coordinator);
    return;
  }
  // The new record and in-memory state stay authoritative; never roll back.
  coordinator.sink({ operation: "remove-legacy", outcome: "failed" });
  coordinator.legacyRemovalAttempts += 1;
  if (coordinator.legacyRemovalAttempts >= 2) {
    coordinator.legacyRemovalBlocked = true;
    settleIdle(coordinator);
    return;
  }
  pump(coordinator);
}
