use std::sync::{Arc, OnceLock, Weak};

use async_trait::async_trait;

use super::{LoopFireRecordOp, LoopFireRecordOutput, LOOP_FIRED_PROVENANCE_LABEL};
use crate::domains::loops::scheduler::{LoopFireExecutor, LoopFireReport, LoopSessionLiveness};
use crate::domains::loops::service::LoopService;
use crate::domains::sessions::admission::{
    SessionMutationAdmission, SessionMutationKind, SessionMutationSource,
};
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::live::sessions::LiveSessionManager;

/// The scheduler's session-facing half: liveness plus an emulated fire whose
/// prompt delivery and accounting share one session-mutation permit.
pub struct SessionLoopFireExecutor {
    loop_service: Arc<LoopService>,
    acp_manager: LiveSessionManager,
    session_admission: Arc<SessionMutationAdmission>,
    session_runtime: OnceLock<Weak<SessionRuntime>>,
}

impl SessionLoopFireExecutor {
    pub fn new(
        loop_service: Arc<LoopService>,
        acp_manager: LiveSessionManager,
        session_admission: Arc<SessionMutationAdmission>,
    ) -> Self {
        Self {
            loop_service,
            acp_manager,
            session_admission,
            session_runtime: OnceLock::new(),
        }
    }

    pub fn bind_session_runtime(&self, runtime: &Arc<SessionRuntime>) {
        assert!(
            self.session_runtime.set(Arc::downgrade(runtime)).is_ok(),
            "loop fire executor session runtime bound twice"
        );
    }
}

#[async_trait]
impl LoopFireExecutor for SessionLoopFireExecutor {
    async fn liveness(&self, session_id: &str) -> LoopSessionLiveness {
        match self.acp_manager.get_handle(session_id).await {
            None => LoopSessionLiveness::Dead,
            Some(handle) if handle.is_busy() => LoopSessionLiveness::Busy,
            Some(_) => LoopSessionLiveness::Idle,
        }
    }

    async fn fire(&self, session_id: &str, loop_id: &str) -> Option<LoopFireReport> {
        // Reversible Close either wins first and rejects this fire, or waits
        // until this accepted prompt and its accounting have completed.
        let _permit = self
            .session_admission
            .acquire(
                session_id,
                SessionMutationKind::Loop,
                &SessionMutationSource::external(),
            )
            .await
            .ok()?;
        // Preserve the original live-only contract: an emulated fire never
        // cold-starts a dead actor merely to deliver its scheduled prompt.
        let handle = self.acp_manager.get_handle(session_id).await?;
        let record = self
            .loop_service
            .store()
            .find_one(session_id, loop_id)
            .ok()
            .flatten()?;
        if !record.is_active() || record.native {
            return None;
        }
        let runtime = self.session_runtime.get()?.upgrade()?;
        runtime
            .send_text_prompt_with_provenance_on_existing_handle(
                session_id,
                record.prompt.clone(),
                PromptProvenance::System {
                    label: Some(LOOP_FIRED_PROVENANCE_LABEL.to_string()),
                },
                handle.clone(),
            )
            .await
            .ok()?;
        let op = Box::new(LoopFireRecordOp {
            loop_service: self.loop_service.clone(),
            loop_id: loop_id.to_string(),
            fired_at_ms: chrono::Utc::now().timestamp_millis(),
        });
        let reply = handle.run_domain_op(op).await.ok()?;
        reply.downcast::<LoopFireRecordOutput>().ok()?.report
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::runtime::prompt_message_actor_tests::{
        build_state, install_scripted_agent_env, read_requests, stop_target_actor,
        temp_runtime_home, write_scripted_agent,
    };
    use crate::domains::workspaces::checkpoints::test_support::EnvGuard;
    use crate::persistence::Db;

    #[tokio::test(flavor = "current_thread")]
    async fn live_only_prompt_uses_the_exact_preflight_handle_without_substitution() {
        let _capture = EnvGuard::off().await;
        let _bearer = test_support::set_bearer_token_env(None);
        let _data_key = test_support::set_data_key_env(None);
        let runtime_home = temp_runtime_home("loop-exact-handle");
        let state = build_state(
            &runtime_home,
            Db::open_in_memory().expect("open in-memory db"),
            true,
        );
        state
            .acp_manager
            .insert_unavailable_session_for_test("target")
            .await;
        let preflight_handle = state
            .acp_manager
            .get_handle("target")
            .await
            .expect("preflight handle");
        let mut replacement_observed = state
            .acp_manager
            .insert_prompt_observer_for_test("target")
            .await;

        let error = state
            .session_runtime
            .send_text_prompt_with_provenance_on_existing_handle(
                "target",
                "must not reach the replacement".into(),
                PromptProvenance::System {
                    label: Some(LOOP_FIRED_PROVENANCE_LABEL.into()),
                },
                preflight_handle,
            )
            .await
            .expect_err("the stale preflight handle is unavailable");
        assert!(
            matches!(
                error,
                crate::domains::sessions::runtime::SendPromptError::Internal(ref error)
                    if error.to_string() == "session actor channel closed"
            ),
            "the exact unavailable handle must own the failure: {error:?}"
        );
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(30),
                replacement_observed.recv(),
            )
            .await
            .is_err(),
            "the replacement actor must not receive the scheduled prompt"
        );

