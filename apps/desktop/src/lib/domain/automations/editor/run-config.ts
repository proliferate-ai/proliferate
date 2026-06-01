import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import type { AutomationRecord } from "@/lib/domain/automations/run/ui-records";

export function resolveAutomationAgent(
  agents: DesktopAgentLaunchAgent[],
  agentKind: string | null,
): DesktopAgentLaunchAgent | null {
  return agents.find((agent) => agent.kind === agentKind)
    ?? agents.find((agent) => agent.models.length > 0)
    ?? null;
}

export function resolveAutomationModel(
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

export function selectedAutomationControlValues(
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

export function initialAutomationControlValues(
  automation: AutomationRecord | null,
): Record<string, string> {
  return {
    ...(automation?.modeId ? { mode: automation.modeId } : {}),
    ...(automation?.reasoningEffort ? { effort: automation.reasoningEffort } : {}),
  };
}

export function automationControlValuesEqual(
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

export function automationRunConfigName(title: string): string {
  const trimmed = title.trim();
  return `Automation · ${trimmed ? trimmed.slice(0, 80) : "Untitled"}`;
}
