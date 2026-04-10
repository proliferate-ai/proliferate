import type { CloudAgentKind } from "@/lib/integrations/cloud/client";
import type { TelemetryFailureKind } from "./failures";

export type DesktopTelemetryRoute = "login" | "main" | "settings" | "setup" | "unknown";
export type DesktopWorkspaceKind = "cloud" | "local";
export type RuntimeConnectionTelemetryState = "connecting" | "failed" | "healthy";
export type AuthTelemetryProvider = "dev_bypass" | "github";
export type AuthSignInSource = "desktop_callback" | "dev_bypass" | "interactive_poll";
export type WorkspaceCreationKind = "repo" | "worktree" | "local";
export type WorkspaceOpenSource = "filesystem";
export type SetupScriptTelemetryStatus = "failed" | "not_run" | "succeeded";
export type ConnectorSkipReasonKind =
  | "missing_secret"
  | "missing_stdio_command"
  | "workspace_path_unresolved"
  | "unsupported_target";

export interface DesktopProductEventMap {
  app_update_available: { version: string };
  app_update_check_started: undefined;
  app_update_download_started: { version: string | null };
  app_update_install_failed: {
    failure_kind: TelemetryFailureKind;
    version: string | null;
  };
  app_update_install_succeeded: { version: string | null };
  auth_sign_in_failed: {
    failure_kind: TelemetryFailureKind;
    provider: AuthTelemetryProvider;
  };
  auth_signed_in: {
    provider: AuthTelemetryProvider;
    source: AuthSignInSource;
  };
  auth_signed_out: {
    provider: AuthTelemetryProvider;
  };
  chat_pending_prompt_deleted: {
    agent_kind: string;
    workspace_kind: DesktopWorkspaceKind;
  };
  chat_pending_prompt_edited: {
    agent_kind: string;
    workspace_kind: DesktopWorkspaceKind;
  };
  chat_prompt_submitted: {
    agent_kind: string;
    reuse_session: boolean;
    workspace_kind: DesktopWorkspaceKind;
  };
  chat_session_created: {
    agent_kind: string;
    workspace_kind: DesktopWorkspaceKind;
  };
  cloud_credential_deleted: {
    provider: CloudAgentKind;
  };
  cloud_credential_synced: {
    provider: CloudAgentKind;
  };
  cloud_repo_config_saved: {
    env_var_count: number;
    tracked_file_count: number;
    has_setup_script: boolean;
  };
  cloud_repo_file_resynced: {
    tracked_file_count: number;
  };
  cloud_workspace_created: {
    git_provider: string;
    status: string;
    workspace_kind: "cloud";
  };
  cloud_workspace_deleted: {
    workspace_kind: "cloud";
  };
  cloud_workspace_started: {
    git_provider: string;
    status: string;
    workspace_kind: "cloud";
  };
  cloud_workspace_stopped: {
    git_provider: string;
    status: string;
    workspace_kind: "cloud";
  };
  cloud_workspace_repo_files_resynced: {
    files_out_of_sync: boolean;
    tracked_file_count: number;
  };
  cloud_workspace_credentials_resynced: undefined;
  cloud_workspace_setup_started: {
    has_saved_script: boolean;
  };
  connector_connect_clicked: {
    connector_id: string;
    auth_style: string;
    availability: string;
  };
  connector_deleted: {
    connector_id: string;
  };
  connector_install_failed: {
    connector_id: string;
    failure_kind: TelemetryFailureKind;
  };
  connector_install_succeeded: {
    connector_id: string;
    result: "synced" | "degraded";
  };
  connector_skipped_at_launch: {
    connector_id: string;
    reason_kind: ConnectorSkipReasonKind;
  };
  connector_sync_degraded: {
    connector_id: string;
  };
  connector_sync_recovered: {
    connector_id: string;
  };
  connector_sync_retry_clicked: {
    connector_id: string | "all";
  };
  connector_toggled: {
    connector_id: string;
    enabled: boolean;
  };
  connector_updated: {
    connector_id: string;
    result: "synced" | "degraded";
  };
  connectors_pane_viewed: undefined;
  runtime_connection_state_changed: {
    connection_state: RuntimeConnectionTelemetryState;
    has_error: boolean;
  };
  screen_viewed: {
    route: DesktopTelemetryRoute;
  };
  workspace_created: {
    creation_kind: WorkspaceCreationKind;
    setup_script_status?: SetupScriptTelemetryStatus;
    workspace_kind: "local";
  };
  workspace_opened: {
    source: WorkspaceOpenSource;
    workspace_kind: "local";
  };
  workspace_selected: {
    workspace_kind: DesktopWorkspaceKind;
  };
}
