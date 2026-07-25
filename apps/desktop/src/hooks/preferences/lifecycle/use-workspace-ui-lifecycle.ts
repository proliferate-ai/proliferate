import { useEffect } from "react";
import { migrateWorkspaceUiState } from "@/lib/domain/preferences/workspace-ui/migration";
import {
  WORKSPACE_UI_DEFAULTS,
  type PersistedWorkspaceUiState,
} from "@/lib/domain/preferences/workspace-ui/model";
import {
  getChangedWorkspaceUiStateKeys,
  isNonPersistedWorkspaceUiStateKey,
  selectPersistedWorkspaceUiState,
} from "@/lib/domain/preferences/workspace-ui/persistence";
import { recordMeasurementDiagnostic } from "@/lib/infra/measurement/debug-measurement";
import { isDebugMeasurementEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import {
  readProductStorageJson,
  writeProductStorageJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";

const WORKSPACE_UI_KEY = "workspace_ui";

async function readWorkspaceUiState(context: ProductStorageContext): Promise<{
  state: PersistedWorkspaceUiState;
  didMigrate: boolean;
}> {
  let state: PersistedWorkspaceUiState;
  let didNormalize = false;

  const persisted = await readProductStorageJson<unknown>(
    context,
    WORKSPACE_UI_KEY,
  );
  if (isPlainRecord(persisted)) {
    const normalized = normalizeWorkspaceUiRecord(persisted);
    state = normalized.state;
    didNormalize = normalized.changed;
  } else {
    didNormalize = persisted !== undefined;
    state = {
      archivedWorkspaceIds:
        asStringArray(await readProductStorageJson<unknown>(context, "archivedWorkspaceIds"))
        ?? WORKSPACE_UI_DEFAULTS.archivedWorkspaceIds,
      hiddenRepoRootIds: WORKSPACE_UI_DEFAULTS.hiddenRepoRootIds,
      sidebarOpen: WORKSPACE_UI_DEFAULTS.sidebarOpen,
      sidebarWidth: WORKSPACE_UI_DEFAULTS.sidebarWidth,
      rightPanelDurableByWorkspace: WORKSPACE_UI_DEFAULTS.rightPanelDurableByWorkspace,
      rightPanelMaterializedByWorkspace: WORKSPACE_UI_DEFAULTS.rightPanelMaterializedByWorkspace,
      activeShellTabKeyByWorkspace: WORKSPACE_UI_DEFAULTS.activeShellTabKeyByWorkspace,
      shellTabOrderByWorkspace: WORKSPACE_UI_DEFAULTS.shellTabOrderByWorkspace,
      workspaceTypes: WORKSPACE_UI_DEFAULTS.workspaceTypes,
      lastViewedAt:
        asStringRecord(await readProductStorageJson<unknown>(context, "lastViewedAt"))
        ?? WORKSPACE_UI_DEFAULTS.lastViewedAt,
      lastViewedSessionByWorkspace:
        asStringRecord(await readProductStorageJson<unknown>(
          context,
          "lastViewedSessionByWorkspace",
        ))
        ?? WORKSPACE_UI_DEFAULTS.lastViewedSessionByWorkspace,
      lastViewedSessionErrorAtBySession:
        WORKSPACE_UI_DEFAULTS.lastViewedSessionErrorAtBySession,
      workspaceLastInteracted:
        asStringRecord(await readProductStorageJson<unknown>(
          context,
          "workspaceLastInteracted",
        ))
        ?? WORKSPACE_UI_DEFAULTS.workspaceLastInteracted,
      sessionLastInteracted: WORKSPACE_UI_DEFAULTS.sessionLastInteracted,
      sessionLastViewedAt: WORKSPACE_UI_DEFAULTS.sessionLastViewedAt,
      collapsedRepoGroups: WORKSPACE_UI_DEFAULTS.collapsedRepoGroups,
      showArchived: WORKSPACE_UI_DEFAULTS.showArchived,
      threadsCollapsed: WORKSPACE_UI_DEFAULTS.threadsCollapsed,
      dismissedSetupFailures: WORKSPACE_UI_DEFAULTS.dismissedSetupFailures,
      visibleChatSessionIdsByWorkspace: WORKSPACE_UI_DEFAULTS.visibleChatSessionIdsByWorkspace,
      recentlyHiddenChatSessionIdsByWorkspace:
        WORKSPACE_UI_DEFAULTS.recentlyHiddenChatSessionIdsByWorkspace,
      collapsedChatGroupsByWorkspace: WORKSPACE_UI_DEFAULTS.collapsedChatGroupsByWorkspace,
      manualChatGroupsByWorkspace: WORKSPACE_UI_DEFAULTS.manualChatGroupsByWorkspace,
      gitStatusSnapshotByWorkspace: WORKSPACE_UI_DEFAULTS.gitStatusSnapshotByWorkspace,
    };
  }

  const migrated = migrateWorkspaceUiState(state);
  return {
    state: migrated.state,
    didMigrate: didNormalize || migrated.didMigrate,
  };
}

// Owns loading persisted workspace UI state and syncing store changes to disk.
// Does not own workspace UI actions or shell/tab transitions.
export function useWorkspaceUiLifecycle(): void {
  const persistence = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const startingRevision = useWorkspaceUiStore.getState()._persistenceRevision;

    const bootstrap = async () => {
      const { state, didMigrate } = await readWorkspaceUiState(persistence);
      if (cancelled) {
        return;
      }
      const current = useWorkspaceUiStore.getState();
      const liveStateWon = current._persistenceRevision !== startingRevision;
      const reconciledState = liveStateWon
        ? selectPersistedWorkspaceUiState(current)
        : state;
      current.hydrate(reconciledState);
      // Force-persist migrations even when they were a no-op so the version is
      // saved; a late live record is persisted instead of the loaded snapshot.
      const bootstrapSnapshot = liveStateWon || didMigrate
        ? reconciledState
        : null;

      unsubscribe = useWorkspaceUiStore.subscribe((state, prev) => {
        if (
          !state._hydrated
          || !prev._hydrated
          || state._persistenceRevision === prev._persistenceRevision
        ) {
          return;
        }

        const changedKeys = getChangedWorkspaceUiStateKeys(prev, state);
        if (isDebugMeasurementEnabled() && changedKeys.length > 0) {
          recordMeasurementDiagnostic({
            category: "workspace_ui_store.write",
            label: "top_level_keys",
            keys: changedKeys,
            count: changedKeys.length,
          });
        }

        if (
          changedKeys.length > 0
          && changedKeys.every(isNonPersistedWorkspaceUiStateKey)
        ) {
          return;
        }

        const currentSlice = selectPersistedWorkspaceUiState(state);
        const previousSlice = selectPersistedWorkspaceUiState(prev);
        if (JSON.stringify(currentSlice) !== JSON.stringify(previousSlice)) {
          void writeProductStorageJson(persistence, WORKSPACE_UI_KEY, currentSlice);
        }
      });

      if (bootstrapSnapshot) {
        void writeProductStorageJson(
          persistence,
          WORKSPACE_UI_KEY,
          bootstrapSnapshot,
        );
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [persistence]);
}

function normalizeWorkspaceUiRecord(record: Record<string, unknown>): {
  state: PersistedWorkspaceUiState;
  changed: boolean;
} {
  let changed = false;
  const normalize = <T>(value: unknown, fallback: T, guard: (value: unknown) => value is T): T => {
    if (value === undefined) {
      return fallback;
    }
    if (guard(value)) {
      return value;
    }
    changed = true;
    return fallback;
  };

  const collapsedRepoGroups = record.collapsedRepoGroups === undefined
    ? WORKSPACE_UI_DEFAULTS.collapsedRepoGroups
    : Array.isArray(record.collapsedRepoGroups) || isPlainRecord(record.collapsedRepoGroups)
      ? record.collapsedRepoGroups
      : (() => {
        changed = true;
        return WORKSPACE_UI_DEFAULTS.collapsedRepoGroups;
      })();

  return {
    changed,
    state: {
      ...WORKSPACE_UI_DEFAULTS,
      ...record,
      migrationVersion: normalize(
        record.migrationVersion,
        WORKSPACE_UI_DEFAULTS.migrationVersion,
        isFiniteNumber,
      ),
      archivedWorkspaceIds: normalize(
        record.archivedWorkspaceIds,
        WORKSPACE_UI_DEFAULTS.archivedWorkspaceIds,
        isStringArray,
      ),
      hiddenRepoRootIds: normalize(
        record.hiddenRepoRootIds,
        WORKSPACE_UI_DEFAULTS.hiddenRepoRootIds,
        isStringArray,
      ),
      collapsedRepoGroups: collapsedRepoGroups as string[],
      showArchived: normalize(
        record.showArchived,
        WORKSPACE_UI_DEFAULTS.showArchived,
        isBoolean,
      ),
      threadsCollapsed: normalize(
        record.threadsCollapsed,
        WORKSPACE_UI_DEFAULTS.threadsCollapsed,
        isBoolean,
      ),
      sidebarOpen: normalize(
        record.sidebarOpen,
        WORKSPACE_UI_DEFAULTS.sidebarOpen,
        isBoolean,
      ),
      sidebarWidth: normalize(
        record.sidebarWidth,
        WORKSPACE_UI_DEFAULTS.sidebarWidth,
        isFiniteNumber,
      ),
      workspaceTypes: normalize(
        record.workspaceTypes,
        WORKSPACE_UI_DEFAULTS.workspaceTypes,
        isStringArray,
      ) as PersistedWorkspaceUiState["workspaceTypes"],
      lastViewedAt: normalize(
        record.lastViewedAt,
        WORKSPACE_UI_DEFAULTS.lastViewedAt,
        isStringRecord,
      ),
      lastViewedSessionByWorkspace: normalize(
        record.lastViewedSessionByWorkspace,
        WORKSPACE_UI_DEFAULTS.lastViewedSessionByWorkspace,
        isStringRecord,
      ),
      lastViewedSessionErrorAtBySession: normalize(
        record.lastViewedSessionErrorAtBySession,
        WORKSPACE_UI_DEFAULTS.lastViewedSessionErrorAtBySession,
        isStringRecord,
      ),
      workspaceLastInteracted: normalize(
        record.workspaceLastInteracted,
        WORKSPACE_UI_DEFAULTS.workspaceLastInteracted,
        isStringRecord,
      ),
      sessionLastInteracted: normalize(
        record.sessionLastInteracted,
        WORKSPACE_UI_DEFAULTS.sessionLastInteracted,
        isStringRecord,
      ),
      sessionLastViewedAt: normalize(
        record.sessionLastViewedAt,
        WORKSPACE_UI_DEFAULTS.sessionLastViewedAt,
        isStringRecord,
      ),
      dismissedSetupFailures: normalize(
        record.dismissedSetupFailures,
        WORKSPACE_UI_DEFAULTS.dismissedSetupFailures,
        isBooleanRecord,
      ),
    } as PersistedWorkspaceUiState,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | undefined {
  return isStringArray(value) ? value : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  return isStringRecord(value) ? value : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isPlainRecord(value)
    && Object.values(value).every((entry) => typeof entry === "boolean");
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
