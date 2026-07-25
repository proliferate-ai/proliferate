//! Broker/session quiescence, terminal release, startup policy, and timers.

use super::*;

impl WorkflowRunManager {
    pub(super) fn is_live(&self, run_id: &str) -> bool {
        self.live.lock().unwrap().contains_key(run_id)
    }

    pub(super) fn live_control(&self, run_id: &str) -> Option<LiveRunControl> {
        self.live.lock().unwrap().get(run_id).cloned()
    }

    pub(super) fn mark_cleanup_only(&self, run_id: &str) {
        if let Some(control) = self.live.lock().unwrap().get_mut(run_id) {
            control.phase = LiveRunPhase::CleanupOnly;
        }
    }

    pub(super) fn remember_terminal_proposal(
        &self,
        run_id: &str,
        proposal: &ProposedTerminal,
    ) -> Result<(), WorkflowServiceError> {
        let mut live = self.live.lock().unwrap();
        let control = live
            .get_mut(run_id)
            .ok_or(WorkflowServiceError::AgentIsolationUnavailable)?;
        match &control.pending_terminal {
            Some(existing) if existing != proposal => Err(WorkflowServiceError::Store(
                anyhow::anyhow!("conflicting terminal proposal for cleanup-only workflow run"),
            )),
            Some(_) => Ok(()),
            None => {
                control.pending_terminal = Some(proposal.clone());
                control.phase = LiveRunPhase::Finalizing;
                Ok(())
            }
        }
    }

    pub(super) fn pending_terminal_proposal(&self, run_id: &str) -> Option<ProposedTerminal> {
        self.live
            .lock()
            .unwrap()
            .get(run_id)
            .and_then(|control| control.pending_terminal.clone())
    }

