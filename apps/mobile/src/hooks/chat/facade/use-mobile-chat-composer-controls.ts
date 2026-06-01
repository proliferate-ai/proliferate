import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { CloudSessionProjection, CloudWorkspaceDetail } from "@proliferate/cloud-sdk";
import {
  useCloudAgentCatalog,
  useCloudCapabilities,
  useAgentAuthCredentials,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudChatComposerControls,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  getLiveConfigControlValue,
  readSessionLiveConfig,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "@proliferate/product-domain/chats/cloud/harness-availability";

import { summarizeComposerControls } from "../../../lib/domain/chat/mobile-chat-composer-presentation";

export function useMobileChatComposerControls({
  workspace,
  session,
  pendingConfigChanges,
  launchSelection,
  runtimeLabel,
  setLaunchSelection,
  onSubmitSessionConfig,
  onStartNewSession,
}: {
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  pendingConfigChanges: Record<string, PendingConfigChange>;
  launchSelection: CloudLaunchComposerSelection;
  runtimeLabel: string;
  setLaunchSelection: Dispatch<SetStateAction<CloudLaunchComposerSelection>>;
  onSubmitSessionConfig: (rawConfigId: string, value: string) => void;
  onStartNewSession: (selection?: CloudLaunchComposerSelection) => void;
}) {
  const agentCatalog = useCloudAgentCatalog();
  const cloudCapabilities = useCloudCapabilities();
  const agentAuthCredentials = useAgentAuthCredentials();
  const workspaceReadyAgentKindsKey = workspace?.readyAgentKinds?.join("\0") ?? "";
  const workspaceAllowedAgentKindsKey = workspace?.allowedAgentKinds?.join("\0") ?? "";
  const workspaceUsesManagedRuntime =
    !workspace || workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared";
  const agentGateway = cloudCapabilities.data?.agentGateway;
  const readySyncedAgentKinds = useMemo(
    () => readySyncedCloudAgentKinds(agentAuthCredentials.data),
    [agentAuthCredentials.data],
  );
  const readySyncedAgentKindsKey = readySyncedAgentKinds.join("\0");
  const agentGatewayManagedCreditKindsKey = agentGateway?.managedCreditAgentKinds?.join("\0") ?? "";
  const catalogAgentKindsKey = agentCatalog.data?.agents.map((agent) => agent.kind).join("\0") ?? "";
  const workspaceHarnessAvailability = useMemo(() => resolveCloudHarnessAvailability({
    catalogAgentKinds: agentCatalog.data?.agents.map((agent) => agent.kind),
    allowedAgentKinds: workspace?.allowedAgentKinds,
    readyAgentKinds: workspace?.readyAgentKinds
      ?? (workspaceUsesManagedRuntime
        ? readySyncedAgentKinds
        : agentCatalog.data?.agents.map((agent) => agent.kind)),
    agentGateway: workspaceUsesManagedRuntime ? agentGateway : null,
    assumeFallbackAgentKindsLaunchable: !workspaceUsesManagedRuntime,
  }), [
    agentCatalog.data,
    readySyncedAgentKindsKey,
    agentGateway?.enabled,
    agentGateway?.managedCreditsOrganizationEnabled,
    agentGateway?.managedCreditsPersonalEnabled,
    agentGateway?.opencodeGatewayEnabled,
    agentGatewayManagedCreditKindsKey,
    catalogAgentKindsKey,
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    workspaceUsesManagedRuntime,
  ]);
  const workspaceLaunchableAgentKinds = workspaceHarnessAvailability.launchableAgentKinds;
  const canStartNewSession = workspaceLaunchableAgentKinds.length > 0;
  const liveConfig = readSessionLiveConfig(session);
  const sessionModelId = session && liveConfig ? getLiveConfigControlValue(liveConfig, "model") : null;
  const resolvedLaunchSelection = useMemo(
    () => resolveCloudLaunchSelection({
      catalog: agentCatalog.data,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: launchSelection,
    }),
    [agentCatalog.data, launchSelection, workspaceLaunchableAgentKinds],
  );
  const composerControls = buildCloudChatComposerControls({
    session,
    liveConfig,
    pendingConfigChanges,
    launchCatalog: agentCatalog.data,
    launchableAgentKinds: workspaceLaunchableAgentKinds,
    launchSelection: resolvedLaunchSelection,
    launchModelId: resolvedLaunchSelection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
    onLaunchAgentModelSelect: (agentKind, modelId) => {
      setLaunchSelection((current) => ({
        agentKind,
        modelId,
        modeId: current.agentKind === agentKind ? current.modeId : null,
        controlValues: current.agentKind === agentKind ? current.controlValues : {},
      }));
    },
    onLaunchControlSelect: ({ controlKey, value }) => {
      setLaunchSelection((current) => {
        if (controlKey === "mode") {
          return { ...current, modeId: value };
        }
        return {
          ...current,
          controlValues: {
            ...current.controlValues,
            [controlKey]: value,
          },
        };
      });
    },
    onLaunchModelSelect: (modelId) => {
      setLaunchSelection((current) => ({ ...current, modelId }));
    },
    onSessionConfigSelect: (rawConfigId, value) => {
      onSubmitSessionConfig(rawConfigId, value);
    },
    onSessionAgentModelSelect: ({ agentKind, modelId }) => {
      onStartNewSession({
        agentKind,
        modelId,
        modeId: null,
        controlValues: {},
      });
    },
  });

  return {
    agentCatalog,
    workspaceHarnessAvailability,
    workspaceLaunchableAgentKinds,
    canStartNewSession,
    liveConfig,
    sessionModelId,
    resolvedLaunchSelection,
    composerControls,
    composerControlSummary: summarizeComposerControls(composerControls, runtimeLabel),
  };
}
