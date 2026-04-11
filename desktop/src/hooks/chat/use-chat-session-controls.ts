import { useCallback, useMemo } from "react";
import {
  buildLiveSessionControlDescriptors,
  resolveVisibleLiveSessionControlDescriptors,
  type LiveSessionControlDescriptor,
} from "@/lib/domain/chat/session-controls";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSelectedWorkspace } from "@/hooks/workspaces/use-selected-workspace";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_CONTROLS: LiveSessionControlDescriptor[] = [];

export function useChatSessionControls(): {
  agentKind: string | null;
  controls: LiveSessionControlDescriptor[];
  modeControl: LiveSessionControlDescriptor | null;
} {
  const activeSlot = useHarnessStore((state) =>
    state.activeSessionId ? state.sessionSlots[state.activeSessionId] ?? null : null,
  );
  const showToast = useToastStore((state) => state.show);
  const { workspaceSurfaceKind } = useSelectedWorkspace();
  const { setActiveSessionConfigOption } = useSessionActions();

  const onSelect = useCallback((rawConfigId: string, value: string) => {
    void setActiveSessionConfigOption(rawConfigId, value).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to update session config: ${message}`);
    });
  }, [setActiveSessionConfigOption, showToast]);

  const controls = useMemo(() => {
    if (!activeSlot?.liveConfig?.normalizedControls) {
      return EMPTY_CONTROLS;
    }

    const allControls = buildLiveSessionControlDescriptors(
      activeSlot.liveConfig.normalizedControls,
      activeSlot.pendingConfigChanges,
      onSelect,
    );

    return resolveVisibleLiveSessionControlDescriptors(
      workspaceSurfaceKind,
      allControls,
    );
  }, [
    activeSlot?.liveConfig?.normalizedControls,
    activeSlot?.pendingConfigChanges,
    onSelect,
    workspaceSurfaceKind,
  ]);

  const modeControl = useMemo(
    () =>
      controls.find((control) => control.key === "collaboration_mode")
      ?? controls.find((control) => control.key === "mode")
      ?? null,
    [controls],
  );

  return {
    agentKind: activeSlot?.agentKind ?? null,
    controls,
    modeControl,
  };
}
