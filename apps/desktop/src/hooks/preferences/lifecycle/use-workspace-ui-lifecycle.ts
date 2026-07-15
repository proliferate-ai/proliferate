import { useEffect } from "react";
import { useProductStorageContext } from "@/hooks/persistence/facade/use-product-storage-context";
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
  readPersistedJsonValue,
  writePersistedJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

const WORKSPACE_UI_KEY = "workspace_ui";

async function readWorkspaceUiState(
  context: ProductStorageContext,
): Promise<{
  state: PersistedWorkspaceUiState;
  didMigrate: boolean;
}> {
  let state: PersistedWorkspaceUiState;

  const persisted =
    await readPersistedJsonValue<PersistedWorkspaceUiState>(context, WORKSPACE_UI_KEY);
  if (persisted) {
    state = {
      ...WORKSPACE_UI_DEFAULTS,
      ...persisted,
    };
  } else {
    state = {
      archivedWorkspaceIds:
        (await readPersistedJsonValue<string[]>(context, "archivedWorkspaceIds"))
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
        (await readPersistedJsonValue<Record<string, string>>(context, "lastViewedAt"))
        ?? WORKSPACE_UI_DEFAULTS.lastViewedAt,
      lastViewedSessionByWorkspace:
        (await readPersistedJsonValue<Record<string, string>>(
          context,
          "lastViewedSessionByWorkspace",
        ))
        ?? WORKSPACE_UI_DEFAULTS.lastViewedSessionByWorkspace,
      lastViewedSessionErrorAtBySession:
        WORKSPACE_UI_DEFAULTS.lastViewedSessionErrorAtBySession,
      workspaceLastInteracted:
        (await readPersistedJsonValue<Record<string, string>>(context, "workspaceLastInteracted"))
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

  return migrateWorkspaceUiState(state);
}

// Owns loading persisted workspace UI state and syncing store changes to disk.
// Does not own workspace UI actions or shell/tab transitions.
export function useWorkspaceUiLifecycle(): void {
  const storage = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const bootstrap = async () => {
      const { state, didMigrate } = await readWorkspaceUiState(storage);
      if (cancelled) {
        return;
      }

      useWorkspaceUiStore.getState().hydrate(state);
      if (didMigrate) {
        // Force-persist so migrationVersion is saved even when the migration
        // itself was a no-op (e.g. workspaceLastInteracted was already empty).
        void writePersistedJson(
          storage,
          WORKSPACE_UI_KEY,
          selectPersistedWorkspaceUiState(useWorkspaceUiStore.getState()),
        );
      }

      unsubscribe = useWorkspaceUiStore.subscribe((state, prev) => {
        if (!state._hydrated || !prev._hydrated) {
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
          void writePersistedJson(storage, WORKSPACE_UI_KEY, currentSlice);
        }
      });
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [storage]);
}
