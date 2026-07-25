import { useCallback, useSyncExternalStore } from "react";
import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
  HomeNextRepositorySelection,
} from "@/lib/domain/home/home-next-launch";

export const HOME_NEXT_TARGET_SELECTION_STORAGE_KEY = "home_next_target_selection.v1";

export interface HomeNextTargetSelectionState {
  destination: HomeNextDestination;
  repositorySelection: HomeNextRepositorySelection;
  repoLaunchKind: HomeNextRepoLaunchKind;
  selectedSshTargetId: string | null;
  baseBranchOverride: string | null;
}

type HomeNextTargetSelectionPatch = Partial<HomeNextTargetSelectionState>;

const DEFAULT_HOME_NEXT_TARGET_SELECTION: HomeNextTargetSelectionState = {
  destination: "cowork",
  repositorySelection: { kind: "auto" },
  repoLaunchKind: "worktree",
  selectedSshTargetId: null,
  baseBranchOverride: null,
};
const homeNextTargetSelectionListeners = new Set<() => void>();
let cachedHomeNextTargetSelection = DEFAULT_HOME_NEXT_TARGET_SELECTION;
let homeNextTargetSelectionRevision = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDestination(value: unknown): HomeNextDestination {
  return value === "repository" || value === "cowork"
    ? value
    : DEFAULT_HOME_NEXT_TARGET_SELECTION.destination;
}

function normalizeRepoLaunchKind(value: unknown): HomeNextRepoLaunchKind {
  return value === "worktree" || value === "local" || value === "cloud" || value === "ssh"
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
    selectedSshTargetId: normalizeNullableString(value.selectedSshTargetId),
    baseBranchOverride: normalizeNullableString(value.baseBranchOverride),
  };
}

function updateTargetSelection(selection: HomeNextTargetSelectionState): void {
  cachedHomeNextTargetSelection = selection;
  homeNextTargetSelectionRevision += 1;
  for (const listener of homeNextTargetSelectionListeners) {
    listener();
  }
}

export function readHomeNextTargetSelectionState(): HomeNextTargetSelectionState {
  return cachedHomeNextTargetSelection;
}

export function readHomeNextTargetSelectionRevision(): number {
  return homeNextTargetSelectionRevision;
}

export function hydrateHomeNextTargetSelectionState(
  value: unknown,
  expectedRevision: number,
): boolean {
  if (homeNextTargetSelectionRevision !== expectedRevision) {
    return false;
  }
  updateTargetSelection(normalizeHomeNextTargetSelectionState(value));
  return true;
}

export function resetHomeNextTargetSelectionForTests(): void {
  updateTargetSelection(DEFAULT_HOME_NEXT_TARGET_SELECTION);
}

export function subscribeHomeNextTargetSelectionState(listener: () => void): () => void {
  homeNextTargetSelectionListeners.add(listener);
  return () => {
    homeNextTargetSelectionListeners.delete(listener);
  };
}

export function useHomeNextTargetSelectionSnapshot(): HomeNextTargetSelectionState {
  return useSyncExternalStore(
    subscribeHomeNextTargetSelectionState,
    readHomeNextTargetSelectionState,
    () => DEFAULT_HOME_NEXT_TARGET_SELECTION,
  );
}

export function useHomeNextTargetSelectionState() {
  const targetSelection = useHomeNextTargetSelectionSnapshot();

  const patchTargetSelection = useCallback((patch: HomeNextTargetSelectionPatch) => {
    const next = normalizeHomeNextTargetSelectionState({
      ...readHomeNextTargetSelectionState(),
      ...patch,
    });
    updateTargetSelection(next);
  }, []);

  return {
    ...targetSelection,
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
    setSelectedSshTargetId: useCallback(
      (selectedSshTargetId: string | null) => patchTargetSelection({ selectedSshTargetId }),
      [patchTargetSelection],
    ),
    setBaseBranchOverride: useCallback(
      (baseBranchOverride: string | null) => patchTargetSelection({ baseBranchOverride }),
      [patchTargetSelection],
    ),
  };
}
