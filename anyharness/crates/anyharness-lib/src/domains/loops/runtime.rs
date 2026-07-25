//! `LoopRuntime`: runtime write ops for loops (spec §2.7).
//!
//! Native sessions (claude, `supports_loops`) round-trip writes through the
//! sidecar LoopPort ext methods; the mirror transitions when the tagged
//! notification is ingested. Harnesses without LoopPort but with the
//! catalog `loops: emulated` capability (codex) get runtime-owned loops
//! fired by [`LoopSchedulerExtension`](super::scheduler::LoopSchedulerExtension).

use std::sync::Arc;

use anyharness_contract::v1::{
    ClearSessionLoopsResponse, ListSessionLoopsResponse, LoopScheduleKind, SessionLoopResponse,
    SetSessionLoopRequest,
};

use super::model::{loop_to_contract, parse_interval_expr, LoopWriteIntent};
use super::ops::{
    EmulatedLoopClearOp, EmulatedLoopClearOpOutput, EmulatedLoopCreateOp,
    EmulatedLoopCreateOpOutput,
};
use super::scheduler::LoopSchedulerExtension;
use super::service::{EmulatedLoopSpec, LoopService};
use super::wire::LoopWire;
use crate::domains::agents::catalog::schema::AgentCatalogLoopsCapability;
use crate::domains::agents::catalog::service::AgentCatalogService;
use crate::domains::sessions::model::{parse_action_capabilities, SessionRecord};
use crate::domains::sessions::service::SessionService;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::live::sessions::LiveSessionManager;

pub const LOOP_SET_EXT_METHOD: &str = "_anyharness/loop/set";
pub const LOOP_CLEAR_EXT_METHOD: &str = "_anyharness/loop/clear";
pub const LOOP_LIST_EXT_METHOD: &str = "_anyharness/loop/list";

#[derive(Debug, thiserror::Error)]
pub enum LoopRuntimeError {
    #[error("session not found")]
    SessionNotFound,
    #[error("loop not found")]
    LoopNotFound,
    #[error("session agent does not support loops")]
    Unsupported,
    #[error("session is not running; native loops require a live session")]
    SessionNotRunning,
    #[error("{0}")]
    InvalidRequest(String),
    #[error("loop ext method failed: {0}")]
    Ext(anyhow::Error),
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

#[derive(Clone)]
pub struct LoopRuntime {
    loop_service: Arc<LoopService>,
    session_service: Arc<SessionService>,
    catalog: AgentCatalogService,
    acp_manager: LiveSessionManager,
    access_gate: Arc<WorkspaceAccessGate>,
    scheduler: Arc<LoopSchedulerExtension>,
}

impl LoopRuntime {
    pub fn new(
        loop_service: Arc<LoopService>,
        session_service: Arc<SessionService>,
        catalog: AgentCatalogService,
        acp_manager: LiveSessionManager,
        access_gate: Arc<WorkspaceAccessGate>,
        scheduler: Arc<LoopSchedulerExtension>,
    ) -> Self {
        Self {
            loop_service,
            session_service,
            catalog,
            acp_manager,
            access_gate,
            scheduler,
        }
    }

    pub fn loop_service(&self) -> &Arc<LoopService> {
        &self.loop_service
    }

    pub async fn set_loop(
        &self,
        session_id: &str,
        request: SetSessionLoopRequest,
    ) -> Result<SessionLoopResponse, LoopRuntimeError> {
        let session = self.session_for_mutation(session_id)?;
        let prompt = request.prompt.trim();
        if prompt.is_empty() {
            return Err(LoopRuntimeError::InvalidRequest(
                "loop prompt must not be empty".to_string(),
            ));
        }
        let expr = request.schedule.expr.trim();
        if expr.is_empty() {
            return Err(LoopRuntimeError::InvalidRequest(
                "loop schedule expression must not be empty".to_string(),
            ));
        }

        match self.loop_substrate(&session) {
            LoopSubstrate::Native => {
                self.set_native_loop(&session, prompt, expr, &request).await
            }
            LoopSubstrate::Emulated => {
                self.set_emulated_loop(&session, prompt, expr, &request)
                    .await
            }
            LoopSubstrate::None => Err(LoopRuntimeError::Unsupported),
        }
    }

