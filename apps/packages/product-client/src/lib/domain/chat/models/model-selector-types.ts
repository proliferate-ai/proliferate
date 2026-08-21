import type { PendingSessionConfigChangeStatus } from "#product/domain/sessions/pending-config";

export interface ModelSelectorSelection {
  kind: string;
  modelId: string;
}

export interface ChatLaunchPreferences {
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
}

export type ModelSelectionActionKind =
  | "select"
  | "update_current_chat"
  | "open_new_chat";

export interface ModelSelectorItem {
  kind: string;
  modelId: string;
  displayName: string;
  actionKind: ModelSelectionActionKind;
  isSelected: boolean;
  /**
   * The current target refused this model. The row stays visible and marked
   * rather than disappearing: a model that vanishes from the menu reads as an
   * account or catalog problem, and the user would go looking in Settings for
   * something that is actually a runtime version on one machine.
   */
  isUnsupported: boolean;
}

export interface ModelSelectorGroup {
  kind: string;
  providerDisplayName: string;
  models: ModelSelectorItem[];
}

export interface ActiveModelSelectorControl {
  kind: string;
  values: ReadonlyArray<{
    value: string;
    label: string;
    description?: string | null;
  }>;
}

export interface ModelSelectorCurrentModel {
  kind: string;
  displayName: string;
  pendingState: PendingSessionConfigChangeStatus | null;
}

/**
 * Why the offered rows look the way they do.
 *
 * `groups.length === 0` cannot say it: no observation yet, an observation that
 * found nothing, and a failed observation are three different facts, and the
 * trigger label, the enabled state and the picker's empty body each differ
 * between them. Chat has a live session and omits this (defaulting to
 * `ready`); Home derives it from its model gate.
 */
export type ModelSelectorAvailability =
  | "ready"
  | "observation_pending"
  | "observed_empty"
  | "unavailable";

export interface ModelSelectorProps {
  connectionState: string;
  currentModel: ModelSelectorCurrentModel | null;
  groups: ModelSelectorGroup[];
  hasAgents: boolean;
  isLoading: boolean;
  onSelect: (selection: ModelSelectorSelection) => void;
  /** Defaults to `ready`, which is exactly today's behavior. */
  availability?: ModelSelectorAvailability;
  /**
   * Set when the model the composer is currently on is one the target refused.
   * Pinned under the control as an inline error — the condition belongs to this
   * field, and the picker is right there to fix it, so it is not a toast.
   */
  unsupportedSelectionMessage?: string | null;
}
