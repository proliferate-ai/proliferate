import { resolveModelDisplayName } from "#product/lib/domain/chat/models/model-display";
import type { DesktopAgentLaunchAgent } from "#product/lib/domain/agents/cloud-launch-catalog";
import {
  modelSelectionMatchesModel,
  resolveModelSelectionMatchKind,
} from "#product/lib/domain/chat/models/model-selection-ids";
import type {
  ActiveModelSelectorControl,
  ModelSelectionActionKind,
  ModelSelectorGroup,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";

interface SelectorModel {
  id: string;
  displayName: string;
  liveSwitchable: boolean;
}

const EMPTY_UNSUPPORTED_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * The key a refusal is looked up by. Matches on the id the row renders with,
 * which is the id that would be sent — an alias the user never sees must not
 * silently miss its own refusal.
 */
export function unsupportedModelKey(agentKind: string, modelId: string): string {
  return `${agentKind} ${modelId}`;
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
  /**
   * `kind modelId` pairs the current target has refused. Empty in every case
   * but the one where a refusal has actually been observed, so the marked row
   * only ever appears after the product has proof.
   */
  unsupportedModelKeys: ReadonlySet<string> = EMPTY_UNSUPPORTED_KEYS,
): ModelSelectorGroup[] {
  const sourceAgentsByKind = new Map(agents.map((agent) => [agent.kind, agent]));
  // The active session's live model statement is authoritative for ITS harness
  // only (resolveSelectorModels swaps in the live values for the matching
  // kind). Every other observed harness keeps its group so cross-harness rows
  // stay reachable as open_new_chat; a live control whose harness is absent
  // from the observed list still gets a synthesized group.
  const sourceAgents = activeModelControl?.values.length
    && !agents.some((agent) => agent.kind === activeModelControl.kind)
    ? [agentFromActiveModelControl(activeModelControl), ...agents]
    : agents;
  return sourceAgents
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
        const modelId = selectionMatchKind === "equivalent"
          ? selected?.modelId ?? model.id
          : model.id;
        return {
          kind: agent.kind,
          modelId,
          displayName: model.displayName,
          actionKind: resolveModelSelectionActionKindForModel(
            activeSelection,
            sourceAgent,
            agent.kind,
            model,
          ),
          isSelected,
          // Also check the underlying observed id: a refusal is recorded against
          // whatever id was sent, and the row may render an equivalent alias.
          isUnsupported: unsupportedModelKeys.has(unsupportedModelKey(agent.kind, modelId))
            || unsupportedModelKeys.has(unsupportedModelKey(agent.kind, model.id)),
        };
      }),
    }));
}

function agentFromActiveModelControl(
  control: ActiveModelSelectorControl,
): DesktopAgentLaunchAgent {
  return {
    kind: control.kind,
    displayName: control.kind,
    description: null,
    defaultModelId: null,
    models: control.values.map((value) => ({
      id: value.value,
      displayName: value.label,
      description: value.description ?? null,
      provider: null,
      aliases: [],
      status: "active",
      isDefault: false,
      sessionDefaultControls: [],
      modeValues: null,
      tuningControlValues: null,
    })),
    launchControls: [],
  };
}

function resolveSelectorModels(
  agent: DesktopAgentLaunchAgent,
  activeModelControl: ActiveModelSelectorControl | null | undefined,
  selected: ModelSelectorSelection | null,
  sourceAgent: DesktopAgentLaunchAgent,
): SelectorModel[] {
  if (activeModelControl?.kind === agent.kind && activeModelControl.values.length > 0) {
    return resolveActiveControlSelectorModels(
      agent,
      activeModelControl,
      selected,
      sourceAgent,
    );
  }

  return resolveLaunchOptionSelectorModels(agent);
}

function resolveLaunchOptionSelectorModels(
  agent: DesktopAgentLaunchAgent,
): SelectorModel[] {
  return agent.models.map((model) => ({
      id: model.id,
      displayName: resolveModelDisplayName({
        agentKind: agent.kind,
        modelId: model.id,
        sourceLabels: [model.displayName],
        preferKnownAlias: false,
      }) ?? model.displayName,
      liveSwitchable: false,
    }));
}

function resolveActiveControlSelectorModels(
  agent: DesktopAgentLaunchAgent,
  activeModelControl: ActiveModelSelectorControl,
  selected: ModelSelectorSelection | null,
  sourceAgent: DesktopAgentLaunchAgent,
): SelectorModel[] {
  void selected;
  void sourceAgent;
  return activeModelControl.values.map((value) => {
    const displayName = resolveModelDisplayName({
      agentKind: agent.kind,
      modelId: value.value,
      sourceLabels: [value.label],
      preferKnownAlias: false,
    }) ?? value.label;

    return {
      id: value.value,
      displayName,
      liveSwitchable: true,
    };
  });
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
