import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
  HomeNextRepositorySelection,
} from "#product/lib/domain/home/home-next-launch";
import {
  readPersistedJson,
  writePersistedJson,
  type ProductStorageContext,
} from "#product/lib/infra/persistence/product-storage";

export const HOME_NEXT_TARGET_SELECTION_STORAGE_KEY = "home_next_target_selection.v1";

export interface HomeNextTargetSelectionState {
  destination: HomeNextDestination;
  repositorySelection: HomeNextRepositorySelection;
  repoLaunchKind: HomeNextRepoLaunchKind;
  baseBranchOverride: string | null;
}

type HomeNextTargetSelectionPatch = Partial<HomeNextTargetSelectionState>;

const DEFAULT_HOME_NEXT_TARGET_SELECTION: HomeNextTargetSelectionState = {
  destination: "cowork",
  repositorySelection: { kind: "auto" },
  repoLaunchKind: "worktree",
  baseBranchOverride: null,
};
const homeNextTargetSelectionListeners = new Set<() => void>();
// In-memory cache is authoritative for the synchronous `useSyncExternalStore`
// snapshot; ProductStorage is the async persistence backend injected once at the
// product lifecycle mount (see `useHomeNextTargetSelectionPersistence`). Writes
// update the cache + notify listeners synchronously and persist best-effort.
let cachedHomeNextTargetSelection = DEFAULT_HOME_NEXT_TARGET_SELECTION;
let hasUserWritten = false;
let storageContext: ProductStorageContext | null = null;

