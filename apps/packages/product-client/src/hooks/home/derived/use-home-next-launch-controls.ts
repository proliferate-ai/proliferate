import { useMemo } from "react";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";
import {
  projectHarnessLaunchOptions,
  type DesktopAgentLaunchAgent,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import {
  buildLaunchControlDescriptors,
} from "#product/lib/domain/chat/models/launch-control-descriptors";
import type {
  LiveSessionControlDescriptor,
  SupportedLiveControlKey,
} from "#product/lib/domain/chat/session-controls/session-controls";
import type { HomeNextModelSelection } from "#product/lib/domain/home/home-next-launch";

const EMPTY_AGENTS: DesktopAgentLaunchAgent[] = [];

interface UseHomeNextLaunchControlsArgs {
  modelSelection: HomeNextModelSelection | null;
  controlOverrides: Record<string, string>;
  onSelectControl: (controlKey: string, value: string) => void;
}

export function useHomeNextLaunchControls({
  modelSelection,
  controlOverrides,
  onSelectControl,
}: UseHomeNextLaunchControlsArgs): {
  controls: LiveSessionControlDescriptor[];
  launchControlValues: Record<string, string>;
  isLoading: boolean;
} {
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery({ harnessKind: modelSelection?.kind });
  const launchAgents = useMemo(
    () => {
      const projected = runtimeLaunchOptions.data
        ? projectHarnessLaunchOptions(runtimeLaunchOptions.data)
        : null;
      return projected ? [projected] : EMPTY_AGENTS;
    },
    [runtimeLaunchOptions.data],
  );

  const descriptors = useMemo(
    () => buildLaunchControlDescriptors({
      selection: modelSelection,
      launchAgents,
      pendingConfigChanges: Object.fromEntries(Object.entries(controlOverrides).map(([key, value]) => [key, {
          rawConfigId: key,
          value,
          status: "settling" as const,
          mutationId: 0,
        }])),
      onSelect: (
        _agentKind: string,
        controlKey: SupportedLiveControlKey,
        _rawConfigId: string,
        value: string,
      ) => {
        // Overrides feed back through defaultLiveSessionControlValuesByAgentKind,
        // which buildLaunchControlDescriptors reads by NORMALIZED key — raw
        // catalog ids (codex `reasoning_effort`) would never round-trip.
        onSelectControl(controlKey, value);
      },
    }),
    [controlOverrides, launchAgents, modelSelection, onSelectControl],
  );

  const launchControlValues = useMemo(
    () => selectedLaunchControlValues(descriptors),
    [descriptors],
  );

  return {
    controls: descriptors,
    launchControlValues,
    isLoading: runtimeLaunchOptions.isLoading,
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
