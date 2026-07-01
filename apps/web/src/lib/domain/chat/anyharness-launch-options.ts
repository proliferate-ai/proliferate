import type {
  AgentLaunchOptionsResponse,
  NormalizedSessionControl,
  Session,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import type {
  CloudChatComposerControlOptionView,
  CloudChatComposerControlView,
} from "@proliferate/product-ui/chat/CloudChatComposer";
import type { CloudLaunchComposerSelection } from "@proliferate/product-domain/chats/cloud/composer-controls";

const DEFAULT_AGENT_KIND = "claude";

export function resolveAnyHarnessLaunchSelection(input: {
  launchOptions?: AgentLaunchOptionsResponse | null;
  selection: CloudLaunchComposerSelection;
}): CloudLaunchComposerSelection {
  const agents = input.launchOptions?.agents ?? [];
  const selectedAgent = agents.find((agent) => agent.kind === input.selection.agentKind)
    ?? agents.find((agent) => agent.kind === DEFAULT_AGENT_KIND)
    ?? agents[0]
    ?? null;
  if (!selectedAgent) {
    return input.selection;
  }

  const selectedModel = selectedAgent.models.find((model) =>
    model.id === input.selection.modelId || model.aliases?.includes(input.selection.modelId ?? "")
  )
    ?? selectedAgent.models.find((model) => model.isDefault)
    ?? selectedAgent.models[0]
    ?? null;

  return {
    ...input.selection,
    agentKind: selectedAgent.kind,
    modelId: selectedModel?.id ?? null,
  };
}

export function buildAnyHarnessLaunchComposerControls(input: {
  launchOptions?: AgentLaunchOptionsResponse | null;
  selection: CloudLaunchComposerSelection;
  onSelect: (selection: CloudLaunchComposerSelection) => void;
}): CloudChatComposerControlView[] {
  const agents = input.launchOptions?.agents ?? [];
  if (agents.length === 0) {
    return [];
  }

  const selected = resolveAnyHarnessLaunchSelection({
    launchOptions: input.launchOptions,
    selection: input.selection,
  });

  return [{
    id: "launch-agent-model",
    key: "model",
    label: "Model",
    detail: modelLabel({
      launchOptions: input.launchOptions,
      agentKind: selected.agentKind,
      modelId: selected.modelId,
    }),
    icon: "bot",
    placement: "trailing",
    groups: agents.map((agent) => ({
      id: agent.kind,
      label: agent.displayName,
      options: agent.models.map((model) => ({
        id: launchOptionId(agent.kind, model.id),
        label: model.displayName,
        selected: agent.kind === selected.agentKind && model.id === selected.modelId,
      })),
    })),
    onSelect: (optionId) => {
      const parsed = parseLaunchOptionId(optionId);
      if (!parsed) {
        return;
      }
      input.onSelect({
        ...selected,
        agentKind: parsed.agentKind,
        modelId: parsed.modelId,
        modeId: null,
        controlValues: {},
      });
    },
  }];
}

export function buildAnyHarnessSessionComposerControls(input: {
  session: Session;
  liveConfig: SessionLiveConfigSnapshot | null;
  onSelect: (rawConfigId: string, value: string) => void;
}): CloudChatComposerControlView[] {
  return collectSessionControls(input.liveConfig).map((control) => {
    const currentOption = control.values.find((option) => option.value === control.currentValue)
      ?? control.values[0]
      ?? null;
    return {
      id: control.rawConfigId,
      key: control.key,
      label: control.label || humanizeToken(control.key),
      detail: currentOption?.label ?? control.currentValue ?? null,
      icon: control.key === "model" ? "bot" : control.key === "effort" || control.key === "reasoning" ? "brain" : "settings",
      placement: control.key === "mode" || control.key === "collaboration_mode" ? "leading" : "trailing",
      disabled: !control.settable,
      active: Boolean(currentOption?.value && currentOption.value === control.currentValue),
      groups: [{
        id: control.rawConfigId,
        label: control.label || humanizeToken(control.key),
        options: control.values.map((option): CloudChatComposerControlOptionView => ({
          id: option.value,
          label: option.label,
          description: option.description,
          selected: option.value === control.currentValue,
          disabled: !control.settable || option.value === control.currentValue,
        })),
      }],
      onSelect: (value) => {
        if (value !== control.currentValue) {
          input.onSelect(control.rawConfigId, value);
        }
      },
    } satisfies CloudChatComposerControlView;
  });
}

export function sessionOptionLabel(session: Session): string {
  const title = session.title?.trim();
  if (title) {
    return title;
  }
  const model = session.modelId ?? session.requestedModelId;
  return model ? `${session.agentKind} / ${model}` : session.agentKind;
}

export function sessionStatusLabel(session: Session): string {
  switch (session.status) {
    case "running":
    case "starting":
      return "Running";
    case "errored":
      return "Error";
    case "closed":
      return "Closed";
    case "completed":
      return "Done";
    case "idle":
    default:
      return "Idle";
  }
}

function collectSessionControls(
  liveConfig: SessionLiveConfigSnapshot | null,
): NormalizedSessionControl[] {
  const normalized = liveConfig?.normalizedControls;
  if (!normalized) {
    return [];
  }
  const controls = [
    normalized.collaborationMode,
    normalized.mode,
    normalized.model,
    normalized.effort,
    normalized.reasoning,
    normalized.fastMode,
    ...(normalized.extras ?? []),
  ].filter((control): control is NormalizedSessionControl =>
    Boolean(control && control.values.length > 0)
  );
  const seen = new Set<string>();
  return controls.filter((control) => {
    if (seen.has(control.rawConfigId)) {
      return false;
    }
    seen.add(control.rawConfigId);
    return true;
  });
}

function modelLabel(input: {
  launchOptions?: AgentLaunchOptionsResponse | null;
  agentKind: string;
  modelId: string | null;
}): string | null {
  const agent = input.launchOptions?.agents.find((candidate) => candidate.kind === input.agentKind);
  const model = agent?.models.find((candidate) => candidate.id === input.modelId);
  return model?.displayName ?? input.modelId ?? agent?.displayName ?? null;
}

function launchOptionId(agentKind: string, modelId: string): string {
  return `${encodeURIComponent(agentKind)}:${encodeURIComponent(modelId)}`;
}

function parseLaunchOptionId(optionId: string): { agentKind: string; modelId: string } | null {
  const separator = optionId.indexOf(":");
  if (separator <= 0 || separator >= optionId.length - 1) {
    return null;
  }
  return {
    agentKind: decodeURIComponent(optionId.slice(0, separator)),
    modelId: decodeURIComponent(optionId.slice(separator + 1)),
  };
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
