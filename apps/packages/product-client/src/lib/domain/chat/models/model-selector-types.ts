import type { PendingSessionConfigChangeStatus } from "@proliferate/product-domain/sessions/pending-config";
import type { ChatModelVisibilityOverridesByAgentKind } from "#product/lib/domain/preferences/user/session-defaults";

export interface ModelSelectorSelection {
  kind: string;
  modelId: string;
}

export interface ChatLaunchPreferences {
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
  chatModelVisibilityOverridesByAgentKind?: ChatModelVisibilityOverridesByAgentKind;
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

export interface ModelSelectorProps {
  connectionState: string;
  currentModel: ModelSelectorCurrentModel | null;
  groups: ModelSelectorGroup[];
  hasAgents: boolean;
  isLoading: boolean;
  onSelect: (selection: ModelSelectorSelection) => void;
  /**
   * Set when the model the composer is currently on is one the target refused.
   * Pinned under the control as an inline error — the condition belongs to this
   * field, and the picker is right there to fix it, so it is not a toast.
   */
  unsupportedSelectionMessage?: string | null;
}