    pub(super) async fn revoke_broker_once(
        &self,
        run_id: &str,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowServiceError> {
        let tracked = {
            let mut live = self.live.lock().unwrap();
            match live.get_mut(run_id) {
                Some(control) => {
                    if &control.capability != capability {
                        return Err(WorkflowServiceError::AgentIsolationUnavailable);
                    }
                    match control.broker_revocation {
                        BrokerRevocationState::Revoked => {
                            drop(live);
                            self.deps.workflow_service.clear_cleanup_fence(
                                run_id,
                                BROKER_CLEANUP_FENCE_KIND,
                                BROKER_CLEANUP_FENCE_KEY,
                            )?;
                            return Ok(());
                        }
                        BrokerRevocationState::Revoking => {
                            return Err(WorkflowServiceError::AgentIsolationUnavailable)
                        }
                        BrokerRevocationState::Active => {
                            control.broker_revocation = BrokerRevocationState::Revoking;
                            true
                        }
                    }
                }
                None => false,
            }
        };

        // Persist the fence before the external call. A timeout, task abort, or
        // process restart therefore cannot be mistaken for quiescence.
        if let Err(error) = self.deps.workflow_service.require_cleanup_fence(
            run_id,
            BROKER_CLEANUP_FENCE_KIND,
            BROKER_CLEANUP_FENCE_KEY,
            "broker run quiescence started; receipt not yet committed",
        ) {
            self.reset_broker_revocation(run_id, capability, tracked);
            return Err(WorkflowServiceError::Store(error));
        }

        let result =
            cancel_workflow_run_bounded(self.deps.workflow_isolation_broker.as_ref(), capability)
                .await;
        if let Err(error) = result {
            let _ = self.deps.workflow_service.require_cleanup_fence(
                run_id,
                BROKER_CLEANUP_FENCE_KIND,
                BROKER_CLEANUP_FENCE_KEY,
                &format!("broker run quiescence requires retry: {error}"),
            );
            self.reset_broker_revocation(run_id, capability, tracked);
            return Err(WorkflowServiceError::AgentIsolationUnavailable);
        }
        if tracked {
            let mut live = self.live.lock().unwrap();
            let Some(control) = live.get_mut(run_id) else {
                drop(live);
                let _ = self.deps.workflow_service.require_cleanup_fence(
                    run_id,
                    BROKER_CLEANUP_FENCE_KIND,
                    BROKER_CLEANUP_FENCE_KEY,
                    "broker quiesced but live ownership transition was lost",
                );
                return Err(WorkflowServiceError::AgentIsolationUnavailable);
            };
            if &control.capability != capability {
                drop(live);
                let _ = self.deps.workflow_service.require_cleanup_fence(
                    run_id,
                    BROKER_CLEANUP_FENCE_KIND,
                    BROKER_CLEANUP_FENCE_KEY,
                    "broker quiesced for a stale capability; current authority remains fenced",
                );
                return Err(WorkflowServiceError::AgentIsolationUnavailable);
            }
            control.broker_revocation = BrokerRevocationState::Revoked;
        }
        // Commit the in-memory receipt state before clearing the durable fence.
        // If this write fails, a retry sees Revoked and retries only the fence
        // commit; it never reissues an already-proven external cancellation.
        self.deps.workflow_service.clear_cleanup_fence(
            run_id,
            BROKER_CLEANUP_FENCE_KIND,
            BROKER_CLEANUP_FENCE_KEY,
        )?;
        Ok(())
    }

    fn reset_broker_revocation(
        &self,
        run_id: &str,
        capability: &WorkflowIsolationCapability,
        tracked: bool,
    ) {
        if !tracked {
            return;
        }
        if let Some(control) = self.live.lock().unwrap().get_mut(run_id) {
            if &control.capability == capability {
                control.broker_revocation = BrokerRevocationState::Active;
            }
        }
    }

    pub(super) async fn retry_pending_terminal_publication(
        &self,
        run_id: &str,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowServiceError> {
        let proposal = self.pending_terminal_proposal(run_id).ok_or_else(|| {
            WorkflowServiceError::Store(anyhow::anyhow!(
                "cleanup-only workflow has no retained terminal proposal"
            ))
        })?;
        self.publish_terminal_after_quiescence(run_id, &proposal, capability)
            .await
    }

    pub(super) async fn publish_terminal_after_quiescence(
        &self,
        run_id: &str,
        proposal: &ProposedTerminal,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowServiceError> {
        if !matches!(
            proposal.status,
            WorkflowRunStatus::Completed | WorkflowRunStatus::Failed | WorkflowRunStatus::Cancelled
        ) {
            return Err(WorkflowServiceError::Store(anyhow::anyhow!(
                "engine proposed a nonterminal status for publication"
            )));
        }
        let run = self
            .deps
            .workflow_service
            .get_run(run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)?;
        if run.is_terminal() {
            return Err(WorkflowServiceError::Store(anyhow::anyhow!(
                "new terminal proposal reached an already-terminal run"
            )));
        }

        // This excludes ownership release. Terminal publication is allowed
        // only after broker/process/session quiescence and binding removal;
        // ownership remains fenced through the durable write.
        self.quiesce_non_terminal_run(run_id, capability).await?;
        self.deps.workflow_service.mark_run_terminal(
            run_id,
            proposal.status,
            proposal.error_code.clone(),
            proposal.error_message.clone(),
        )?;
        self.release_ownership_after_quiescence(run_id)
    }

    pub(super) async fn release_on_terminal(
        &self,
        run_id: &str,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowServiceError> {
        let run = self
            .deps
            .workflow_service
            .get_run(run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)?;
        let session_ids = self.cleanup_session_ids(&run);
        let actions = terminal_release_plan(run.status, &session_ids)?;
        self.apply_release_actions(&run, actions, capability).await
    }

    pub(super) async fn quiesce_non_terminal_run(
        &self,
        run_id: &str,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowServiceError> {
        let run = self
            .deps
            .workflow_service
            .get_run(run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)?;
        let session_ids = self.cleanup_session_ids(&run);
        // Materialization compensation needs the exact still-live capability.
        // Always attempt it before run revocation, but still quiesce processes
        // when compensation fails so a filesystem problem cannot leave agent
        // execution authority active. Either error retains the durable terminal
        // fence and ownership for retry.
        let materialization = self
            .reconcile_unresolved_materializations(run_id, capability)
            .await;
        let quiescence = self
            .apply_release_actions(&run, ordered_quiesce_actions(&session_ids), capability)
            .await;
        materialization.and(quiescence)
    }

    fn cleanup_session_ids(&self, run: &WorkflowRunRecord) -> Vec<String> {
        run.sessions()
            .values()
            .cloned()
            .chain(
                self.deps
                    .workflow_owned_sessions
                    .session_ids_for_run(&run.run_id),
            )
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    pub(super) async fn reconcile_unresolved_materializations(
        &self,
        run_id: &str,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowServiceError> {
        let records = self
            .deps
            .workflow_service
            .list_unresolved_materializations(run_id)?;
        for record in records {
            let intent = &record.intent;
            if intent.execution_generation != capability.identity().execution_generation()
                || intent.broker_generation != capability.broker_generation()
                || intent.run_id != run_id
            {
                let detail = "materialization cleanup identity does not match the live capability";
                let _ = self
                    .deps
                    .workflow_service
                    .mark_materialization_cleanup_required(intent, detail);
                return Err(WorkflowServiceError::AgentIsolationUnavailable);
            }

            let identity = WorkflowProcessIdentity::try_materialization(
                capability.identity().clone(),
                intent.scope_id.clone(),
                intent.source_root.clone(),
                intent.target_root.clone(),
            )
            .map_err(|_| WorkflowServiceError::AgentIsolationUnavailable)?;
            match cleanup_workflow_materialization(
                self.deps.workflow_isolation_broker.as_ref(),
                capability,
                WorkflowWorktreeCleanupRequest {
                    identity,
                    source_root: intent.source_root.clone(),
                    target_root: intent.target_root.clone(),
                    branch: intent.branch_name.clone(),
                    base_commit_oid: intent.base_commit_oid.clone(),
                },
            )
            .await
            {
                Ok(receipt) => self
                    .deps
                    .workflow_service
                    .record_materialization_cleanup_receipt(
                        &super::super::parallel::durable_materialization_cleanup_receipt(
                            intent, receipt,
                        ),
                    )?,
                Err(error) => {
                    let detail = format!("materialization reconciliation failed: {error}");
                    let _ = self
                        .deps
                        .workflow_service
                        .mark_materialization_cleanup_required(intent, &detail);
                    return Err(WorkflowServiceError::AgentIsolationUnavailable);
                }
            }
        }
        Ok(())
    }

    /// Broker-only pre-purge lifecycle for a registered workflow worktree.
    /// Generic workspace purge remains blocked until this exact terminal run,
    /// execution generation, broker generation, source/repository, path,
    /// branch, and base operation returns an all-artifacts-absent receipt.
    pub(crate) async fn cleanup_registered_materialization_after_terminal(
        &self,
        intent: &crate::domains::workflows::cleanup::WorkflowMaterializationIntent,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowServiceError> {
        let run = self
            .deps
            .workflow_service
            .get_run(&intent.run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)?;
        if !run.is_terminal() {
            return Err(WorkflowServiceError::Store(anyhow::anyhow!(
                "registered materialization cleanup requires terminal observation"
            )));
        }
        if capability.identity().run_id() != intent.run_id
            || capability.identity().execution_generation() != intent.execution_generation
            || capability.broker_generation() != intent.broker_generation
        {
            return Err(WorkflowServiceError::Store(anyhow::anyhow!(
                "registered materialization cleanup capability identity mismatch"
            )));
        }
        let registered = self
            .deps
            .workflow_service
            .registered_workspace_for_materialization(intent)?;
        if registered.is_none() {
            return Err(WorkflowServiceError::Store(anyhow::anyhow!(
                "registered materialization cleanup lacks exact durable registration"
            )));
        }
        let identity = WorkflowProcessIdentity::try_materialization(
            capability.identity().clone(),
            intent.scope_id.clone(),
            intent.source_root.clone(),
            intent.target_root.clone(),
        )
        .map_err(|_| WorkflowServiceError::AgentIsolationUnavailable)?;
        let receipt = cleanup_workflow_materialization(
            self.deps.workflow_isolation_broker.as_ref(),
            capability,
            WorkflowWorktreeCleanupRequest {
                identity,
                source_root: intent.source_root.clone(),
                target_root: intent.target_root.clone(),
                branch: intent.branch_name.clone(),
                base_commit_oid: intent.base_commit_oid.clone(),
            },
        )
        .await
        .map_err(|error| {
            WorkflowServiceError::Store(anyhow::anyhow!(
                "registered materialization broker cleanup lacked exact receipt: {error}"
            ))
        })?;
        self.deps
            .workflow_service
            .record_materialization_cleanup_receipt(
                &super::super::parallel::durable_materialization_cleanup_receipt(intent, receipt),
            )?;
        Ok(())
    }

    pub(super) fn release_ownership_after_quiescence(
        &self,
        run_id: &str,
    ) -> Result<(), WorkflowServiceError> {
        let run = self
            .deps
            .workflow_service
            .get_run(run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)?;
        if !run.is_terminal() {
            return Err(WorkflowServiceError::Store(anyhow::anyhow!(
                "ownership release after quiescence requires terminal run"
            )));
        }
        self.deps.workflow_owned_sessions.release_run(run_id);
        Ok(())
    }

    async fn apply_release_actions(
        &self,
        run: &WorkflowRunRecord,
        actions: Vec<TerminalReleaseAction>,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowServiceError> {
        for action in actions {
            match action {
                TerminalReleaseAction::RevokeBroker => {
                    self.revoke_broker_once(&run.run_id, capability).await?;
                }
                TerminalReleaseAction::StopSession(session_id) => {
                    if let Some(handle) = self.deps.acp_manager.get_handle(&session_id).await {
                        handle.close().await.map_err(|error| {
                            WorkflowServiceError::Store(anyhow::anyhow!(
                                "stop workflow session before release: {error}"
                            ))
                        })?;
                    }
                    for _ in 0..40 {
                        if self
                            .deps
                            .acp_manager
                            .get_handle(&session_id)
                            .await
                            .is_none()
                        {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                    if self
                        .deps
                        .acp_manager
                        .get_handle(&session_id)
                        .await
                        .is_some()
                    {
                        return Err(WorkflowServiceError::Store(anyhow::anyhow!(
                            "workflow session did not stop before terminal ownership release"
                        )));
                    }
                }
                TerminalReleaseAction::RemoveBinding(session_id) => {
                    self.deps.workflow_gateway_sessions.remove(&session_id);
                }
                TerminalReleaseAction::ReleaseOwnership => {
                    self.deps.workflow_owned_sessions.release_run(&run.run_id);
                }
            }
        }
        Ok(())
    }

}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum TerminalReleaseAction {
    RevokeBroker,
    StopSession(String),
    RemoveBinding(String),
    ReleaseOwnership,
}

pub(super) fn terminal_release_plan(
    status: WorkflowRunStatus,
    session_ids: &[String],
) -> Result<Vec<TerminalReleaseAction>, WorkflowServiceError> {
    if !matches!(
        status,
        WorkflowRunStatus::Completed | WorkflowRunStatus::Failed | WorkflowRunStatus::Cancelled
    ) {
        return Err(WorkflowServiceError::Store(anyhow::anyhow!(
            "terminal release requested for a non-terminal workflow run"
        )));
    }
    Ok(ordered_release_actions(session_ids))
}

pub(super) fn ordered_release_actions(session_ids: &[String]) -> Vec<TerminalReleaseAction> {
    let mut actions = ordered_quiesce_actions(session_ids);
    actions.push(TerminalReleaseAction::ReleaseOwnership);
    actions
}

pub(super) fn ordered_quiesce_actions(session_ids: &[String]) -> Vec<TerminalReleaseAction> {
    let mut actions = vec![TerminalReleaseAction::RevokeBroker];
    actions.extend(
        session_ids
            .iter()
            .cloned()
            .map(TerminalReleaseAction::StopSession),
    );
    actions.extend(
        session_ids
            .iter()
            .cloned()
            .map(TerminalReleaseAction::RemoveBinding),
    );
    actions
}

pub(super) fn workflow_delivery_identity_from_record(
    run: &WorkflowRunRecord,
) -> Result<WorkflowDeliveryIdentity, WorkflowServiceError> {
    WorkflowDeliveryIdentity::try_new(
        run.run_id.clone(),
        run.plan_hash.as_deref(),
        run.binding_hash.as_deref(),
        run.execution_generation,
    )
    .map_err(|_| WorkflowServiceError::AgentIsolationUnavailable)
}

pub(super) async fn wait_for_live_cancel_terminal(
    service: &crate::domains::workflows::service::WorkflowService,
    run_id: &str,
    timeout: Duration,
) -> Result<WorkflowRunRecord, WorkflowServiceError> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let run = service
            .get_run(run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)?;
        if run.is_terminal() || tokio::time::Instant::now() >= deadline {
            return Ok(run);
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}