        drop(state);
        std::fs::remove_dir_all(runtime_home).expect("remove runtime home");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dead_session_fire_is_a_noop_and_does_not_cold_start() {
        let _capture = EnvGuard::off().await;
        let _bearer = test_support::set_bearer_token_env(None);
        let _data_key = test_support::set_data_key_env(None);
        // A process-level capture flag inherited by the test runner could make
        // an incorrect cold-start path abort before reaching the scripted
        // actor, so force it off for this negative control.
        let runtime_home = temp_runtime_home("dead-loop-fire");
        let scripted_agent = write_scripted_agent(&runtime_home);
        let (_program, _args) = install_scripted_agent_env(&scripted_agent);
        let state = build_state(
            &runtime_home,
            Db::open_in_memory().expect("open in-memory db"),
            true,
        );
        state
            .loop_service
            .store()
            .seed_emulated_for_test(
                "target",
                "workspace-b",
                "dead-loop",
                "must remain dormant",
                1,
            )
            .expect("seed emulated loop");

        let executor = SessionLoopFireExecutor::new(
            state.loop_service.clone(),
            state.acp_manager.clone(),
            state.session_admission.clone(),
        );
        executor.bind_session_runtime(&state.session_runtime);
        let permit = state
            .session_admission
            .acquire(
                "target",
                SessionMutationKind::Loop,
                &SessionMutationSource::external(),
            )
            .await
            .expect("ordinary session admits loop mutation");
        drop(permit);
        assert_eq!(executor.liveness("target").await, LoopSessionLiveness::Dead);
        assert!(state.acp_manager.get_handle("target").await.is_none());
        assert!(read_requests(&scripted_agent.request_log).is_empty());

        let report = executor.fire("target", "dead-loop").await;
        let cold_started = state.acp_manager.get_handle("target").await.is_some();
        let requests = read_requests(&scripted_agent.request_log);
        let record = state
            .loop_service
            .store()
            .find_one("target", "dead-loop")
            .expect("read loop after skipped fire")
            .expect("loop remains persisted");
        if cold_started {
            stop_target_actor(&state).await;
        }
        drop(state);
        std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");

        assert!(report.is_none(), "a dead session cannot accept a loop fire");
        assert!(!cold_started, "a loop fire must not cold-start its session");
        assert!(
            requests.is_empty(),
            "the scripted agent must receive no startup or prompt requests: {requests:?}"
        );
        assert!(record.is_active());
        assert_eq!(record.fire_count, 0);
        assert_eq!(record.last_fired_at_ms, None);
        assert_eq!(record.next_fire_at_ms, Some(1));
    }
}
