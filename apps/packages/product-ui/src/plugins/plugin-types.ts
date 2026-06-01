
import type { ReactNode } from "react";
import type {
  PluginConnectionDraft,
  PluginInventoryItem,
  PluginSettings,
  PluginSurfaceKind,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";

export type PluginModalMode = "connect" | "manage";
export type PluginModalTab = "configure" | "tools" | "about";
export type PluginIconSize = "sm" | "md";
export type PluginIconRenderer = (item: PluginInventoryItem, size: PluginIconSize) => ReactNode;

export interface PluginsSurfaceProps {
  items: readonly PluginInventoryItem[];
  query: string;
  loading: boolean;
  error: string | null;
  surface: PluginSurfaceKind;
  selectedItem: PluginInventoryItem | null;
  modalMode: PluginModalMode;
  draft: PluginConnectionDraft | null;
  submitting: boolean;
  pendingItemIds: readonly string[];
  modalError: string | null;
  completionNotice: PluginCompletionNotice | null;
  canShare: boolean;
  canCancelSubmission: boolean;
  cancelingSubmission: boolean;
  shareOrganizationName: string | null;
  deleteTarget: PluginInventoryItem | null;
  deletePending: boolean;
  renderIcon?: PluginIconRenderer;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  onOpenItem: (item: PluginInventoryItem, mode: PluginModalMode) => void;
  onCloseItem: () => void;
  onCancelSubmission: () => void;
  onDraftSettingsChange: (settings: PluginSettings | undefined) => void;
  onDraftSecretChange: (fieldId: string, value: string) => void;
  onSubmitSelected: () => void;
  onToggleEnabled: (item: PluginInventoryItem, enabled: boolean) => void;
  onShareChange: (item: PluginInventoryItem, publicToOrg: boolean) => void;
  onOpenDocs: (url: string) => void;
  onOpenDesktop: () => void;
  onRequestDelete: (item: PluginInventoryItem) => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
}

export interface PluginCompletionNotice {
  title: string;
  description: string;
  tone: "info" | "warning" | "destructive";
}
