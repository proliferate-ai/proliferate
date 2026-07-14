import {
  resolveModelDisplayName,
  shouldHideModel,
} from "@/lib/domain/chat/models/model-display";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import { agentsWithVisibleModels } from "@/lib/domain/chat/models/launch-visible-agents";
import {
  findLaunchModelByIdOrAlias,
  modelSelectionMatchesModel,
  resolveModelSelectionMatchKind,
} from "@/lib/domain/chat/models/model-selection-ids";
import type {
  ActiveModelSelectorControl,
  ModelSelectionActionKind,
  ModelSelectorGroup,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selector-types";
import type { ChatModelVisibilityOverridesByAgentKind } from "@/lib/domain/preferences/user/session-defaults";

interface SelectorModel {
  id: string;
  displayName: string;
  liveSwitchable: boolean;
}

export function resolveModelSelectionActionKind(
  activeSelection: ModelSelectorSelection | null | undefined,
  agentKind: string,
  modelId: string,
): ModelSelectionActionKind {
  if (!activeSelection) {
    return "select";
  }
  if (activeSelection.kind !== agentKind) {
    return "open_new_chat";
  }
  if (activeSelection.modelId !== modelId) {
    return "update_current_chat";
  }
  return "select";
}

export function buildModelSelectorGroups(
  agents: DesktopAgentLaunchAgent[],
  selected: ModelSelectorSelection | null,
  activeSelection: ModelSelectorSelection | null | undefined,
  activeModelControl?: ActiveModelSelectorControl | null,
  visibilityOverrides: ChatModelVisibilityOverridesByAgentKind = {},
): ModelSelectorGroup[] {
  const sourceAgentsByKind = new Map(agents.map((agent) => [agent.kind, agent]));
  return agentsWithVisibleModels(agents, { selected, visibilityOverrides })
    .map((agent) => ({
      kind: agent.kind,
      providerDisplayName: agent.displayName,
      models: resolveSelectorModels(
        agent,
        activeModelControl,
        selected,
        sourceAgentsByKind.get(agent.kind) ?? agent,
      ).map((model) => {
        const sourceAgent = sourceAgentsByKind.get(agent.kind) ?? agent;
        const selectionMatchKind = resolveModelSelectionMatchKind(
          selected,
          sourceAgent,
          agent.kind,
          model.id,
        );
        const isSelected = selectionMatchKind !== "none";
        return {
          kind: agent.kind,
          modelId: selectionMatchKind === "equivalent"
            ? selected?.modelId ?? model.id
            : model.id,
          displayName: model.displayName,
          actionKind: resolveModelSelectionActionKindForModel(
            activeSelection,
            sourceAgent,
            agent.kind,
            model,
          ),
          isSelected,
        };
      }),
    }));
}

function resolveSelectorModels(
  agent: DesktopAgentLaunchAgent,
  activeModelControl: ActiveModelSelectorControl | null | undefined,
  selected: ModelSelectorSelection | null,
  sourceAgent: DesktopAgentLaunchAgent,
): SelectorModel[] {
  if (activeModelControl?.kind === agent.kind && activeModelControl.values.length > 0) {
    return mergeCatalogAndActiveControlSelectorModels(
      resolveCatalogSelectorModels(agent),
      resolveActiveControlSelectorModels(
        agent,
        activeModelControl,
        selected,
        sourceAgent,
      ),
      sourceAgent,
    );
  }

  return resolveCatalogSelectorModels(agent);
}

function resolveCatalogSelectorModels(
  agent: DesktopAgentLaunchAgent,
): SelectorModel[] {
  return agent.models.flatMap((model) => {
    if (shouldHideCatalogSelectorModel(agent.kind, model.id)) {
      return [];
    }

    return [{
      id: model.id,
      displayName: resolveModelDisplayName({
        agentKind: agent.kind,
        modelId: model.id,
        sourceLabels: [model.displayName],
        preferKnownAlias: shouldPreferStaticModelAlias(model.displayName),
      }) ?? model.displayName,
      liveSwitchable: false,
    }];
  });
}

function resolveActiveControlSelectorModels(
  agent: DesktopAgentLaunchAgent,
  activeModelControl: ActiveModelSelectorControl,
  selected: ModelSelectorSelection | null,
  sourceAgent: DesktopAgentLaunchAgent,
): SelectorModel[] {
  return activeModelControl.values.flatMap((value) => {
    const isSelected = modelSelectionMatchesModel(
      selected,
      sourceAgent,
      agent.kind,
      value.value,
    );
    const knownModel = findLaunchModelByIdOrAlias(sourceAgent, value.value);
    const visibleModel = findLaunchModelByIdOrAlias(agent, value.value);
    const isFilteredByVisibility =
      Boolean(knownModel) && !visibleModel;
    // v2: the merged catalog menu is the model truth, so live-control values
    // unknown to it stay hidden unless they are the active selection.
    const isUnknownToCatalog = !knownModel;
    const isHiddenByProductPolicy = shouldHideSelectorModel(agent.kind, value);
    if (
      (isFilteredByVisibility || isUnknownToCatalog || isHiddenByProductPolicy)
      && !isSelected
    ) {
      return [];
    }

    const displayModel = knownModel ?? visibleModel;
    const displayName = resolveModelDisplayName({
      agentKind: agent.kind,
      modelId: displayModel?.id ?? value.value,
      sourceLabels: [
        displayModel?.displayName,
        value.label,
      ],
      preferKnownAlias: !isHiddenByProductPolicy,
    }) ?? displayModel?.displayName ?? value.label;

    return [{
      id: value.value,
      displayName,
      liveSwitchable: true,
    }];
  });
}

function mergeCatalogAndActiveControlSelectorModels(
  catalogModels: SelectorModel[],
  activeControlModels: SelectorModel[],
  sourceAgent: DesktopAgentLaunchAgent,
): SelectorModel[] {
  const emittedDedupeKeys = new Set<string>();
  const merged: SelectorModel[] = [];
  for (const model of activeControlModels) {
    merged.push(model);
    for (const key of selectorModelDedupeKeys(sourceAgent, model)) {
      emittedDedupeKeys.add(key);
    }
  }

  for (const catalogModel of catalogModels) {
    const keys = selectorModelDedupeKeys(sourceAgent, catalogModel);
    if (keys.some((key) => emittedDedupeKeys.has(key))) {
      continue;
    }
    merged.push(catalogModel);
    for (const key of keys) {
      emittedDedupeKeys.add(key);
    }
  }

  return merged;
}

function selectorModelDedupeKeys(
  agent: DesktopAgentLaunchAgent,
  model: Pick<SelectorModel, "id" | "displayName">,
): string[] {
  const keys = [
    `model:${findLaunchModelByIdOrAlias(agent, model.id)?.id ?? model.id}`,
  ];
  const displayName = model.displayName
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (displayName) {
    keys.push(`display:${displayName}`);
  }
  return keys;
}

function resolveModelSelectionActionKindForModel(
  activeSelection: ModelSelectorSelection | null | undefined,
  agent: DesktopAgentLaunchAgent,
  agentKind: string,
  model: SelectorModel,
): ModelSelectionActionKind {
  if (!activeSelection) {
    return "select";
  }
  if (activeSelection.kind !== agentKind) {
    return "open_new_chat";
  }
  // The harness boundary decides new versus current chat. A different model
  // in the same harness preserves the durable session; the runtime either
  // applies it live or relaunches the agent process under that session.
  return modelSelectionMatchesModel(activeSelection, agent, agentKind, model.id)
    ? "select"
    : "update_current_chat";
}

function shouldHideSelectorModel(
  agentKind: string,
  value: ActiveModelSelectorControl["values"][number],
): boolean {
  if (shouldHideModel(agentKind, value.value)) {
    return true;
  }

  if (agentKind !== "claude") {
    return false;
  }

  const label = value.label.toLowerCase();
  return /\bopus\s*4\.1\b/.test(label)
    || /\bopus\s*4\.5\b/.test(label)
    || (/\bopus\s*4\.6\b/.test(label) && /\b1m\b|1m context/.test(label));
}

function shouldPreferStaticModelAlias(displayName: string): boolean {
  return !/\b\d+(?:\.\d+)?\b/.test(displayName);
}

function shouldHideCatalogSelectorModel(
  agentKind: string,
  modelId: string,
): boolean {
  // The v2 catalog menu IS the pre-live menu: every advertised row renders
  // until live options arrive (the merge dedupes live vs catalog rows by id
  // and display name, so no special-casing of catalog ids).
  return shouldHideModel(agentKind, modelId);
}