export function setHomeNextTargetSelectionStorageContext(
  context: ProductStorageContext | null,
): void {
  storageContext = context;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDestination(value: unknown): HomeNextDestination {
  return value === "repository" || value === "cowork"
    ? value
    : DEFAULT_HOME_NEXT_TARGET_SELECTION.destination;
}

function normalizeRepoLaunchKind(value: unknown): HomeNextRepoLaunchKind {
  return value === "worktree" || value === "local" || value === "cloud"
    ? value
    : DEFAULT_HOME_NEXT_TARGET_SELECTION.repoLaunchKind;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRepositorySelection(value: unknown): HomeNextRepositorySelection {
  if (!isRecord(value)) {
    return DEFAULT_HOME_NEXT_TARGET_SELECTION.repositorySelection;
  }
  if (value.kind === "none") {
    return { kind: "none" };
  }
  if (value.kind === "repository") {
    const sourceRoot = normalizeNullableString(value.sourceRoot);
    if (sourceRoot) {
      return { kind: "repository", sourceRoot };
    }
  }
  return { kind: "auto" };
}

export function normalizeHomeNextTargetSelectionState(
  value: unknown,
): HomeNextTargetSelectionState {
  if (!isRecord(value)) {
    return DEFAULT_HOME_NEXT_TARGET_SELECTION;
  }

  return {
    destination: normalizeDestination(value.destination),
    repositorySelection: normalizeRepositorySelection(value.repositorySelection),
    repoLaunchKind: normalizeRepoLaunchKind(value.repoLaunchKind),
    baseBranchOverride: normalizeNullableString(value.baseBranchOverride),
  };
}

function normalizeDesktopTargetAvailability(
  selection: HomeNextTargetSelectionState,
  desktopTargetsAvailable: boolean,
): HomeNextTargetSelectionState {
  if (desktopTargetsAvailable) {
    // Cloud compute is culled from Desktop (PRO-10). A selection persisted
    // before the cull (or hydrated from a shared store) may still carry
    // `repoLaunchKind: "cloud"`; coerce it to "worktree" here at the
    // selection source so every downstream reader (derived state, pickers)
    // sees a desktop-valid launch kind instead of relying on display-only
    // coercion further downstream.
    return selection.repoLaunchKind === "cloud"
      ? { ...selection, repoLaunchKind: "worktree" }
      : selection;
  }
  if (
    selection.destination === "repository"
    && selection.repoLaunchKind === "cloud"
  ) {
    return selection;
  }
  return {
    ...selection,
    destination: "repository",
    repoLaunchKind: "cloud",
  };
}

function persistTargetSelection(selection: HomeNextTargetSelectionState): void {
  hasUserWritten = true;
  cachedHomeNextTargetSelection = selection;

  if (storageContext) {
    void writePersistedJson(
      storageContext,
      HOME_NEXT_TARGET_SELECTION_STORAGE_KEY,
      selection,
    );
  }

  for (const listener of homeNextTargetSelectionListeners) {
    listener();
  }
}

export function readHomeNextTargetSelectionState(): HomeNextTargetSelectionState {
  return cachedHomeNextTargetSelection;
}

/**
 * One-shot hydration of the persisted target selection through the injected
 * ProductStorage into the in-memory cache. A read that resolves after the user
 * already changed the selection (or after unmount, via `isStale`) is ignored so
 * a late read never overwrites live state.
 */
export async function hydrateHomeNextTargetSelection(
  context: ProductStorageContext,
  isStale?: () => boolean,
): Promise<void> {
  const result = await readPersistedJson<HomeNextTargetSelectionState>(
    context,
    HOME_NEXT_TARGET_SELECTION_STORAGE_KEY,
    {
      parse: (raw) => normalizeHomeNextTargetSelectionState(raw),
      fallback: DEFAULT_HOME_NEXT_TARGET_SELECTION,
      isStale,
    },
  );
  if (result.status !== "settled" || hasUserWritten) {
    return;
  }
  cachedHomeNextTargetSelection = result.value;
  for (const listener of homeNextTargetSelectionListeners) {
    listener();
  }
}

export function resetHomeNextTargetSelectionForTests(): void {
  storageContext = null;
  hasUserWritten = false;
  cachedHomeNextTargetSelection = DEFAULT_HOME_NEXT_TARGET_SELECTION;
}

/**
 * Test-only seam: seeds the in-memory selection cache as if it had just been
 * hydrated from persisted storage, without going through the async
 * `hydrateHomeNextTargetSelection` path. Lets tests exercise
 * `normalizeDesktopTargetAvailability` (e.g. a stale persisted
 * `repoLaunchKind: "cloud"`) at the hook layer.
 */
export function cachedHomeNextTargetSelectionForTests(
  selection: HomeNextTargetSelectionState,
): void {
  cachedHomeNextTargetSelection = selection;
  for (const listener of homeNextTargetSelectionListeners) {
    listener();
  }
}

export function subscribeHomeNextTargetSelectionState(listener: () => void): () => void {
  homeNextTargetSelectionListeners.add(listener);
  return () => {
    homeNextTargetSelectionListeners.delete(listener);
  };
}

function useHomeNextTargetSelectionForHost() {
  const desktopTargetsAvailable = useProductHost().desktop !== null;
  const storedTargetSelection = useSyncExternalStore(
    subscribeHomeNextTargetSelectionState,
    readHomeNextTargetSelectionState,
    () => DEFAULT_HOME_NEXT_TARGET_SELECTION,
  );
  const targetSelection = useMemo(
    () => normalizeDesktopTargetAvailability(
      storedTargetSelection,
      desktopTargetsAvailable,
    ),
    [desktopTargetsAvailable, storedTargetSelection],
  );

  return { desktopTargetsAvailable, targetSelection };
}

export function useHomeNextTargetSelectionSnapshot(): HomeNextTargetSelectionState {
  return useHomeNextTargetSelectionForHost().targetSelection;
}

export function useHomeNextTargetSelectionState() {
  const { desktopTargetsAvailable, targetSelection } =
    useHomeNextTargetSelectionForHost();

  const patchTargetSelection = useCallback((patch: HomeNextTargetSelectionPatch) => {
    const next = normalizeDesktopTargetAvailability(
      normalizeHomeNextTargetSelectionState({
        ...readHomeNextTargetSelectionState(),
        ...patch,
      }),
      desktopTargetsAvailable,
    );
    persistTargetSelection(next);
  }, [desktopTargetsAvailable]);

  return {
    ...targetSelection,
    desktopTargetsAvailable,
    patchTargetSelection,
    setDestination: useCallback(
      (destination: HomeNextDestination) => patchTargetSelection({ destination }),
      [patchTargetSelection],
    ),
    setRepositorySelection: useCallback(
      (repositorySelection: HomeNextRepositorySelection) =>
        patchTargetSelection({ repositorySelection }),
      [patchTargetSelection],
    ),
    setRepoLaunchKind: useCallback(
      (repoLaunchKind: HomeNextRepoLaunchKind) => patchTargetSelection({ repoLaunchKind }),
      [patchTargetSelection],
    ),
    setBaseBranchOverride: useCallback(
      (baseBranchOverride: string | null) => patchTargetSelection({ baseBranchOverride }),
      [patchTargetSelection],
    ),
  };
}
