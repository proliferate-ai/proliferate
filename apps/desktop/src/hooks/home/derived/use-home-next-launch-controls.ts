import { useMemo } from "react";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents,
  type DesktopAgentLaunchAgent,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { filterTargetReadyLaunchAgents } from "@/lib/domain/agents/target-ready-launch-agents";
import {
  buildLaunchControlDescriptors,
} from "@/lib/domain/chat/models/launch-control-descriptors";
import type {
  LiveSessionControlDescriptor,
  SupportedLiveControlKey,
} from "@/lib/domain/chat/session-controls/session-controls";
import type { HomeNextModelSelection } from "@/lib/domain/home/home-next-launch";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

const EMPTY_AGENTS: DesktopAgentLaunchAgent[] = [];

interface UseHomeNextLaunchControlsArgs {
  modelSelection: HomeNextModelSelection | null;
  modeId: string | null;
  controlOverrides: Record<string, string>;
  onSelectControl: (controlKey: string, value: string) => void;
}

export function useHomeNextLaunchControls({
  modelSelection,
  modeId,
  controlOverrides,
  onSelectControl,
}: UseHomeNextLaunchControlsArgs): {
  controls: LiveSessionControlDescriptor[];
  launchControlValues: Record<string, string>;
  isLoading: boolean;
} {
  const cloudCatalogQuery = useCloudAgentCatalog(Boolean(modelSelection));
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery();
  const agentCatalog = useAgentCatalog();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      state.defaultLiveSessionControlValuesByAgentKind,
  })));

  const launchAgents = useMemo(
    () => filterTargetReadyLaunchAgents(
      mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
        cloudCatalogQuery.data?.agents ?? EMPTY_AGENTS,
        runtimeLaunchOptions.data?.agents ?? null,
      ),
      agentCatalog.agentsByKind,
    ),
    [
      agentCatalog.agentsByKind,
      cloudCatalogQuery.data?.agents,
      runtimeLaunchOptions.data?.agents,
    ],
  );

  const effectivePreferences = useMemo(() => {
    if (!modelSelection) {
      return preferences;
    }

    return {
      defaultSessionModeByAgentKind: modeId
        ? {
          ...preferences.defaultSessionModeByAgentKind,
          [modelSelection.kind]: modeId,
        }
        : preferences.defaultSessionModeByAgentKind,
      defaultLiveSessionControlValuesByAgentKind: {
        ...preferences.defaultLiveSessionControlValuesByAgentKind,
        [modelSelection.kind]: {
          ...preferences.defaultLiveSessionControlValuesByAgentKind[modelSelection.kind],
          ...controlOverrides,
        },
      },
    };
  }, [controlOverrides, modeId, modelSelection, preferences]);

  const descriptors = useMemo(
    () => buildLaunchControlDescriptors({
      selection: modelSelection,
      launchAgents,
      pendingConfigChanges: null,
      preferences: effectivePreferences,
      onSelect: (
        _agentKind: string,
        _controlKey: SupportedLiveControlKey,
        rawConfigId: string,
        value: string,
      ) => {
        onSelectControl(rawConfigId, value);
      },
    }),
    [effectivePreferences, launchAgents, modelSelection, onSelectControl],
  );

  const launchControlValues = useMemo(
    () => selectedLaunchControlValues(descriptors),
    [descriptors],
  );

  return {
    // The create-time `mode` field still comes from Home's dedicated mode
    // selection state. Collaboration mode is a distinct live-default control
    // and must remain available to the shared composer grouping.
    controls: descriptors.filter((control) => control.key !== "mode"),
    launchControlValues,
    isLoading: cloudCatalogQuery.isLoading || runtimeLaunchOptions.isLoading,
  };
}

function selectedLaunchControlValues(
  controls: LiveSessionControlDescriptor[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of controls) {
    const selected = control.options.find((option) => option.selected);
    if (selected?.value) {
      values[control.rawConfigId] = selected.value;
    }
  }
  return values;
}
