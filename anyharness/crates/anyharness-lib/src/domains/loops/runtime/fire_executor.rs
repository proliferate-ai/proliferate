use std::sync::Arc;

use async_trait::async_trait;

use super::{LoopFireRecordOp, LoopFireRecordOutput, LOOP_FIRED_PROVENANCE_LABEL};
use crate::domains::loops::scheduler::{LoopFireExecutor, LoopFireReport, LoopSessionLiveness};
use crate::domains::loops::service::LoopService;
use crate::domains::sessions::admission::{
    SessionMutationAdmission, SessionMutationKind, SessionMutationSource,
};
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::prompt::PromptPayload;
use crate::live::sessions::LiveSessionManager;

/// The scheduler's session-facing half: liveness plus an emulated fire whose
/// prompt delivery and accounting share one session-mutation permit.
pub struct SessionLoopFireExecutor {
    loop_service: Arc<LoopService>,
    acp_manager: LiveSessionManager,
    session_admission: Arc<SessionMutationAdmission>,
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
        }
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
        let payload =
            PromptPayload::text(record.prompt.clone()).with_provenance(PromptProvenance::System {
                label: Some(LOOP_FIRED_PROVENANCE_LABEL.to_string()),
            });
        if handle.send_prompt(payload, None).await.is_err() {
            return None;
        }
        let op = Box::new(LoopFireRecordOp {
            loop_service: self.loop_service.clone(),
            loop_id: loop_id.to_string(),
            fired_at_ms: chrono::Utc::now().timestamp_millis(),
        });
        let reply = handle.run_domain_op(op).await.ok()?;
        reply.downcast::<LoopFireRecordOutput>().ok()?.report
    }
}
