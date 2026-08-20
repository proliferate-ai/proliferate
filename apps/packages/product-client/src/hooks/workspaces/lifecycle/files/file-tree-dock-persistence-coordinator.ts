import type { ProductStorage } from "@proliferate/product-client/host/product-host";
import {
  defaultFileTreeDockRecord,
  hasOwnKey,
  type PersistedFileTreeDockV1,
} from "#product/lib/domain/files/file-tree-dock-state";
import type {
  FileTreeVisibilityKeys,
  FileTreeVisibilityPromotion,
} from "#product/stores/editor/file-tree-store";
import {
  ensureReadCycle,
  runLegacyRemoval,
  runWrite,
} from "./file-tree-dock-read-write-cycle";

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

export function canCommitUi(
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

export function ensurePromotion(coordinator: Authority, keys: FileTreeVisibilityKeys): void {
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

export function resetBoundedRetries(coordinator: Authority): void {
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
export function rebasePromotions(
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

export function settleIdle(coordinator: Authority): void {
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
export function pump(coordinator: Authority): void {
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
