import type { CloudAgentKind } from "@/lib/integrations/cloud/client";
import type { TelemetryFailureKind } from "./failures";

export type DesktopTelemetryRoute =
  | "automations"
  | "login"
  | "main"
  | "settings"
  | "setup"
  | "unknown";
export type DesktopWorkspaceKind = "cloud" | "local";
export type RuntimeConnectionTelemetryState = "connecting" | "failed" | "healthy";
export type RuntimeInputSyncTelemetryTrigger =
  | "preference_enabled"
  | "startup"
  | "online"
  | "hourly"
  | "retry"
  | "credential_mutation"
  | "repo_config_mutation"
  | "runtime_reconnected";
export type RuntimeInputSyncTelemetrySourceKind =
  | "credential"
  | "repo_tracked_file";
export type TrackedFileTelemetrySource = "workspace" | "repo_root";
export type RuntimeInputSyncTelemetryFailureKind =
  | "cloud_unavailable"
  | "missing_local_source"
  | "needs_reconnect"
  | "too_large"
  | "runtime_unavailable"
  | "request_failed";
export type AuthTelemetryProvider = "dev_bypass" | "github";
export type AuthSignInSource = "desktop_callback" | "dev_bypass" | "interactive_poll";
export type WorkspaceCreationKind = "repo" | "worktree" | "local";
export type WorkspaceOpenSource = "filesystem";
export type SetupScriptTelemetryStatus = "failed" | "not_run" | "succeeded";
export type ConnectorSkipReasonKind =
  | "missing_secret"
  | "needs_reconnect"
  | "command_missing"
  | "invalid_settings"
  | "refresh_failed"
  | "workspace_path_unresolved"
  | "unsupported_target"
  | "resolver_error";
export type AgentSeedTelemetryStatus = "ready" | "partial";
export type AgentSeedTelemetryFailureStatus = "failed" | "missing_bundled_seed";
export type AgentSeedTelemetrySource = "bundled" | "external_dev" | "none";
export type AgentSeedTelemetryOwnership =
  | "full_seed"
  | "partial_seed"
  | "user_owned_existing"
  | "not_configured";
export type AgentSeedTelemetryLastAction = "none" | "hydrated" | "repaired";
export type AgentSeedTelemetryFailureKind =
  | "missing_archive"
  | "invalid_checksum"
  | "invalid_manifest"
  | "invalid_archive"
  | "io"
  | "unsupported_target"
  | "verification_failed";

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
  agent_seed_hydrated: {
    status: AgentSeedTelemetryStatus;
    source: AgentSeedTelemetrySource;
    ownership: AgentSeedTelemetryOwnership;
    last_action: AgentSeedTelemetryLastAction;
    seeded_agent_count: number;
    seed_owned_artifact_count: number;
    skipped_existing_artifact_count: number;
    repaired_artifact_count: number;
  };
  agent_seed_hydration_failed: {
    status: AgentSeedTelemetryFailureStatus;
    source: AgentSeedTelemetrySource;
    failure_kind: AgentSeedTelemetryFailureKind | "unknown";
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
    tracked_file_source?: TrackedFileTelemetrySource;
    has_setup_script: boolean;
    has_run_command: boolean;
  };
  cloud_repo_file_resynced: {
    tracked_file_count: number;
    tracked_file_source: TrackedFileTelemetrySource;
  };
  cloud_workspace_created: {
    attempt_count: number;
    git_provider: string;
    retry_count: number;
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
    result: "synced";
  };
  connector_skipped_at_launch: {
    connector_id: string;
    reason_kind: ConnectorSkipReasonKind;
  };
  connector_toggled: {
    connector_id: string;
    enabled: boolean;
  };
  connector_updated: {
    connector_id: string;
    result: "synced";
  };
  connectors_pane_viewed: undefined;
  runtime_connection_state_changed: {
    connection_state: RuntimeConnectionTelemetryState;
    has_error: boolean;
  };
  runtime_input_sync_cycle_completed: {
    trigger: RuntimeInputSyncTelemetryTrigger;
    credential_count: number;
    repo_file_count: number;
    failure_count: number;
  };
  runtime_input_sync_item_failed: {
    source_kind: RuntimeInputSyncTelemetrySourceKind;
    tracked_file_source?: TrackedFileTelemetrySource | null;
    failure_kind: RuntimeInputSyncTelemetryFailureKind;
  };
  runtime_input_sync_toggled: {
    enabled: boolean;
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
  onboarding_step_viewed: {
    step: "intent" | "workflow" | "recommendations";
  };
  onboarding_completed: {
    goal_id: string | null;
    recommended_agent_kind: string | null;
    deferred_defaults: boolean;
  };
  onboarding_defaults_finalized: {
    goal_id: string | null;
    recommended_agent_kind: string;
  };
  onboarding_home_landing_viewed: {
    goal_id: string | null;
  };
}
