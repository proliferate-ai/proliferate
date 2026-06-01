import type { PluginSettings, PluginSurfaceKind } from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import type { PluginIconRenderer } from "@proliferate/product-ui/plugins/PluginsSurface";

export interface PluginOAuthCompletionState {
  source: "mcp_oauth_callback";
  status: string | null;
  flowId: string | null;
  failureCode: string | null;
}

export interface PluginOAuthHandoff {
  open: (url: string) => void | Promise<void>;
  close?: () => void;
}

export interface CloudPluginsLocalOAuthAdapter {
  connect: (input: {
    catalogEntryId: string;
    settings?: PluginSettings;
  }) => Promise<void>;
  reconnect: (input: {
    connectionId: string;
    catalogEntryId: string;
    settings?: PluginSettings;
  }) => Promise<void>;
  delete: (input: {
    connectionId: string;
    catalogEntryId: string;
  }) => Promise<void>;
  cancelPending?: () => Promise<void>;
  getCredentialStatus?: (input: {
    connectionId: string;
    catalogEntryId: string;
    settings?: PluginSettings;
  }) => Promise<"ready" | "not_ready">;
}

export interface CloudPluginsSurfaceProps {
  surface: PluginSurfaceKind;
  enabled?: boolean;
  completion?: PluginOAuthCompletionState | null;
  localOAuthAdapter?: CloudPluginsLocalOAuthAdapter;
  renderIcon?: PluginIconRenderer;
  onCompletionHandled?: () => void;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenDesktop?: () => void | Promise<void>;
  prepareOAuthHandoff?: () => PluginOAuthHandoff | null;
}
