import { useCallback, useMemo } from "react";
import {
  buildLiveSessionControlDescriptors,
  type LiveSessionControlDescriptor,
} from "@/lib/domain/chat/session-controls/session-controls";
import {
  buildComposerSessionControlGroups,
  filterComposerSessionControlsForSurface,
} from "@/lib/domain/chat/session-controls/composer-control-groups";
import { useSessionConfigActions } from "@/hooks/sessions/workflows/use-session-config-actions";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/derived/use-workspace-surface-lookup";
import { useToastStore } from "@/stores/toast/toast-store";
import { useActiveSessionConfigState } from "@/hooks/chat/derived/use-active-session-config-state";

const EMPTY_CONTROLS: LiveSessionControlDescriptor[] = [];

export function useChatSessionControls(): {
  agentKind: string | null;
  controls: LiveSessionControlDescriptor[];
  modeControl: LiveSessionControlDescriptor | null;
} {
  const activeSessionConfig = useActiveSessionConfigState();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const showToast = useToastStore((state) => state.show);
  const { setActiveSessionConfigOption } = useSessionConfigActions();

  const onSelect = useCallback((rawConfigId: string, value: string) => {
    void setActiveSessionConfigOption(rawConfigId, value).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to update session config: ${message}`);
    });
  }, [setActiveSessionConfigOption, showToast]);

  const controls = useMemo(() => {
    if (!activeSessionConfig.normalizedControls) {
      return EMPTY_CONTROLS;
    }

    const nextControls = buildLiveSessionControlDescriptors(
      activeSessionConfig.normalizedControls,
      activeSessionConfig.pendingConfigChanges,
      onSelect,
    );
    return filterComposerSessionControlsForSurface(
      nextControls,
      getWorkspaceSurface(activeSessionConfig.workspaceId),
    );
  }, [
    activeSessionConfig.normalizedControls,
    activeSessionConfig.pendingConfigChanges,
    activeSessionConfig.workspaceId,
    getWorkspaceSurface,
    onSelect,
  ]);

  const modeControl = useMemo(
    () => buildComposerSessionControlGroups(controls).modeControl,
    [controls],
  );

  return {
    agentKind: activeSessionConfig.agentKind,
    controls,
    modeControl,
  };
}
