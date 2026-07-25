//! Persisted-session startup and durable startup-strategy resolution.

use super::*;

pub(in crate::domains::sessions::runtime) fn choose_session_startup_strategy(
    record: &SessionRecord,
    session_store: &SessionStore,
) -> anyhow::Result<SessionStartupStrategy> {
    let is_fork_child =
        session_store.has_inbound_link_relation(&record.id, SessionLinkRelation::Fork)?;
    let fork_parent_native_session_id = if is_fork_child && record.last_prompt_at.is_none() {
        session_store
            .find_parent_by_inbound_link_relation(&record.id, SessionLinkRelation::Fork)?
            .map(|parent| parent.native_session_id)
    } else {
        None
    };
    choose_startup_strategy(&SessionStartupFacts {
        is_fork_child,
        native_session_id: record.native_session_id.clone(),
        fork_parent_native_session_id,
        agent_kind: record.agent_kind.clone(),
        has_last_prompt_at: record.last_prompt_at.is_some(),
        has_turn_started_event: session_store.has_turn_started_event(&record.id)?,
    })
}

impl SessionRuntime {
    #[tracing::instrument(skip_all, fields(session_id = %record.id))]
    pub async fn start_persisted_session(
        &self,
        record: &SessionRecord,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        self.start_persisted_session_with_process_policy(record, SessionProcessPolicy::Interactive)
            .await
    }

    pub(crate) async fn start_persisted_session_with_process_policy(
        &self,
        record: &SessionRecord,
        process_policy: SessionProcessPolicy,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        let transition = self.lock_session_process_transition(&record.id).await;
        self.start_persisted_session_with_process_policy_under_transition(
            record,
            process_policy,
            &transition,
        )
        .await
    }

    pub(crate) async fn start_persisted_session_with_process_policy_under_transition(
        &self,
        record: &SessionRecord,
        process_policy: SessionProcessPolicy,
        transition: &SessionProcessTransitionGuard,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        let live_start_started = Instant::now();
        let (_handle, native_session_id) = match self
            .start_live_session_under_transition(
                record,
                SessionStartupStrategy::Fresh,
                record.system_prompt_append.clone(),
                process_policy,
                transition,
            )
            .await
        {
            Ok(result) => {
                tracing::info!(
                    workspace_id = %record.workspace_id,
                    session_id = %record.id,
                    native_session_id = %result.1,
                    elapsed_ms = live_start_started.elapsed().as_millis(),
                    "[workspace-latency] session.runtime.live_session_started"
                );
                result
            }
            Err(error) => {
                self.mark_session_errored(&record.id);
                tracing::warn!(
                    workspace_id = %record.workspace_id,
                    session_id = %record.id,
                    elapsed_ms = live_start_started.elapsed().as_millis(),
                    error = ?error,
                    "[workspace-latency] session.runtime.live_session_failed"
                );
                return Err(map_start_session_error_to_create(error));
            }
        };

        let persist_started = Instant::now();
        self.persist_live_session_state(&record.id, &native_session_id);
        let updated = self
            .session_service
            .get_session(&record.id)
            .map_err(CreateAndStartSessionError::Internal)?
            .unwrap_or_else(|| {
                let mut fallback = record.clone();
                fallback.native_session_id = Some(native_session_id.clone());
                fallback.status = "idle".into();
                fallback
            });
        tracing::info!(
            workspace_id = %updated.workspace_id,
            session_id = %updated.id,
            native_session_id = %updated.native_session_id.as_deref().unwrap_or_default(),
            elapsed_ms = persist_started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.live_session_persisted"
        );
        Ok(updated)
    }
}
