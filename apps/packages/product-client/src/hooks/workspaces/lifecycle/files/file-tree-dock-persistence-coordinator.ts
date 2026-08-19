import type { ProductStorage } from "@proliferate/product-client/host/product-host";
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
import type {
  FileTreeVisibilityKeys,
  FileTreeVisibilityPromotion,
} from "#product/stores/editor/file-tree-store";

/**
 * The docked file tree's persistence authority, keyed **only** by the injected
 * `ProductStorage` object identity — never by `ProductHost`,
 * `ProductStorageContext`, or any telemetry object. One coordinator per storage
 * identity owns the required-read gate, authority-local record revision, field
 * dirty markers and latest full snapshot, promotion transform chain, bounded
 * retry state, the single-operation lane, the UI attachment token, and the
 * replaceable diagnostic sink. A different storage identity is a disjoint
 * backing authority whose completions can never commit into its UI.
 */
export type FileTreeDockDiagnosticOperation =
  | "read-current"
  | "read-legacy"
  | "write"
  | "remove-legacy";

export interface FileTreeDockDiagnosticEvent {
  operation: FileTreeDockDiagnosticOperation;
  outcome: "failed";
}

/** Bounded categorical diagnostics: never a payload, key, path, or identifier. */
export type FileTreeDockDiagnosticSink = (event: FileTreeDockDiagnosticEvent) => void;

export interface FileTreeDockDurableFields {
  desiredWidth: number;
  requestedVisibilityByWorkspace: Readonly<Record<string, boolean>>;
}

/** The synchronous UI state seam. Implemented over the file-tree Zustand store. */
export interface FileTreeDockStatePort {
  getDurableRevision: () => number;
  getDurableSnapshot: () => PersistedFileTreeDockV1;
  prepareVisibilityPromotion: (
    keys: FileTreeVisibilityKeys,
  ) => FileTreeVisibilityPromotion | null;
  replaceAuthorityState: (
    input: FileTreeDockDurableFields & { durableRevision: number },
  ) => void;
  applyHydratedState: (
    input: FileTreeDockDurableFields & { expectedDurableRevision: number },
  ) => boolean;
  commitPromotions: (input: {
    expectedDurableRevision: number;
    promotions: readonly FileTreeVisibilityPromotion[];
  }) => boolean;
}

export interface FileTreeDockDurableMutation {
  revision: number;
  snapshot: PersistedFileTreeDockV1;
  widthChanged: boolean;
  changedVisibilityKeys: readonly string[];
}

export interface FileTreeDockAttachment {
  detach: () => void;
  noteDurableMutation: (mutation: FileTreeDockDurableMutation) => void;
  ensureRequestedVisibilityPromotion: (keys: FileTreeVisibilityKeys) => void;
  /** Resolves once this authority's lane has no runnable work left. */
  idle: () => Promise<void>;
  /** Read-only view of this authority's lane state, for focused tests. */
  inspect: () => Readonly<FileTreeDockCoordinatorState>;
}

type ReadPhase = "unread" | "pending" | "clear" | "blocked";

export interface FileTreeDockCoordinatorState {
  storage: ProductStorage;
  sink: FileTreeDockDiagnosticSink;
  statePort: FileTreeDockStatePort | null;
  attached: boolean;
  attachmentToken: number;
  preparingPromotion: boolean;
  readPhase: ReadPhase;
  readAttempts: number;
  legacyReadAttempts: number;
  recordRevision: number;
  dirtyWidth: boolean;
  dirtyVisibilityKeys: Set<string>;
  latestSnapshot: PersistedFileTreeDockV1;
  promotions: FileTreeVisibilityPromotion[];
  promotionCandidate: FileTreeVisibilityKeys | null;
  busy: boolean;
  pendingWrite: boolean;
  writeAttempts: number;
  writeBlocked: boolean;
  newRecordWritten: boolean;
  legacyKeyPending: boolean;
  legacyRemovalAttempts: number;
  legacyRemovalBlocked: boolean;
  idleResolvers: (() => void)[];
}

type Authority = FileTreeDockCoordinatorState;

let registry = new WeakMap<ProductStorage, Authority>();
let activeAuthority: ProductStorage | null = null;

