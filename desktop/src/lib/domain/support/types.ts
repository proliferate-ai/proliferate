export interface SupportMessageContext {
  source: "sidebar" | "home" | "settings" | "cloud_gated";
  intent: "general" | "unlimited_cloud" | "team_features";
  pathname?: string | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
  workspaceLocation?: "cloud" | "local" | null;
}
