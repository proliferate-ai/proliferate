//! Workflow session identity, gateway binding, and preparation rollback.

use super::*;

impl WorkflowStepExecutorImpl {
    pub(super) fn workflow_process_identity(
        &self,
        slot: &str,
        session_id: &str,
    ) -> Result<WorkflowProcessIdentity, StepOutcome> {
        let session = self
            .deps
            .session_service
            .get_session(session_id)
            .map_err(|_| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    "workflow session root could not be resolved",
                )
            })?
            .ok_or_else(|| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    "workflow session root is missing",
                )
            })?;
        let workspace = self
            .deps
            .workspace_runtime
            .get_workspace(&session.workspace_id)
            .map_err(|_| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    "workflow session workspace could not be resolved",
                )
            })?
            .ok_or_else(|| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    "workflow session workspace is missing",
                )
            })?;
        WorkflowProcessIdentity::try_session(
            self.isolation_capability.identity().clone(),
            slot,
            session_id,
            workspace.path,
        )
        .map_err(|error| {
            failed_msg(
                "workflow_agent_isolation_unavailable",
                format!("invalid workflow session process identity: {error}"),
            )
        })
    }

    pub(super) fn workflow_process_policy(
        &self,
        slot: &str,
        session_id: &str,
    ) -> Result<SessionProcessPolicy, StepOutcome> {
        Ok(SessionProcessPolicy::Workflow {
            identity: self.workflow_process_identity(slot, session_id)?,
            capability: self.isolation_capability.clone(),
        })
    }

    pub(in crate::live::workflows) async fn rollback_prepared_session(
        &self,
        slot: &str,
        session_id: &str,
        newly_created: bool,
        ownership_acquired: bool,
        transition: super::super::exec_policy::SessionProcessTransitionGuard,
    ) -> Result<(), StepOutcome> {
        let identity = self.workflow_process_identity(slot, session_id)?;
        if self
            .deps
            .workflow_isolation_broker
            .revoke_local_gateway(&self.isolation_capability, &identity)
            .is_err()
        {
            cancel_workflow_run_bounded(
                self.deps.workflow_isolation_broker.as_ref(),
                &self.isolation_capability,
            )
            .await
            .map_err(|_| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    "workflow session rollback could not revoke broker authority",
                )
            })?;
        }
        if let Some(handle) = self.deps.acp_manager.get_handle(session_id).await {
            handle.close().await.map_err(|error| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    format!(
                        "workflow session rollback could not close the isolated actor: {error}"
                    ),
                )
            })?;
        }
        for _ in 0..40 {
            if self.deps.acp_manager.get_handle(session_id).await.is_none() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        if self.deps.acp_manager.get_handle(session_id).await.is_some() {
            return Err(failed_msg(
                "workflow_agent_isolation_unavailable",
                "workflow session rollback could not prove actor quiescence; ownership retained",
            ));
        }

        // The actor and broker are now quiescent, so this prepared capability
        // must not survive a later durable rollback/restoration failure.
        self.deps.workflow_gateway_sessions.remove(session_id);

        if newly_created {
            // Do not release ownership until the half-created durable session
            // is gone. A deletion error retains ownership, but the unusable
            // prepared gateway capability has already been removed.
            self.deps
                .session_service
                .delete_session(session_id)
                .map_err(|error| {
                    failed_msg(
                        "workflow_agent_isolation_unavailable",
                        format!("failed to delete rolled-back workflow session: {error}"),
                    )
                })?;
            return finalize_prepared_session_rollback(
                self.deps.workflow_owned_sessions.as_ref(),
                self.deps.workflow_gateway_sessions.as_ref(),
                session_id,
                &self.run_id,
                PreparedSessionRollbackEvidence {
                    broker_revoked: true,
                    actor_quiesced: true,
                    durable_state_safe: true,
                },
                ownership_acquired,
                &transition,
            );
        }

        // Existing-session restoration is intentionally parked in Phase A.
        // A cloneable quiescence proof could be replayed after state changes;
        // the next packet must consume one durable generation-bound typestate
        // token under this same transition guard. Retain ownership so no
        // ordinary Interactive launch can race; the prepared binding is gone.
        Err(failed_msg(
            "workflow_agent_isolation_unavailable",
            "interactive restoration requires a one-shot durable quiescence token; ownership retained",
        ))
    }

    pub(in crate::live::workflows) fn workflow_process_policy_for_session(
        &self,
        session_id: &str,
    ) -> Result<SessionProcessPolicy, StepOutcome> {
        let slot = self
            .current
            .lock()
            .unwrap()
            .iter()
            .find_map(|(slot, current)| (current.session_id == session_id).then(|| slot.clone()))
            .ok_or_else(|| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    "workflow session has no immutable slot identity",
                )
            })?;
        self.workflow_process_policy(&slot, session_id)
    }

    pub(super) fn workflow_gateway_server(
        &self,
        slot: &str,
        session_id: &str,
    ) -> Result<crate::domains::sessions::mcp_bindings::model::SessionMcpServer, StepOutcome> {
        let identity = self.workflow_process_identity(slot, session_id)?;
        let binding = bind_workflow_local_gateway(
            self.deps.workflow_isolation_broker.as_ref(),
            &self.isolation_capability,
            &identity,
        )
        .map_err(|_| {
            failed_msg(
                "workflow_agent_isolation_unavailable",
                "trusted local workflow broker binding is unavailable",
            )
        })?;
        if binding.session_id() != session_id
            || binding.execution_generation()
                != self.isolation_capability.identity().execution_generation()
            || binding.broker_generation() != self.isolation_capability.broker_generation()
        {
            return Err(failed_msg(
                "workflow_agent_isolation_unavailable",
                "trusted local workflow broker binding identity mismatch",
            ));
        }
        Ok(workflow_gateway_server(&binding))
    }
}