export function attachFileTreeDockPersistence(input: {
  storage: ProductStorage;
  statePort: FileTreeDockStatePort;
  sink: FileTreeDockDiagnosticSink;
}): FileTreeDockAttachment {
  const existing = registry.get(input.storage);
  const coordinator = existing ?? createCoordinator(input.storage, input.sink);
  if (!existing) {
    registry.set(input.storage, coordinator);
  }
  // A same-storage refresh/remount replaces only the sink and commit target.
  coordinator.sink = input.sink;
  coordinator.statePort = input.statePort;
  coordinator.attached = true;
  coordinator.attachmentToken += 1;

  if (activeAuthority !== input.storage) {
    activeAuthority = input.storage;
    input.statePort.replaceAuthorityState({
      durableRevision: coordinator.recordRevision,
      desiredWidth: coordinator.latestSnapshot.width,
      requestedVisibilityByWorkspace:
        coordinator.latestSnapshot.requestedVisibilityByWorkspace,
    });
  }

  // A same-authority remount begins a fresh bounded cycle for retained work.
  resetBoundedRetries(coordinator);

  const token = coordinator.attachmentToken;
  if (coordinator.readPhase === "clear") {
    pump(coordinator);
  } else {
    ensureReadCycle(coordinator);
  }

  return {
    detach: () => {
      if (coordinator.attachmentToken === token) {
        coordinator.attached = false;
      }
    },
    noteDurableMutation: (mutation) => noteDurableMutation(coordinator, mutation),
    ensureRequestedVisibilityPromotion: (keys) => ensurePromotion(coordinator, keys),
    idle: () =>
      new Promise<void>((resolve) => {
        if (!hasRunnableWork(coordinator)) {
          resolve();
          return;
        }
        coordinator.idleResolvers.push(resolve);
      }),
    inspect: () => coordinator,
  };
}

export function resetFileTreeDockPersistenceForTests(): void {
  registry = new WeakMap<ProductStorage, Authority>();
  activeAuthority = null;
}

function createCoordinator(storage: ProductStorage, sink: FileTreeDockDiagnosticSink): Authority {
  return {
    storage,
    sink,
    statePort: null,
    attached: false,
    attachmentToken: 0,
    preparingPromotion: false,
    readPhase: "unread",
    readAttempts: 0,
    legacyReadAttempts: 0,
    recordRevision: 0,
    dirtyWidth: false,
    dirtyVisibilityKeys: new Set<string>(),
    latestSnapshot: defaultFileTreeDockRecord(),
    promotions: [],
    promotionCandidate: null,
    busy: false,
    pendingWrite: false,
    writeAttempts: 0,
    writeBlocked: false,
    newRecordWritten: false,
    legacyKeyPending: false,
    legacyRemovalAttempts: 0,
    legacyRemovalBlocked: false,
    idleResolvers: [],
  };
}

function canCommitUi(
  coordinator: Authority,
): coordinator is Authority & { statePort: FileTreeDockStatePort } {
  // Detached lifecycles and superseded storage authorities never commit UI.
  return (
    coordinator.attached
    && coordinator.statePort !== null
    && activeAuthority === coordinator.storage
  );
}

function noteDurableMutation(coordinator: Authority, mutation: FileTreeDockDurableMutation): void {
  coordinator.recordRevision = Math.max(coordinator.recordRevision, mutation.revision);
  if (mutation.widthChanged) {
    coordinator.dirtyWidth = true;
  }
  for (const key of mutation.changedVisibilityKeys) {
    coordinator.dirtyVisibilityKeys.add(key);
  }
  coordinator.latestSnapshot = mutation.snapshot;
  coordinator.promotions = rebasePromotions(
    mutation.snapshot,
    coordinator.promotions,
  ).chain;
  if (coordinator.preparingPromotion) {
    // `prepareVisibilityPromotion` relays its revision bump synchronously;
    // `ensurePromotion` finishes the transform and pumps once.
    return;
  }
  coordinator.pendingWrite = true;
  resetBoundedRetries(coordinator);
  if (coordinator.readPhase === "clear") {
    pump(coordinator);
    return;
  }
  // A mutation may start a new read cycle but can never bypass the read gate.
  ensureReadCycle(coordinator);
}

