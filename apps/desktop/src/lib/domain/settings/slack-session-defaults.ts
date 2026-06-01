import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";

export interface SlackSessionDefaultsDraft {
  agentKind: string | null;
  modelId: string | null;
  controlValues: Record<string, string>;
}

export function resolveSlackLaunchAgent(
  agents: DesktopAgentLaunchAgent[],
  agentKind: string | null,
): DesktopAgentLaunchAgent | null {
  return agents.find((agent) => agent.kind === agentKind)
    ?? agents.find((agent) => agent.models.length > 0)
    ?? null;
}

export function resolveSlackLaunchModel(
  agent: DesktopAgentLaunchAgent | null,
  modelId: string | null,
): DesktopAgentLaunchModel | null {
  if (!agent) {
    return null;
  }
  return agent.models.find((model) => model.id === modelId)
    ?? agent.models.find((model) => model.id === agent.defaultModelId)
    ?? agent.models.find((model) => model.isDefault)
    ?? agent.models[0]
    ?? null;
}

export function selectedSlackSessionControlValues(
  controls: LiveSessionControlDescriptor[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of controls) {
    const selected = control.options.find((option) => option.selected);
    if (selected?.value) {
      values[control.rawConfigId] = selected.value;
    }
  }
  return values;
}

export function stringControlValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) =>
      typeof value === "string" && value.trim().length > 0
        ? [[key, value]]
        : []
    ),
  );
}

export function slackSessionDraftsEqual(
  left: SlackSessionDefaultsDraft,
  right: SlackSessionDefaultsDraft,
): boolean {
  return left.agentKind === right.agentKind
    && left.modelId === right.modelId
    && controlValuesEqual(left.controlValues, right.controlValues);
}

export function slackRunConfigName(agentDisplayName: string): string {
  return `Slack bot - ${agentDisplayName}`;
}

function controlValuesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left).filter(([, value]) => value.trim().length > 0);
  const rightEntries = Object.entries(right).filter(([, value]) => value.trim().length > 0);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([key, value]) => right[key] === value);
}
