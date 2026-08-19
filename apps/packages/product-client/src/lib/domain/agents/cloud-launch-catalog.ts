import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
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
 * order, and defaults pass through without catalog filtering or enrichment.
 */
export function projectHarnessLaunchOptions(
  response: Pick<HarnessLaunchOptionsResponse, "harnessKind" | "options">,
): DesktopAgentLaunchAgent | null {
  const options = response.options;
  if (!options) {
    return null;
  }
  return {
    kind: response.harnessKind,
    displayName: response.harnessKind,
    description: null,
    defaultModelId: options.defaults.modelId,
    models: options.models.map((model) => ({
      id: model.id,
      displayName: model.observedName ?? model.id,
      description: model.observedDescription,
      provider: null,
      aliases: [],
      status: "active",
      isDefault: model.id === options.defaults.modelId,
      sessionDefaultControls: [],
      modeValues: null,
      tuningControlValues: null,
    })),
    launchControls: options.controls.map((control) => ({
      key: control.id,
      label: control.observedLabel ?? control.id,
      description: control.observedDescription,
      type: "select",
      category: control.id,
      defaultValue: options.defaults.controlValues[control.id] ?? null,
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
        isDefault: options.defaults.controlValues[control.id] === value.value,
      })),
      queueWhileMaterializing: false,
      mutableAfterMaterialized: true,
    })),
  };
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
