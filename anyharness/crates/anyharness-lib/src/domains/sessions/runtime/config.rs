use anyharness_contract::v1::{ConfigApplyState, SessionLiveConfigSnapshot};

use crate::domains::sessions::mcp_bindings::assembly::SESSION_RESTART_REQUIRED_DETAIL;
use crate::domains::sessions::model::SessionRecord;
use crate::live::sessions::{LiveSessionCommandError, SetConfigOptionCommandError};

use super::{
    SessionLifecycleError, SessionRuntime, SetSessionConfigOptionError, StartSessionError,
};

fn map_live_config_apply_result(
    result: Result<ConfigApplyState, LiveSessionCommandError<SetConfigOptionCommandError>>,
) -> Result<ConfigApplyState, SetSessionConfigOptionError> {
    match result {
        Ok(apply_state) => Ok(apply_state),
        Err(LiveSessionCommandError::ActorUnavailable) => Err(
            SetSessionConfigOptionError::Internal(anyhow::anyhow!("session actor channel closed")),
        ),
        Err(LiveSessionCommandError::ResponseDropped) => {
            Err(SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                "session actor dropped config update response"
            )))
        }
        Err(LiveSessionCommandError::Rejected(SetConfigOptionCommandError::Rejected(detail))) => {
            Err(SetSessionConfigOptionError::Rejected(detail))
        }
    }
}

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
            .ensure_live_session_handle(&record, None)
            .await
            .map_err(|error| match error {
                StartSessionError::WorkspaceNotFound => SetSessionConfigOptionError::Internal(
                    anyhow::anyhow!("workspace not found for session"),
                ),
                StartSessionError::WorkspaceDirectoryMissing { path } => {
                    SetSessionConfigOptionError::WorkspaceDirectoryMissing { path }
                }
                StartSessionError::AgentDescriptorNotFound(agent_kind) => {
                    SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                        "agent descriptor not found: {agent_kind}"
                    ))
                }
                StartSessionError::LaunchOptionsUnavailable { agent_kind, state } => {
                    SetSessionConfigOptionError::Rejected(format!(
                        "launch options are not available for agent '{agent_kind}' (state: {state:?})"
                    ))
                }
                StartSessionError::LaunchValueUnsupported {
                    agent_kind,
                    key,
                    value,
                    state,
                } => SetSessionConfigOptionError::Rejected(format!(
                    "launch value '{value}' for '{key}' is no longer supported for agent '{agent_kind}' (state: {state:?})"
                )),
                StartSessionError::AgentEnvOverrideUnsupported {
                    agent_kind,
                    env_var_name,
                } => SetSessionConfigOptionError::Rejected(format!(
                    "workspace/session environment cannot override agent-owned key '{env_var_name}' for '{agent_kind}'"
                )),
                StartSessionError::Closed => {
                    SetSessionConfigOptionError::Rejected("session is closed".to_string())
                }
                StartSessionError::MissingDataKey | StartSessionError::RestartRequired(_) => {
                    SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                        "{SESSION_RESTART_REQUIRED_DETAIL}"
                    ))
                }
                StartSessionError::WorkspaceMcpAttachmentFailed(error) => {
                    SetSessionConfigOptionError::Internal(anyhow::Error::new(error))
                }
                StartSessionError::RouteAuth(error) => {
                    SetSessionConfigOptionError::Rejected(error.to_string())
                }
                // A9 Scope C: config lazy-start hits the same live-start
                // readiness gate as resume/fork/create/prompt now.
                // SetSessionConfigOptionError has no dedicated readiness
                // variant, so this rides Rejected, same shape as the
                // RouteAuth arm above.
                StartSessionError::AgentNotReady {
                    agent_kind,
                    status,
                    detail,
                } => SetSessionConfigOptionError::Rejected(match detail {
                    Some(detail) => {
                        format!("agent '{agent_kind}' is not ready (status: {status:?}): {detail}")
                    }
                    None => format!("agent '{agent_kind}' is not ready (status: {status:?})"),
                }),
                StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
                    SetSessionConfigOptionError::Internal(error)
                }
            })?;

        // Active-session model authorization comes only from this session's
        // latest full live snapshot. Target observations and catalogs cannot
        // add a value to the running session.
        let live_snapshot_authorized_model = self
            .session_service
            .live_model_switch_authorized(&record, value);

        // Send the config update command to the actor and attach a oneshot
        // reply channel so this specific request gets a single result back.
        let live_result = handle
            .set_config_option(
                config_id.to_string(),
                value.to_string(),
                live_snapshot_authorized_model,
            )
            .await;
        // A live refusal is terminal for this mutation. Relaunching from a
        // rewritten session row would execute a model/control state that was
        // never confirmed by the active harness and differs from the immutable
        // launch intent validated at the common start seam.
        let apply_state = map_live_config_apply_result(live_result)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_refusal_is_terminal_even_for_snapshot_authorized_model() {
        let error = map_live_config_apply_result(Err(LiveSessionCommandError::Rejected(
            SetConfigOptionCommandError::Rejected("agent kept its current model".to_string()),
        )))
        .expect_err("a live refusal must not be converted into Applied");

        assert!(matches!(
            error,
            SetSessionConfigOptionError::Rejected(detail)
                if detail == "agent kept its current model"
        ));
    }
}
