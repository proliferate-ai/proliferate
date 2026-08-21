import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import { resolveObservedLaunchControlScope } from "#product/lib/domain/sessions/launch-control-scope";
import { resolveModelDisplayName } from "#product/lib/domain/chat/models/model-display";
import type {
  DesktopAgentLaunchAgent,
  DesktopLaunchModelRegistry,
  RuntimeAgentLaunchOptions,
} from "#product/lib/domain/agents/cloud-launch-catalog-types";

export type {
  DesktopAgentCatalogStatus,
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchCatalog,
  DesktopAgentLaunchControl,
  DesktopAgentLaunchControlApply,
  DesktopAgentLaunchControlPhase,
  DesktopAgentLaunchControlSurfaces,
  DesktopAgentLaunchControlValue,
  DesktopAgentLaunchModel,
  DesktopLaunchModelRegistry,
  DesktopLaunchModelRegistryModel,
  DesktopModelTuningControlValues,
  DesktopSessionDefaultControl,
  DesktopSessionDefaultControlValue,
  RuntimeAgentLaunchOptions,
} from "#product/lib/domain/agents/cloud-launch-catalog-types";

/**
 * Presentation-only mapper over one target-observed response. Executable IDs,
 * order, and defaults pass through without catalog filtering.
 *
 * Model display names are normalized to the product's canonical naming here,
 * and only here. The harness observes its own short name ("Fable", "Sonnet")
 * while the product prints the versioned name ("Fable 5", "Sonnet 4.6"). The
 * composer's current-model label already resolved that canonical name on its
 * own, so leaving the observed name raw in the catalog gave one model two
 * names: home and the picker rows read this catalog and said "Fable" while
 * the live composer said "Fable 5". Normalizing at the single point where an
 * observation becomes the catalog keeps every surface on one string.
 * Executable identity is untouched: `id` stays the observed id.
 */
export function projectHarnessLaunchOptions(
  response: Pick<HarnessLaunchOptionsResponse, "harnessKind" | "options">,
): DesktopAgentLaunchAgent | null {
  const options = response.options;
  if (!options) {
    return null;
  }
  const harnessLaunchControls = projectLaunchControls(
    options.controls,
    options.defaults.controlValues,
  );
  return {
    kind: response.harnessKind,
    displayName: response.harnessKind,
    description: null,
    defaultModelId: options.defaults.modelId,
    models: options.models.map((model) => {
      const observedName = model.observedName ?? model.id;
      const controlScope = resolveObservedLaunchControlScope(options, model.id);
      return {
        id: model.id,
        displayName: resolveModelDisplayName({
          agentKind: response.harnessKind,
          modelId: model.id,
          sourceLabels: [observedName],
          preferKnownAlias: true,
        }) ?? observedName,
        description: model.observedDescription,
        provider: null,
        aliases: [],
        status: "active",
        isDefault: model.id === options.defaults.modelId,
        sessionDefaultControls: [],
        launchControls: controlScope.source === "model"
          ? projectLaunchControls(
            controlScope.controls,
            controlScope.defaultControlValues,
          )
          : null,
        modeValues: null,
        tuningControlValues: null,
      };
    }),
    launchControls: harnessLaunchControls,
  };
}

function projectLaunchControls(
  controls: readonly NonNullable<
    HarnessLaunchOptionsResponse["options"]
  >["controls"][number][],
  defaultControlValues: Readonly<Record<string, string>>,
): DesktopAgentLaunchAgent["launchControls"] {
  return controls.map((control) => ({
    key: control.id,
    label: control.observedLabel ?? control.id,
    description: control.observedDescription,
    type: "select",
    category: control.id,
    defaultValue: defaultControlValues[control.id] ?? null,
    createField: null,
    phase: "create_session",
    surfaces: { start: true, session: true, automation: true, settings: true },
    apply: {
      liveConfigId: control.id,
      liveSetter: "runtime_control",
      queueBeforeMaterialized: false,
    },
    missingLiveConfigPolicy: "block_prompt",
    valueSource: "inline",
    values: control.values.map((value) => ({
      value: value.value,
      label: value.observedLabel ?? value.value,
      description: value.observedDescription,
      isDefault: defaultControlValues[control.id] === value.value,
    })),
    queueWhileMaterializing: false,
    mutableAfterMaterialized: true,
  }));
}

export function launchControlsForModel<TControl>(
  agent: {
    defaultModelId?: string | null;
    launchControls?: readonly TControl[];
    models: ReadonlyArray<{
      id: string;
      launchControls?: readonly TControl[] | null;
    }>;
  } | null | undefined,
  modelId: string | null | undefined,
): readonly TControl[] {
  if (!agent) {
    return [];
  }
  const effectiveModelId = modelId || agent.defaultModelId;
  const model = effectiveModelId
    ? agent.models.find((candidate) => candidate.id === effectiveModelId)
    : null;
  return model?.launchControls ?? agent.launchControls ?? [];
}

/** Complete selected/default values for the exact observed model scope. */
export function resolveLaunchControlValuesForModel(
  agent: DesktopAgentLaunchAgent | null | undefined,
  modelId: string | null | undefined,
  selected: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of launchControlsForModel(agent, modelId)) {
    const selectedValue = selected[control.key];
    const value = selectedValue !== undefined
      && control.values.some((candidate) => candidate.value === selectedValue)
      ? selectedValue
      : control.defaultValue;
    if (value !== null
      && control.values.some((candidate) => candidate.value === value)) {
      values[control.key] = value;
    }
  }
  return values;
}

export function runtimeLaunchOptionsFromResponse(
  response: HarnessLaunchOptionsResponse | undefined,
): RuntimeAgentLaunchOptions[] | null {
  const projected = response ? projectHarnessLaunchOptions(response) : null;
  if (!projected) {
    return null;
  }
  return [{
    kind: projected.kind,
    displayName: projected.displayName,
    defaultModelId: projected.defaultModelId,
    models: projected.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      aliases: [],
      isDefault: model.isDefault,
    })),
  }];
}

export function buildDesktopLaunchModelRegistries(
  agents: readonly DesktopAgentLaunchAgent[],
): DesktopLaunchModelRegistry[] {
  return agents.map((agent) => ({
    kind: agent.kind,
    displayName: agent.displayName,
    defaultModelId: agent.defaultModelId,
    models: agent.models,
  }));
}
