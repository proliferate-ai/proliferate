import { useCallback, useMemo } from "react";
import {
  buildLiveSessionControlDescriptors,
  type LiveSessionControlDescriptor,
  type SupportedLiveControlKey,
} from "#product/lib/domain/chat/session-controls/session-controls";
import {
  buildComposerSessionControlGroups,
  filterComposerSessionControlsForSurface,
} from "#product/lib/domain/chat/session-controls/composer-control-groups";
import { useSessionConfigActions } from "#product/hooks/sessions/workflows/use-session-config-actions";
import { useWorkspaceSurfaceLookup } from "#product/hooks/workspaces/derived/use-workspace-surface-lookup";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useActiveSessionConfigState } from "#product/hooks/chat/derived/use-active-session-config-state";

const EMPTY_CONTROLS: LiveSessionControlDescriptor[] = [];

export function useChatSessionControls(): {
  agentKind: string | null;
  controls: LiveSessionControlDescriptor[];
  modeControl: LiveSessionControlDescriptor | null;
} {
  const activeSessionConfig = useActiveSessionConfigState();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const showErrorToast = useToastStore((state) => state.showError);
  const { setActiveSessionConfigOption } = useSessionConfigActions();

  const onSelect = useCallback(function onSelect(
    controlKey: SupportedLiveControlKey,
    rawConfigId: string,
    value: string,
  ) {
    void setActiveSessionConfigOption(rawConfigId, value, { controlKey }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showErrorToast({
        headline: "Setting not changed",
        // Names the value the user picked: this fires from a composer control
        // whose menu is already closed, so the toast is the only place left
        // that can say which choice did not take.
        consequence: `The session is still on its previous value, not ${value}.`,
        cause: message,
        retry: () => onSelect(controlKey, rawConfigId, value),
      });
    });
  }, [setActiveSessionConfigOption, showErrorToast]);

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
