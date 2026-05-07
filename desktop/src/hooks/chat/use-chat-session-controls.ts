import { useCallback, useMemo } from "react";
import {
  buildLiveSessionControlDescriptors,
  type LiveSessionControlDescriptor,
} from "@/lib/domain/chat/session-controls/session-controls";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/use-workspace-surface-lookup";
import { useToastStore } from "@/stores/toast/toast-store";
import { useActiveSessionConfigState } from "./use-active-chat-session-selectors";

const EMPTY_CONTROLS: LiveSessionControlDescriptor[] = [];

export function useChatSessionControls(): {
  agentKind: string | null;
  controls: LiveSessionControlDescriptor[];
  modeControl: LiveSessionControlDescriptor | null;
} {
  const activeSessionConfig = useActiveSessionConfigState();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const showToast = useToastStore((state) => state.show);
  const { setActiveSessionConfigOption } = useSessionActions();

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
    if (getWorkspaceSurface(activeSessionConfig.workspaceId) !== "cowork") {
      return nextControls;
    }

    // Cowork hides both permission mode controls and always uses product-defined
    // defaults for new sessions instead of user-managed mode preferences.
    return nextControls.filter((control) =>
      control.key !== "mode" && control.key !== "collaboration_mode"
    );
  }, [
    activeSessionConfig.normalizedControls,
    activeSessionConfig.pendingConfigChanges,
    activeSessionConfig.workspaceId,
    getWorkspaceSurface,
    onSelect,
  ]);

  const modeControl = useMemo(
    () =>
      controls.find((control) => control.key === "collaboration_mode")
      ?? controls.find((control) => control.key === "mode")
      ?? null,
    [controls],
  );

  return {
    agentKind: activeSessionConfig.agentKind,
    controls,
    modeControl,
  };
}
