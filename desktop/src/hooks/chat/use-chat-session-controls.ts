import { useCallback, useMemo } from "react";
import {
  buildLiveSessionControlDescriptors,
  type LiveSessionControlDescriptor,
} from "@/lib/domain/chat/session-controls";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
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

    return buildLiveSessionControlDescriptors(
      activeSlot.liveConfig.normalizedControls,
      activeSlot.pendingConfigChanges,
      onSelect,
    );
  }, [activeSlot?.liveConfig?.normalizedControls, activeSlot?.pendingConfigChanges, onSelect]);

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
