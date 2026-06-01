import type { SessionControlIconKey } from "../session-controls/presentation";

export interface CloudChatComposerControlOptionView {
  id: string;
  label: string;
  description?: string | null;
  icon?: SessionControlIconKey | null;
  selected?: boolean;
  disabled?: boolean;
}

export interface CloudChatComposerControlGroupView {
  id: string;
  label?: string | null;
  options: readonly CloudChatComposerControlOptionView[];
}

export interface CloudChatComposerControlView {
  id: string;
  key?: string | null;
  label: string;
  detail?: string | null;
  icon?: "bot" | "brain" | "settings" | SessionControlIconKey;
  placement?: "leading" | "trailing";
  disabled?: boolean;
  active?: boolean;
  pendingState?: "sending" | "queued" | null;
  groups: readonly CloudChatComposerControlGroupView[];
  onSelect?: (optionId: string) => void;
}

export interface CloudChatComposerBadgeSummary {
  label: string;
  icon?: CloudChatComposerControlView["icon"] | null;
  pending: boolean;
}

export type PendingConfigStatus = "sending" | "queued";

export type PendingConfigChange = {
  sessionId: string;
  rawConfigId: string;
  value: string;
  status: PendingConfigStatus;
  mutationId: number;
  commandId?: string | null;
};

export interface LaunchSessionConfigUpdate {
  configId: string;
  value: string;
}

export interface CloudLaunchComposerSelection {
  agentKind: string;
  modelId: string | null;
  modeId: string | null;
  controlValues: Record<string, string>;
}

export interface CloudLaunchComposerControlSelection {
  controlKey: string;
  value: string;
}

export interface CloudSessionAgentModelSelection {
  agentKind: string;
  modelId: string;
}
