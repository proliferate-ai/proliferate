import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  buildLaunchProjection,
  type LaunchProjection,
  type LaunchProjectionSourceKind,
} from "@/lib/domain/chat/launch-projection";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/workspace-ui-key";
import { isPendingSessionId } from "@/lib/integrations/anyharness/session-runtime";
import {
  configuredWorkspaceProjectionScope,
  pendingWorkspaceProjectionScope,
  useLaunchProjectionOverrideStore,
} from "@/stores/chat/launch-projection-override-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { useActiveSessionLaunchState } from "./use-active-chat-session-selectors";
import { useChatLaunchCatalog } from "./use-chat-launch-catalog";

export function useChatLaunchProjection(): LaunchProjection | null {
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const activeModeId = useHarnessStore((state) => {
    const activeSessionId = state.activeSessionId;
    return activeSessionId ? state.sessionSlots[activeSessionId]?.modeId ?? null : null;
  });
  const {
    activeSessionId,
    currentLaunchIdentity,
  } = useActiveSessionLaunchState();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultLiveSessionControlValuesByAgentKind:
      state.defaultLiveSessionControlValuesByAgentKind,
  })));
  const launchCatalog = useChatLaunchCatalog({
    activeSelection: currentLaunchIdentity,
  });

  const scope = useMemo((): {
    sourceKind: LaunchProjectionSourceKind;
    scopeId: string;
  } | null => {
    if (activeSessionId && isPendingSessionId(activeSessionId)) {
      return {
        sourceKind: "pending-session",
        scopeId: activeSessionId,
      };
    }

    if (pendingWorkspaceEntry && pendingWorkspaceEntry.stage !== "failed") {
      return {
        sourceKind: "pending-workspace",
        scopeId: pendingWorkspaceProjectionScope(pendingWorkspaceEntry.attemptId),
      };
    }

    const workspaceKey = resolveWorkspaceUiKey(
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    );
    if (!activeSessionId && workspaceKey) {
      return {
        sourceKind: "configured-default",
        scopeId: configuredWorkspaceProjectionScope(workspaceKey),
      };
    }

    return null;
  }, [
    activeSessionId,
    pendingWorkspaceEntry,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  ]);

  const override = useLaunchProjectionOverrideStore((state) =>
    scope ? state.overrides[scope.scopeId] ?? null : null,
  );

  return useMemo(() => {
    if (!scope) {
      return null;
    }

    return buildLaunchProjection({
      sourceKind: scope.sourceKind,
      scopeId: scope.scopeId,
      selection: currentLaunchIdentity ?? launchCatalog.selectedLaunchSelection,
      modeId: activeModeId,
      launchAgents: launchCatalog.launchAgents,
      modelRegistries: launchCatalog.modelRegistries,
      storedDefaults: preferences.defaultLiveSessionControlValuesByAgentKind,
      override,
    });
  }, [
    activeModeId,
    currentLaunchIdentity,
    launchCatalog.launchAgents,
    launchCatalog.modelRegistries,
    launchCatalog.selectedLaunchSelection,
    override,
    preferences.defaultLiveSessionControlValuesByAgentKind,
    scope,
  ]);
}