function ensurePromotion(coordinator: Authority, keys: FileTreeVisibilityKeys): void {
  if (!canCommitUi(coordinator)) {
    return;
  }
  const { primaryKey, fallbackKey } = keys;
  if (!primaryKey || !fallbackKey || primaryKey === fallbackKey) {
    coordinator.promotionCandidate = null;
    return;
  }
  // Retained so the attempt repeats once required reads hydrate the fallback.
  coordinator.promotionCandidate = keys;
  const pending = coordinator.promotions.some(
    (promotion) =>
      promotion.primaryKey === primaryKey && promotion.fallbackKey === fallbackKey,
  );
  if (pending) {
    return;
  }
  coordinator.preparingPromotion = true;
  let prepared: FileTreeVisibilityPromotion | null;
  try {
    prepared = coordinator.statePort.prepareVisibilityPromotion(keys);
  } finally {
    coordinator.preparingPromotion = false;
  }
  if (!prepared) {
    return;
  }
  coordinator.promotions.push(prepared);
  coordinator.recordRevision = Math.max(
    coordinator.recordRevision,
    prepared.introducedRevision,
  );
  coordinator.dirtyVisibilityKeys.add(prepared.primaryKey);
  coordinator.dirtyVisibilityKeys.add(prepared.fallbackKey);
  coordinator.latestSnapshot = coordinator.statePort.getDurableSnapshot();
  coordinator.pendingWrite = true;
  resetBoundedRetries(coordinator);
  if (coordinator.readPhase === "clear") {
    pump(coordinator);
    return;
  }
  ensureReadCycle(coordinator);
}

function resetBoundedRetries(coordinator: Authority): void {
  coordinator.writeAttempts = 0;
  coordinator.writeBlocked = false;
  coordinator.legacyRemovalAttempts = 0;
  coordinator.legacyRemovalBlocked = false;
}

/**
 * Reduce the ordered transform chain over the newest unpromoted snapshot in
 * preparation order: a transform survives only while its primary is absent and
 * its fallback still carries the captured value in the progressively
 * transformed state, so a superseded pair drops out and a second distinct pair
 * composes with the first.
 */
function rebasePromotions(
  snapshot: PersistedFileTreeDockV1,
  promotions: readonly FileTreeVisibilityPromotion[],
): { record: PersistedFileTreeDockV1; chain: FileTreeVisibilityPromotion[] } {
  const map: Record<string, boolean> = { ...snapshot.requestedVisibilityByWorkspace };
  const chain: FileTreeVisibilityPromotion[] = [];
  for (const promotion of promotions) {
    if (
      hasOwnKey(map, promotion.primaryKey)
      || !hasOwnKey(map, promotion.fallbackKey)
      || map[promotion.fallbackKey] !== promotion.value
    ) {
      continue;
    }
    map[promotion.primaryKey] = promotion.value;
    delete map[promotion.fallbackKey];
    chain.push(promotion);
  }
  return {
    record: {
      version: 1,
      width: snapshot.width,
      requestedVisibilityByWorkspace: map,
    },
    chain,
  };
}

function hasRunnableWork(coordinator: Authority): boolean {
  if (coordinator.busy || coordinator.readPhase === "pending") {
    return true;
  }
  if (coordinator.readPhase !== "clear") {
    return false;
  }
  if (coordinator.pendingWrite && !coordinator.writeBlocked) {
    return true;
  }
  return (
    coordinator.legacyKeyPending
    && coordinator.newRecordWritten
    && !coordinator.legacyRemovalBlocked
  );
}

function settleIdle(coordinator: Authority): void {
  if (hasRunnableWork(coordinator)) {
    return;
  }
  const resolvers = coordinator.idleResolvers;
  coordinator.idleResolvers = [];
  for (const resolve of resolvers) {
    resolve();
  }
}

/** At most one noncancelable storage operation runs in an authority's lane. */
function pump(coordinator: Authority): void {
  if (coordinator.busy) {
    return;
  }
  if (coordinator.readPhase === "clear") {
    if (coordinator.pendingWrite && !coordinator.writeBlocked) {
      void runWrite(coordinator);
      return;
    }
    if (
      coordinator.legacyKeyPending
      && coordinator.newRecordWritten
      && !coordinator.legacyRemovalBlocked
    ) {
      void runLegacyRemoval(coordinator);
      return;
    }
  }
  settleIdle(coordinator);
}

function ensureReadCycle(coordinator: Authority): void {
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

async function runWrite(coordinator: Authority): Promise<void> {
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

async function runLegacyRemoval(coordinator: Authority): Promise<void> {
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