    async fn set_native_loop(
        &self,
        session: &SessionRecord,
        prompt: &str,
        expr: &str,
        request: &SetSessionLoopRequest,
    ) -> Result<SessionLoopResponse, LoopRuntimeError> {
        let handle = self
            .acp_manager
            .get_handle(&session.id)
            .await
            .ok_or(LoopRuntimeError::SessionNotRunning)?;
        self.loop_service.record_write_intent(
            &session.id,
            LoopWriteIntent {
                prompt: prompt.to_string(),
                source_kind: "user".to_string(),
                source_run_id: None,
                max_fires: request.max_fires,
                max_wall_secs: request.max_wall_secs,
            },
        );
        let kind = match request.schedule.kind {
            LoopScheduleKind::Interval => "interval",
            LoopScheduleKind::Cron => "cron",
        };
        let response = handle
            .call_agent_ext_method(
                LOOP_SET_EXT_METHOD,
                serde_json::json!({
                    "prompt": prompt,
                    "schedule": { "kind": kind, "expr": expr },
                    "recurring": request.recurring,
                }),
            )
            .await
            .map_err(|error| LoopRuntimeError::Ext(anyhow::anyhow!("{error:?}")))?;

        // Optimistic-pending: report the mirror row when the notification
        // already landed; otherwise the event stream carries loop_updated.
        let native_loop_id = response
            .get("loop")
            .and_then(LoopWire::from_value)
            .and_then(|wire| wire.loop_id);
        let mirror = match native_loop_id {
            Some(native_loop_id) => self
                .loop_service
                .list_active_by_session(&session.id)
                .map_err(LoopRuntimeError::Store)?
                .into_iter()
                .find(|record| record.native_loop_id.as_deref() == Some(&native_loop_id)),
            None => None,
        };
        Ok(SessionLoopResponse {
            accepted: true,
            loop_: mirror.as_ref().map(loop_to_contract),
        })
    }

    async fn set_emulated_loop(
        &self,
        session: &SessionRecord,
        prompt: &str,
        expr: &str,
        request: &SetSessionLoopRequest,
    ) -> Result<SessionLoopResponse, LoopRuntimeError> {
        if request.schedule.kind != LoopScheduleKind::Interval
            || parse_interval_expr(expr).is_none()
        {
            return Err(LoopRuntimeError::InvalidRequest(
                "emulated loops support interval schedules only (e.g. \"5m\", \"30s\", \"1h\")"
                    .to_string(),
            ));
        }
        let spec = EmulatedLoopSpec {
            prompt: prompt.to_string(),
            schedule_expr: expr.to_string(),
            recurring: request.recurring,
            max_fires: request.max_fires,
            max_wall_secs: request.max_wall_secs,
            source_kind: "user".to_string(),
            source_run_id: None,
        };
        let record = match self.acp_manager.get_handle(&session.id).await {
            Some(handle) => {
                let op = Box::new(EmulatedLoopCreateOp {
                    loop_service: self.loop_service.clone(),
                    spec,
                });
                let reply = handle.run_domain_op(op).await.map_err(|error| {
                    LoopRuntimeError::Store(anyhow::anyhow!("loop create op: {error:?}"))
                })?;
                let output = reply.downcast::<EmulatedLoopCreateOpOutput>().map_err(|_| {
                    LoopRuntimeError::Store(anyhow::anyhow!(
                        "loop create op returned unexpected reply type"
                    ))
                })?;
                output.result.map_err(LoopRuntimeError::Store)?
            }
            None => {
                let (record, _) = self
                    .loop_service
                    .create_emulated_offline(&session.id, &session.workspace_id, &spec)
                    .map_err(LoopRuntimeError::Store)?;
                record
            }
        };
        self.scheduler.arm_session(&session.id);
        Ok(SessionLoopResponse {
            accepted: true,
            loop_: Some(loop_to_contract(&record)),
        })
    }

