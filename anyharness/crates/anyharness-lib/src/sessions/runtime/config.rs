use anyharness_contract::v1::{ConfigApplyState, SessionLiveConfigSnapshot};

use crate::acp::session_actor::{SessionCommand, SetConfigOptionCommandError};
use crate::sessions::mcp_bindings::assembly::SESSION_RESTART_REQUIRED_DETAIL;
use crate::sessions::model::SessionRecord;

use super::{
    SessionLifecycleError, SessionRuntime, SetSessionConfigOptionError, StartSessionError,
};

impl SessionRuntime {
    pub async fn set_live_session_config_option(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<
        (
            SessionRecord,
            Option<SessionLiveConfigSnapshot>,
            ConfigApplyState,
        ),
        SetSessionConfigOptionError,
    > {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                SetSessionConfigOptionError::Internal(anyhow::anyhow!(error.to_string()))
            })?;
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(session_id) => {
                    SetSessionConfigOptionError::SessionNotFound(session_id)
                }
                SessionLifecycleError::Internal(error) => {
                    SetSessionConfigOptionError::Internal(error)
                }
            })?;

        // Config mutations go through the live ACP actor. If the actor is not
        // running yet, start or resume it and return its control handle.
        let handle = self
            .ensure_live_session_handle(&record, None, None)
            .await
            .map_err(|error| match error {
                StartSessionError::WorkspaceNotFound => SetSessionConfigOptionError::Internal(
                    anyhow::anyhow!("workspace not found for session"),
                ),
                StartSessionError::AgentDescriptorNotFound(agent_kind) => {
                    SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                        "agent descriptor not found: {agent_kind}"
                    ))
                }
                StartSessionError::MissingDataKey | StartSessionError::RestartRequired(_) => {
                    SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                        "{SESSION_RESTART_REQUIRED_DETAIL}"
                    ))
                }
                StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
                    SetSessionConfigOptionError::Internal(error)
                }
            })?;

        // Send the config update command to the actor and attach a oneshot
        // reply channel so this specific request gets a single result back.
        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .command_tx
            .send(SessionCommand::SetConfigOption {
                config_id: config_id.to_string(),
                value: value.to_string(),
                respond_to: tx,
            })
            .await
            .is_err()
        {
            return Err(SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                "session actor channel closed"
            )));
        }

        let apply_state = rx
            .await
            .map_err(|_| {
                SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                    "session actor dropped config update response"
                ))
            })?
            .map_err(|error| match error {
                SetConfigOptionCommandError::Rejected(detail) => {
                    SetSessionConfigOptionError::Rejected(detail)
                }
            })?;

        // The actor persists any applied/queued changes. Reload the durable
        // session summary and latest live-config snapshot before returning.
        let updated = self
            .session_service
            .get_session(session_id)
            .map_err(SetSessionConfigOptionError::Internal)?
            .ok_or_else(|| SetSessionConfigOptionError::SessionNotFound(session_id.to_string()))?;
        let live_config = self
            .session_service
            .get_live_config_snapshot(session_id)
            .map_err(SetSessionConfigOptionError::Internal)?;

        Ok((updated, live_config, apply_state))
    }
}
