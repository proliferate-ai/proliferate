import type {
  CloudHarnessLaunchControl,
  CloudHarnessLaunchModel,
  CloudHarnessLaunchOptionsResponse,
} from "./launch-options-model";
import type { CloudLaunchComposerSelection } from "./composer-control-model";

/** A presentation-only view over one target-observed launch control. */
export interface ComposerLaunchControl {
  key: string;
  label: string;
  liveConfigId: string;
  defaultValue: string | null;
  values: Array<{ value: string; label: string; isDefault: boolean }>;
}

export function selectLaunchModel(
  response: CloudHarnessLaunchOptionsResponse | null | undefined,
  modelId: string | null | undefined,
): CloudHarnessLaunchModel | null {
  const options = response?.options;
  if (!options) {
    return null;
  }
  if (modelId) {
    const exact = options.models.find((model) => model.id === modelId);
    if (exact) {
      return exact;
    }
  }
  const observedDefault = options.defaults.modelId;
  return observedDefault
    ? options.models.find((model) => model.id === observedDefault) ?? null
    : null;
}

export function launchComposerControls(
  response: CloudHarnessLaunchOptionsResponse | null | undefined,
  modelId?: string | null,
): ComposerLaunchControl[] {
  const options = response?.options;
  if (!options) {
    return [];
  }
  const effectiveModelId = modelId || options.defaults.modelId || null;
  const modelScope = effectiveModelId
    ? options.modelControls?.find((candidate) => candidate.modelId === effectiveModelId)
    : undefined;
  const controls = modelScope ? modelScope.controls : options.controls;
  const defaults = modelScope
    ? modelScope.defaultControlValues
    : options.defaults.controlValues;
  return controls.map((control) => launchControlView(control, defaults));
}

export function selectedLaunchControlValue(
  control: ComposerLaunchControl,
  selection: CloudLaunchComposerSelection,
): string | null {
  const explicit = selection.controlValues[control.key];
  if (explicit && control.values.some((option) => option.value === explicit)) {
    return explicit;
  }
  return control.defaultValue && control.values.some((option) => option.value === control.defaultValue)
    ? control.defaultValue
    : null;
}

export function launchAgentModelOptionId(agentKind: string, modelId: string): string {
  return `${encodeURIComponent(agentKind)}:${encodeURIComponent(modelId)}`;
}

export function parseLaunchAgentModelOptionId(
  optionId: string,
): { agentKind: string; modelId: string } | null {
  const separator = optionId.indexOf(":");
  if (separator <= 0 || separator === optionId.length - 1) {
    return null;
  }
  return {
    agentKind: decodeURIComponent(optionId.slice(0, separator)),
    modelId: decodeURIComponent(optionId.slice(separator + 1)),
  };
}

function launchControlView(
  control: CloudHarnessLaunchControl,
  defaults: Readonly<Record<string, string>>,
): ComposerLaunchControl {
  const defaultValue = defaults[control.id] ?? null;
  return {
    key: control.id,
    label: control.observedLabel ?? humanizeControlToken(control.id),
    liveConfigId: control.id,
    defaultValue,
    values: control.values.map((value) => ({
      value: value.value,
      label: value.observedLabel ?? humanizeControlToken(value.value),
      isDefault: value.value === defaultValue,
    })),
  };
}

const CONTROL_TOKEN_LABELS: Readonly<Record<string, string>> = {
  dontAsk: "Don't Ask",
  xhigh: "Extra High",
  yolo: "YOLO",
  mode: "Access",
  collaboration_mode: "Mode",
  reasoning: "Reasoning",
  reasoning_effort: "Effort",
  effort: "Effort",
  fast_mode: "Fast Mode",
};

function humanizeControlToken(token: string): string {
  const known = CONTROL_TOKEN_LABELS[token];
  if (known) {
    return known;
  }
  const spaced = token
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return spaced
    ? spaced.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
    : token;
}
