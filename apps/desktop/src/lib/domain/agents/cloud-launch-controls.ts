import type {
  CloudAgentCatalogControlInput,
  CloudAgentCatalogModelInput,
  DesktopAgentLaunchControl,
  DesktopSessionDefaultControl,
} from "./cloud-launch-catalog-types";

const SESSION_DEFAULT_CONTROL_KEYS: ReadonlyArray<{
  key: DesktopSessionDefaultControl["key"];
  catalogKeys: readonly string[];
}> = [
  { key: "reasoning", catalogKeys: ["reasoning"] },
  { key: "effort", catalogKeys: ["effort", "reasoning_effort"] },
  { key: "fast_mode", catalogKeys: ["fast_mode"] },
];

/**
 * Per-model live-default controls from the v2 per-model option matrix
 * (`model.controls`), falling back to the agent-level vocabulary when the
 * model carries no entry for a key. The catalog default is the explicit
 * `default`, else the probe-observed value.
 */
export function projectSessionDefaultControls(
  model: CloudAgentCatalogModelInput,
  sessionControls: readonly CloudAgentCatalogControlInput[],
): DesktopSessionDefaultControl[] {
  return SESSION_DEFAULT_CONTROL_KEYS.flatMap(({ key, catalogKeys }) => {
    for (const catalogKey of catalogKeys) {
      const modelControl = model.controls?.[catalogKey];
      const values = modelControl?.values
        ?? sessionControls.find((control) => control.key === catalogKey)?.values;
      if (!values || values.length === 0) {
        continue;
      }
      const defaultValue = modelControl?.default
        ?? modelControl?.observedValue
        ?? null;
      return [{
        key,
        label: launchControlLabel(key),
        defaultValue,
        values: values.map((value) => ({
          value,
          label: controlValueLabel(value),
          description: null,
          isDefault: value === defaultValue,
        })),
      }];
    }
    return [];
  });
}

/**
 * Desktop launch-control key normalization (catalog control key -> desktop
 * control key). Whether a control projects at all is decided by its catalog
 * MAPPING: a control without a createField or liveConfigId is a
 * probe-observed matrix dimension (e.g. cursor's bracket-param
 * effort/reasoning/thinking/context) with no application path — projecting
 * it would render a knob that does nothing. Single-value controls carry no
 * choice and are likewise skipped.
 */
const LAUNCH_CONTROL_KEYS: Readonly<Record<string, string>> = {
  mode: "mode",
  collaboration_mode: "collaboration_mode",
  reasoning: "reasoning",
  reasoning_effort: "effort",
  effort: "effort",
  fast_mode: "fast_mode",
};

export function projectCloudControl(
  control: CloudAgentCatalogControlInput,
): DesktopAgentLaunchControl[] {
  const desktopKey = LAUNCH_CONTROL_KEYS[control.key];
  const values = control.values ?? [];
  const hasApplicationPath =
    Boolean(control.mapping?.createField) || Boolean(control.mapping?.liveConfigId);
  if (
    control.key === "model"
    || !desktopKey
    || !hasApplicationPath
    || values.length < 2
  ) {
    return [];
  }

  const createField = control.mapping?.createField ?? null;

  return [{
    key: desktopKey,
    label: control.label ?? launchControlLabel(desktopKey),
    description: null,
    type: "select",
    category: null,
    defaultValue: null,
    createField,
    phase: createField ? "create_session" : "live_default",
    surfaces: { start: true, session: true, automation: true, settings: true },
    apply: {
      createField,
      liveConfigId: control.mapping?.liveConfigId ?? control.key,
      liveSetter: "runtime_control",
      queueBeforeMaterialized: true,
    },
    missingLiveConfigPolicy: "ignore_default",
    valueSource: "inline",
    values: values.map((value) => ({
      value,
      label: controlValueLabel(value),
      description: null,
      isDefault: false,
      status: null,
    })),
    queueWhileMaterializing: true,
    mutableAfterMaterialized: true,
  }];
}

const LAUNCH_CONTROL_LABELS: Readonly<Record<string, string>> = {
  mode: "Mode",
  collaboration_mode: "Collaboration Mode",
  reasoning: "Reasoning",
  effort: "Effort",
  fast_mode: "Fast Mode",
};

function launchControlLabel(key: string): string {
  return LAUNCH_CONTROL_LABELS[key] ?? humanizeControlToken(key);
}

const CONTROL_VALUE_LABELS: Readonly<Record<string, string>> = {
  dontAsk: "Don't Ask",
  xhigh: "Extra High",
  yolo: "YOLO",
};

function controlValueLabel(value: string): string {
  return CONTROL_VALUE_LABELS[value] ?? humanizeControlToken(value);
}

function humanizeControlToken(token: string): string {
  const spaced = token
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) {
    return token;
  }
  return spaced
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