    /// Clear one loop by mirror id, or every loop for the session when
    /// `loop_id` is `None`.
    pub async fn clear_loops(
        &self,
        session_id: &str,
        loop_id: Option<&str>,
    ) -> Result<ClearSessionLoopsResponse, LoopRuntimeError> {
        let session = self.session_for_mutation(session_id)?;
        match loop_id {
            Some(loop_id) => {
                let record = self
                    .loop_service
                    .get(loop_id)
                    .map_err(LoopRuntimeError::Store)?
                    .filter(|record| record.session_id == session.id)
                    .ok_or(LoopRuntimeError::LoopNotFound)?;
                if record.native {
                    let handle = self
                        .acp_manager
                        .get_handle(&session.id)
                        .await
                        .ok_or(LoopRuntimeError::SessionNotRunning)?;
                    let native_loop_id = record.native_loop_id.clone().ok_or_else(|| {
                        LoopRuntimeError::Store(anyhow::anyhow!(
                            "native loop mirror is missing its sidecar loop id"
                        ))
                    })?;
                    handle
                        .call_agent_ext_method(
                            LOOP_CLEAR_EXT_METHOD,
                            serde_json::json!({ "loopId": native_loop_id }),
                        )
                        .await
                        .map_err(|error| LoopRuntimeError::Ext(anyhow::anyhow!("{error:?}")))?;
                    Ok(ClearSessionLoopsResponse {
                        accepted: true,
                        cleared: 0,
                    })
                } else {
                    let cleared = self
                        .clear_emulated(&session, Some(&record.id), None)
                        .await?;
                    Ok(ClearSessionLoopsResponse {
                        accepted: true,
                        cleared,
                    })
                }
            }
            None => {
                let cleared = self.clear_emulated(&session, None, None).await?;
                let capabilities =
                    parse_action_capabilities(session.action_capabilities_json.as_deref());
                if capabilities.supports_loops {
                    if let Some(handle) = self.acp_manager.get_handle(&session.id).await {
                        handle
                            .call_agent_ext_method(LOOP_CLEAR_EXT_METHOD, serde_json::json!({}))
                            .await
                            .map_err(|error| {
                                LoopRuntimeError::Ext(anyhow::anyhow!("{error:?}"))
                            })?;
                    }
                }
                Ok(ClearSessionLoopsResponse {
                    accepted: true,
                    cleared,
                })
            }
        }
    }

    pub fn list_loops(
        &self,
        session_id: &str,
    ) -> Result<ListSessionLoopsResponse, LoopRuntimeError> {
        let session = self
            .session_service
            .get_session(session_id)
            .map_err(LoopRuntimeError::Store)?
            .ok_or(LoopRuntimeError::SessionNotFound)?;
        let loops = self
            .loop_service
            .list_active_by_session(&session.id)
            .map_err(LoopRuntimeError::Store)?
            .iter()
            .map(loop_to_contract)
            .collect();
        Ok(ListSessionLoopsResponse { loops })
    }

    async fn clear_emulated(
        &self,
        session: &SessionRecord,
        loop_id: Option<&str>,
        reason: Option<&str>,
    ) -> Result<i64, LoopRuntimeError> {
        let cleared = match self.acp_manager.get_handle(&session.id).await {
            Some(handle) => {
                let op = Box::new(EmulatedLoopClearOp {
                    loop_service: self.loop_service.clone(),
                    loop_id: loop_id.map(ToOwned::to_owned),
                    reason: reason.map(ToOwned::to_owned),
                });
                let reply = handle.run_domain_op(op).await.map_err(|error| {
                    LoopRuntimeError::Store(anyhow::anyhow!("loop clear op: {error:?}"))
                })?;
                let output = reply.downcast::<EmulatedLoopClearOpOutput>().map_err(|_| {
                    LoopRuntimeError::Store(anyhow::anyhow!(
                        "loop clear op returned unexpected reply type"
                    ))
                })?;
                output.result.map_err(LoopRuntimeError::Store)?.len()
            }
            None => {
                let (records, _) = self
                    .loop_service
                    .clear_emulated_offline(&session.id, &session.workspace_id, loop_id, reason)
                    .map_err(LoopRuntimeError::Store)?;
                records.len()
            }
        };
        self.scheduler.arm_session(&session.id);
        Ok(cleared as i64)
    }

    fn loop_substrate(&self, session: &SessionRecord) -> LoopSubstrate {
        let capabilities = parse_action_capabilities(session.action_capabilities_json.as_deref());
        if capabilities.supports_loops {
            return LoopSubstrate::Native;
        }
        match self
            .catalog
            .active_catalog()
            .loops_capability(&session.agent_kind)
        {
            AgentCatalogLoopsCapability::Native => {
                // Catalog says native but the running sidecar did not
                // advertise LoopPort (old pin): treat as unsupported rather
                // than silently emulating (spec §6: capability check fallback).
                LoopSubstrate::None
            }
            AgentCatalogLoopsCapability::Emulated => LoopSubstrate::Emulated,
            AgentCatalogLoopsCapability::None => LoopSubstrate::None,
        }
    }

    fn session_for_mutation(&self, session_id: &str) -> Result<SessionRecord, LoopRuntimeError> {
        let session = self
            .session_service
            .get_session(session_id)
            .map_err(LoopRuntimeError::Store)?
            .ok_or(LoopRuntimeError::SessionNotFound)?;
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| LoopRuntimeError::Store(anyhow::anyhow!(error.to_string())))?;
        Ok(session)
    }
}

enum LoopSubstrate {
    Native,
    Emulated,
    None,
}
