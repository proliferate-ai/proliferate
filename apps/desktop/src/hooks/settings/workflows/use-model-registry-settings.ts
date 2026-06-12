import { useMemo } from "react";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { useCloudLaunchModelRegistries } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import {
  buildSettingsAgentDefaultRows,
} from "@/lib/domain/settings/agent-defaults";
import {
  mergeRuntimeLaunchOptionsIntoModelRegistries,
  orderSettingsAgentDefaultRows,
} from "@/lib/domain/settings/model-registries";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import type { DesktopLaunchModelRegistry } from "@/lib/domain/agents/cloud-launch-catalog";

const EMPTY_MODEL_REGISTRIES: DesktopLaunchModelRegistry[] = [];

export function useModelRegistrySettings() {
  const { connectionState, runtimeError } = useHarnessConnectionStore(useShallow((state) => ({
    connectionState: state.connectionState,
    runtimeError: state.error,
  })));
  const {
    data: cloudModelRegistries = EMPTY_MODEL_REGISTRIES,
    isLoading: modelRegistriesLoading,
  } = useCloudLaunchModelRegistries();
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery({
    enabled: connectionState !== "failed",
  });
  const {
    agents,
    agentsNeedingSetup,
    isLoading: agentsLoading,
    isReconciling,
    readyAgentKinds,
    reconcileResultsByKind,
  } = useAgentCatalog();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    chatModelVisibilityOverridesByAgentKind:
      state.chatModelVisibilityOverridesByAgentKind,
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      state.defaultLiveSessionControlValuesByAgentKind,
    set: state.set,
    setMultiple: state.setMultiple,
  })));

  const modelRegistries = useMemo(
    () => mergeRuntimeLaunchOptionsIntoModelRegistries(
      cloudModelRegistries,
      runtimeLaunchOptions.data?.agents ?? null,
    ),
    [cloudModelRegistries, runtimeLaunchOptions.data?.agents],
  );
  const agentDefaultRows = useMemo(
    () => buildSettingsAgentDefaultRows({
      modelRegistries,
      readyAgentKinds,
      preferences,
    }),
    [modelRegistries, preferences, readyAgentKinds],
  );
  const orderedAgentDefaultRows = useMemo(
    () => orderSettingsAgentDefaultRows(agentDefaultRows),
    [agentDefaultRows],
  );
  const primaryHarnessLabel =
    agentDefaultRows.find((row) => row.isPrimary)?.displayName ?? "Choose harness";

  return {
    connectionState,
    runtimeError,
    agents,
    agentsNeedingSetup,
    agentsLoading,
    isReconciling,
    reconcileResultsByKind,
    modelRegistries,
    modelRegistriesLoading,
    runtimeLaunchOptions,
    preferences,
    agentDefaultRows,
    orderedAgentDefaultRows,
    primaryHarnessLabel,
  };
}
