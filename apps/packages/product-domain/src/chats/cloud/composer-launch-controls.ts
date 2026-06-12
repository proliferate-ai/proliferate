import type { CloudAgentCatalogResponse } from "@proliferate/cloud-sdk";
import type {
  CloudChatComposerControlView,
  CloudLaunchComposerControlSelection,
  CloudLaunchComposerSelection,
  LaunchSessionConfigUpdate,
} from "./composer-control-model";
import {
  buildLaunchAgentModelControl,
  buildLaunchConfigControl,
  fallbackLaunchComposerControls,
  unavailableLaunchComposerControls,
} from "./composer-launch-control-builders";
import {
  defaultLaunchModel,
  launchComposerControls,
  launchableCatalogAgents,
  selectLaunchAgent,
  selectLaunchModel,
  selectedLaunchControlValue,
  shouldShowUnavailableLaunchControls,
} from "./composer-launch-catalog";
import {
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
} from "./composer-launch-defaults";

export { DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS } from "./harness-availability";
export {
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
} from "./composer-launch-defaults";

export function buildCloudLaunchComposerControls(input: {
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  selection: CloudLaunchComposerSelection;
  onAgentModelSelect: (agentKind: string, modelId: string) => void;
  onControlSelect: (selection: CloudLaunchComposerControlSelection) => void;
}): CloudChatComposerControlView[] {
  const catalogAgents = launchableCatalogAgents({
    agents: input.catalog?.agents ?? [],
    launchableAgentKinds: input.launchableAgentKinds,
  });
  if (catalogAgents.length === 0) {
    if (shouldShowUnavailableLaunchControls({
      catalog: input.catalog,
      launchableAgentKinds: input.launchableAgentKinds,
    })) {
      return unavailableLaunchComposerControls();
    }
    return fallbackLaunchComposerControls({
      modelId: input.selection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
      onModelSelect: (modelId) =>
        input.onAgentModelSelect(input.selection.agentKind || DEFAULT_DIRECT_PROMPT_AGENT_KIND, modelId),
    });
  }

  const selectedAgent = selectLaunchAgent(catalogAgents, input.selection.agentKind);
  const modelControl = buildLaunchAgentModelControl({
    agents: catalogAgents,
    selectedAgentKind: selectedAgent?.kind ?? input.selection.agentKind,
    selectedModelId: input.selection.modelId,
    onSelect: input.onAgentModelSelect,
  });
  const configControls = selectedAgent
    ? launchComposerControls(selectedAgent)
      .map((control) => buildLaunchConfigControl({
        agent: selectedAgent,
        control,
        selection: input.selection,
        onSelect: input.onControlSelect,
      }))
    : [];

  return [...configControls, modelControl];
}

export function resolveCloudLaunchSelection(input: {
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  selection: CloudLaunchComposerSelection;
}): CloudLaunchComposerSelection {
  const agents = launchableCatalogAgents({
    agents: input.catalog?.agents ?? [],
    launchableAgentKinds: input.launchableAgentKinds,
  });
  const agent = selectLaunchAgent(agents, input.selection.agentKind);
  if (!agent) {
    if (shouldShowUnavailableLaunchControls({
      catalog: input.catalog,
      launchableAgentKinds: input.launchableAgentKinds,
    })) {
      return {
        ...input.selection,
        agentKind: input.selection.agentKind || "",
        modelId: null,
        modeId: null,
      };
    }
    return {
      ...input.selection,
      agentKind: input.selection.agentKind || DEFAULT_DIRECT_PROMPT_AGENT_KIND,
      modelId: input.selection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
    };
  }
  const modelId = selectLaunchModel(agent, input.selection.modelId)?.id
    ?? defaultLaunchModel(agent)?.id
    ?? agent.session.models[0]?.id
    ?? null;
  const modeControl = launchComposerControls(agent).find((control) =>
    control.createField === "modeId"
  );
  const defaultModeId = modeControl
    ? selectedLaunchControlValue(agent, modeControl, input.selection)
    : input.selection.modeId;

  return {
    ...input.selection,
    agentKind: agent.kind,
    modelId,
    modeId: defaultModeId ?? null,
  };
}

export function buildLaunchSessionConfigUpdates(input: {
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  selection: CloudLaunchComposerSelection;
}): LaunchSessionConfigUpdate[] {
  const agent = selectLaunchAgent(
    launchableCatalogAgents({
      agents: input.catalog?.agents ?? [],
      launchableAgentKinds: input.launchableAgentKinds,
    }),
    input.selection.agentKind,
  );
  if (!agent) {
    return [];
  }
  return launchComposerControls(agent).flatMap((control) => {
    if (control.createField || !control.liveConfigId) {
      return [];
    }
    const value = selectedLaunchControlValue(agent, control, input.selection);
    return value ? [{ configId: control.liveConfigId, value }] : [];
  });
}

export function buildLaunchRunConfigControlValues(input: {
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  selection: CloudLaunchComposerSelection;
}): Record<string, string> {
  const agent = selectLaunchAgent(
    launchableCatalogAgents({
      agents: input.catalog?.agents ?? [],
      launchableAgentKinds: input.launchableAgentKinds,
    }),
    input.selection.agentKind,
  );
  if (!agent) {
    return {};
  }
  const controlValues: Record<string, string> = {};
  for (const control of launchComposerControls(agent)) {
    const value = selectedLaunchControlValue(agent, control, input.selection);
    if (value) {
      controlValues[control.key] = value;
    }
  }
  return controlValues;
}
