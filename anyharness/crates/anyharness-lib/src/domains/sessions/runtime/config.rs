use anyharness_contract::v1::{ConfigApplyState, SessionLiveConfigSnapshot};

use crate::domains::sessions::mcp_bindings::assembly::SESSION_RESTART_REQUIRED_DETAIL;
use crate::domains::sessions::model::SessionRecord;
use crate::live::sessions::{LiveSessionCommandError, SetConfigOptionCommandError};

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
            .ensure_live_session_handle(&record, None)
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
                StartSessionError::Closed => {
                    SetSessionConfigOptionError::Rejected("session is closed".to_string())
                }
                StartSessionError::MissingDataKey
                | StartSessionError::RestartRequired(_)
                | StartSessionError::AgentAuthSelectionRequired(_) => {
                    SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                        "{SESSION_RESTART_REQUIRED_DETAIL}"
                    ))
                }
                StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
                    SetSessionConfigOptionError::Internal(error)
                }
            })?;

        // Catalog authorization for model switches: a value outside the
        // harness-advertised option list still applies when the catalog
        // validates it for this session's recorded auth contexts.
        let catalog_authorized_model = self
            .session_service
            .live_model_switch_authorized(&record, value);

        // Send the config update command to the actor and attach a oneshot
        // reply channel so this specific request gets a single result back.
        let live_result = handle
            .set_config_option(
                config_id.to_string(),
                value.to_string(),
                catalog_authorized_model,
            )
            .await;
        let apply_state = match live_result {
            Ok(apply_state) => apply_state,
            // Live-or-relaunch (decision 10): when the harness has no live
            // mechanism for a catalog-authorized model (gemini exposes no
            // config options; an adapter may refuse a foreign id), the
            // SESSION still never recreates — persist the model on the
            // record, retire the agent process, and relaunch it under the
            // same session with the new launch env.
            Err(LiveSessionCommandError::Rejected(SetConfigOptionCommandError::Rejected(
                detail,
            ))) if catalog_authorized_model => {
                tracing::info!(
                    session_id,
                    config_id,
                    value,
                    detail,
                    "live model apply unavailable; switching via relaunch"
                );
                self.relaunch_session_with_model(&record, value).await?;
                ConfigApplyState::Applied
            }
            Err(LiveSessionCommandError::ActorUnavailable) => {
                return Err(SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                    "session actor channel closed"
                )))
            }
            Err(LiveSessionCommandError::ResponseDropped) => {
                return Err(SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                    "session actor dropped config update response"
                )))
            }
            Err(LiveSessionCommandError::Rejected(SetConfigOptionCommandError::Rejected(
                detail,
            ))) => return Err(SetSessionConfigOptionError::Rejected(detail)),
        };

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

    /// The relaunch arm of live-or-relaunch: persist the new model on the
    /// record, retire the live agent process, and bring the SAME session
    /// back up — the relaunch composes its launch env (and startup model
    /// preference) from the persisted selection.
    async fn relaunch_session_with_model(
        &self,
        record: &crate::domains::sessions::model::SessionRecord,
        model_id: &str,
    ) -> Result<(), SetSessionConfigOptionError> {
        self.session_service
            .store()
            .update_model_selection(&record.id, model_id, &chrono::Utc::now().to_rfc3339())
            .map_err(SetSessionConfigOptionError::Internal)?;

        if let Some(handle) = self.acp_manager.get_handle(&record.id).await {
            let _ = handle.close().await;
        }
        for _ in 0..40 {
            if !self.has_live_session(&record.id).await {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        self.ensure_live_session(&record.id, None)
            .await
            .map_err(|error| {
                SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                    "failed to relaunch session with new model: {error:?}"
                ))
            })?;
        Ok(())
    }
}
