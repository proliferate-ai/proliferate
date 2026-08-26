import type { CloudHarnessLaunchOptionsResponse } from "./launch-options-model";
import type {
  CloudChatComposerControlView,
  CloudLaunchComposerControlSelection,
  CloudLaunchComposerSelection,
  LaunchSessionConfigUpdate,
} from "./composer-control-model";
import {
  buildLaunchAgentModelControl,
  buildLaunchConfigControl,
} from "./composer-launch-control-builders";
import {
  launchComposerControls,
  selectLaunchModel,
  selectedLaunchControlValue,
} from "./composer-launch-catalog";
import { DEFAULT_DIRECT_PROMPT_AGENT_KIND } from "./composer-launch-defaults";

export { DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS } from "./harness-availability";
export { DEFAULT_DIRECT_PROMPT_AGENT_KIND } from "./composer-launch-defaults";

export function buildCloudLaunchComposerControls(input: {
  launchOptions?: CloudHarnessLaunchOptionsResponse | null;
  selection: CloudLaunchComposerSelection;
  onAgentModelSelect: (agentKind: string, modelId: string) => void;
  onControlSelect: (selection: CloudLaunchComposerControlSelection) => void;
}): CloudChatComposerControlView[] {
  const response = input.launchOptions;
  if (!response?.options) {
    return [];
  }
  const resolved = resolveCloudLaunchSelection({ launchOptions: response, selection: input.selection });
  const modelControl = buildLaunchAgentModelControl({
    response,
    selectedModelId: resolved.modelId,
    onSelect: input.onAgentModelSelect,
  });
  const configControls = launchComposerControls(response, resolved.modelId).map((control) =>
    buildLaunchConfigControl({
      agentKind: response.harnessKind,
      control,
      selection: resolved,
      onSelect: input.onControlSelect,
    })
  );
  return modelControl ? [...configControls, modelControl] : configControls;
}

export function resolveCloudLaunchSelection(input: {
  launchOptions?: CloudHarnessLaunchOptionsResponse | null;
  selection: CloudLaunchComposerSelection;
}): CloudLaunchComposerSelection {
  const response = input.launchOptions;
  const selectedModel = selectLaunchModel(response, input.selection.modelId);
  const controls = launchComposerControls(response, selectedModel?.id);
  const controlValues: Record<string, string> = {};
  for (const control of controls) {
    const value = selectedLaunchControlValue(control, input.selection);
    if (value) {
      controlValues[control.key] = value;
    }
  }
  return {
    agentKind: response?.harnessKind ?? input.selection.agentKind ?? DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: selectedModel?.id ?? null,
    controlValues,
  };
}

/** All first-party launch controls are sent atomically on create. */
export function buildLaunchSessionConfigUpdates(_input: {
  launchOptions?: CloudHarnessLaunchOptionsResponse | null;
  selection: CloudLaunchComposerSelection;
}): LaunchSessionConfigUpdate[] {
  return [];
}

export function buildLaunchRunConfigControlValues(input: {
  launchOptions?: CloudHarnessLaunchOptionsResponse | null;
  selection: CloudLaunchComposerSelection;
}): Record<string, string> {
  return resolveCloudLaunchSelection(input).controlValues;
}
