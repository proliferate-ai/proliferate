//! Persist-first agent-message queueing and its detached best-effort wake.

use std::sync::Arc;
use std::time::Duration;

use super::prompt::map_lifecycle_error_to_prompt;
use super::prompt_dispatch::durable_prompt_start_failure_code;
use super::{SendPromptError, SessionRuntime};
use crate::domains::sessions::prompt::provenance::AgentSessionPromptSource;

impl SessionRuntime {
    /// Persist-first cross-agent delivery. The pending-row sequence is the
    /// acceptance linearization point. Actor startup and the bounded queue wake
    /// are detached after that commit and are best-effort because startup queue
    /// replay owns eventual processing.
    pub(crate) async fn enqueue_agent_message(
        self: Arc<Self>,
        session_id: &str,
        message: String,
        source: AgentSessionPromptSource,
    ) -> Result<i64, SendPromptError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SendPromptError::Internal(anyhow::anyhow!(error.to_string())))?;
        if message.trim().is_empty() {
            return Err(SendPromptError::EmptyPrompt);
        }
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(map_lifecycle_error_to_prompt)?;
        if super::launch_policy::session_is_closed(&record) {
            return Err(SendPromptError::SessionClosed);
        }
        let payload = crate::domains::sessions::prompt::PromptPayload::text(message)
            .with_provenance(source.into_provenance());
        let pending = self
            .session_service
            .store()
            .insert_pending_prompt_payload(session_id, &payload, None)
            .map_err(SendPromptError::Internal)?;

        // The spawned task runs without the caller's workspace lease. The row
        // is already durable, so startup replay owns eventual delivery and an
        // inline wake must not block the MCP receipt for startup readiness.
        let queue_seq = pending.seq;
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            self.activate_durable_prompt_consumer(&session_id, payload, queue_seq)
                .await;
        });
        Ok(queue_seq)
    }

    pub(crate) async fn activate_durable_prompt_consumer(
        &self,
        session_id: &str,
        payload: crate::domains::sessions::prompt::PromptPayload,
        queue_seq: i64,
    ) {
        const WAKE_ACK_TIMEOUT: Duration = Duration::from_secs(1);
        let record = match self.get_session_or_not_found(session_id) {
            Ok(record) => record,
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    queue_seq,
                    error = ?error,
                    "durable prompt consumer activation skipped; pending prompt will replay"
                );
                return;
            }
        };
        let handle = match self.ensure_live_session_handle(&record, None).await {
            Ok(handle) => handle,
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    queue_seq,
                    failure_code = durable_prompt_start_failure_code(&error),
                    "durable prompt consumer startup failed; pending prompt will replay"
                );
                return;
            }
        };
        match tokio::time::timeout(
            WAKE_ACK_TIMEOUT,
            handle.send_queued_prompt(payload, queue_seq),
        )
        .await
        {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => tracing::warn!(
                session_id = %session_id,
                queue_seq,
                error = ?error,
                "durable prompt wake acknowledgement was lost; pending prompt will replay"
            ),
            Err(_) => tracing::warn!(
                session_id = %session_id,
                queue_seq,
                timeout_ms = WAKE_ACK_TIMEOUT.as_millis(),
                "durable prompt wake acknowledgement timed out; pending prompt will replay"
            ),
        }
    }
}
