use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{HealthStatusV1, TerminalOutcomeV1};

use super::death_certificate::CollectorDeathCertificate;
use super::{
    accept_restart_budget_at, classification_for_launch_error, reset_restart_budget_after_health,
    retryable, CollectorClientError, CollectorLaunchError, CollectorLaunchErrorKind,
    CollectorLaunchKindV1, CollectorShutdownOutcome, DesktopDiagnosticsSupervisorStateV1,
    DiagnosticsCollectorSupervisor, OwnedCollectorProcess, StartupBarrierResult,
    SupervisorUnavailable, AUTOMATIC_RESTART_DELAYS, HEALTH_FAILURE_THRESHOLD,
    PRODUCER_DRAIN_TIMEOUT, STEADY_HEALTH_INTERVAL,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SteadyHealthAssessment {
    Healthy,
    TransientFailure,
    LatchedFailure(&'static str),
}

pub(super) fn classify_steady_health_response(
    status: HealthStatusV1,
    schema_major: u16,
    collector_boot_id: &str,
    expected_boot_id: &str,
) -> SteadyHealthAssessment {
    if schema_major != CURRENT_SCHEMA_VERSION.major {
        SteadyHealthAssessment::LatchedFailure("schema_incompatible")
    } else if collector_boot_id != expected_boot_id {
        SteadyHealthAssessment::LatchedFailure("boot_id_mismatch")
    } else if status == HealthStatusV1::Ready {
        SteadyHealthAssessment::Healthy
    } else {
        SteadyHealthAssessment::TransientFailure
    }
}

pub(super) fn classify_steady_health_error(error: CollectorClientError) -> SteadyHealthAssessment {
    match error {
        CollectorClientError::Authentication => {
            SteadyHealthAssessment::LatchedFailure("authentication_failed")
        }
        CollectorClientError::Protocol => {
            SteadyHealthAssessment::LatchedFailure("schema_incompatible")
        }
        CollectorClientError::Rejected
        | CollectorClientError::Unavailable
        | CollectorClientError::Deadline => SteadyHealthAssessment::TransientFailure,
    }
}

impl DiagnosticsCollectorSupervisor {
    pub(crate) fn arm_shutdown(&self) -> bool {
        if self.shutdown_armed.swap(true, Ordering::AcqRel) {
            return false;
        }
        self.resolve_startup(StartupBarrierResult::Degraded);
        self.shutdown_tx.send_replace(true);
        // `shutdown_tx` cancels broker leases immediately. The accepted
        // collector generation and producer client deliberately remain live
        // through bounded producer/child flush and stop work; collector
        // teardown invalidates the generation later.
        true
    }

    pub(crate) async fn stop_collector(&self) -> Result<(), SupervisorUnavailable> {
        let _decision = self.decisions.lock().await;
        // The tail's discovery point dies with the generation it described.
        super::super::descriptor_file::remove();
        let mut stop_operation = self.producer.begin_lifecycle("desktop.collector.stop");
        let _ = self.producer.drain(PRODUCER_DRAIN_TIMEOUT).await;
        let (mut process, retained_launch) = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| SupervisorUnavailable::Protocol)?;
            (inner.process.take(), inner.retained_launch.take())
        };
        let Some(mut process) = process.take() else {
            if let Some(mut retained) = retained_launch {
                if retained.terminate_and_reap().await.is_err() {
                    if let Ok(mut inner) = self.inner.lock() {
                        inner.retained_launch = Some(retained);
                    }
                    self.invalidate_generation();
                    stop_operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
                    self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped {
                        orderly: false,
                    });
                    return Err(SupervisorUnavailable::Protocol);
                }
                self.invalidate_generation();
                stop_operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
                self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false });
                return Ok(());
            }
            self.invalidate_generation();
            stop_operation.terminal(TerminalOutcomeV1::Skipped, None);
            self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: true });
            return Ok(());
        };
        // Producer-death and shutdown commands share one async writer gate.
        // The producer-death path holds the same async lifecycle decision and
        // takes this gate first, so shutdown cannot interleave its control line
        // with an already-authorized terminal line.
        let _control_writer = self.terminal_control.lock_writer().await;
        // An ambiguous terminal control write may have partially reached the
        // collector. Never append a shutdown command to that stream: force
        // the identity-stable owned child to a verified reap instead.
        if self.terminal_control.writer_is_ambiguous() {
            let result = process.terminate_and_reap().await;
            self.invalidate_generation();
            stop_operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
            self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false });
            return match result {
                Ok(()) => Ok(()),
                Err(_) => {
                    if let Ok(mut inner) = self.inner.lock() {
                        inner.process = Some(process);
                    }
                    Err(SupervisorUnavailable::Protocol)
                }
            };
        }
        match process.observe_exit() {
            Ok(Some(status)) => {
                process.finish_reaped();
                self.invalidate_generation();
                stop_operation.append_arguments(self.child_exited_arguments(status));
                stop_operation.terminal(TerminalOutcomeV1::Failed, Some("child_exited"));
                self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false });
                return Ok(());
            }
            Err(_) => {
                if let Ok(mut inner) = self.inner.lock() {
                    inner.process = Some(process);
                }
                self.invalidate_generation();
                stop_operation.terminal(TerminalOutcomeV1::Failed, Some("child_inspection_failed"));
                self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false });
                return Err(SupervisorUnavailable::Protocol);
            }
            Ok(None) => {}
        }
        let result = process.orderly_shutdown().await;
        self.invalidate_generation();
        match result {
            Ok(CollectorShutdownOutcome::Graceful) => {
                stop_operation.terminal(TerminalOutcomeV1::Succeeded, None);
                self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: true });
                Ok(())
            }
            Ok(CollectorShutdownOutcome::GracefulDeadlineExceeded) => {
                stop_operation.terminal(TerminalOutcomeV1::TimedOut, Some("shutdown_timeout"));
                self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false });
                Err(SupervisorUnavailable::Deadline)
            }
            Ok(CollectorShutdownOutcome::ControlWriteFailed) => {
                stop_operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
                self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false });
                Err(SupervisorUnavailable::Protocol)
            }
            Err(_) => {
                if let Ok(mut inner) = self.inner.lock() {
                    inner.process = Some(process);
                }
                stop_operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
                self.publish_state(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false });
                Err(SupervisorUnavailable::Protocol)
            }
        }
    }

    pub(super) async fn restart_burst_locked(
        self: &Arc<Self>,
        certificate: Option<CollectorDeathCertificate>,
    ) -> bool {
        for (index, delay) in AUTOMATIC_RESTART_DELAYS.iter().copied().enumerate() {
            if self.shutdown_armed.load(Ordering::Acquire) {
                self.publish_degraded("shutdown_armed", false);
                return false;
            }
            tokio::time::sleep(delay).await;
            if self.shutdown_armed.load(Ordering::Acquire) {
                self.publish_degraded("shutdown_armed", false);
                return false;
            }
            if !self.accept_restart_budget() {
                self.publish_degraded("restart_exhausted", true);
                return false;
            }
            let restart_operation = self.begin_restart_lifecycle(certificate);
            self.publish_starting(CollectorLaunchKindV1::AutomaticRestart, (index + 1) as u8);
            let launcher = match &self.launcher {
                Ok(launcher) => launcher,
                Err(error) => {
                    let classification = classification_for_launch_error(error.kind);
                    restart_operation.terminal(TerminalOutcomeV1::Failed, Some(classification));
                    self.publish_degraded(classification, false);
                    return false;
                }
            };
            match launcher.launch().await {
                Ok(process) => {
                    if self.shutdown_armed.load(Ordering::Acquire) {
                        if let Ok(mut inner) = self.inner.lock() {
                            inner.process = Some(process);
                        }
                        restart_operation
                            .terminal(TerminalOutcomeV1::Cancelled, Some("shutdown_armed"));
                        self.publish_degraded("shutdown_armed", false);
                        return false;
                    }
                    self.accept_ready(process);
                    restart_operation.terminal(TerminalOutcomeV1::Succeeded, None);
                    return true;
                }
                Err(mut error) => {
                    self.retain_failed_launch(&mut error);
                    let classification = classification_for_launch_error(error.kind);
                    restart_operation.terminal(
                        if error.kind == CollectorLaunchErrorKind::ReadinessTimeout {
                            TerminalOutcomeV1::TimedOut
                        } else {
                            TerminalOutcomeV1::Failed
                        },
                        Some(classification),
                    );
                    self.publish_degraded(classification, false);
                    if !retryable(error.kind) {
                        return false;
                    }
                }
            }
        }
        self.publish_degraded("restart_exhausted", true);
        false
    }

    pub(super) fn spawn_monitor(self: &Arc<Self>) {
        let supervisor = Arc::clone(self);
        tokio::spawn(async move { supervisor.monitor().await });
    }

    pub(super) async fn monitor(self: Arc<Self>) {
        let generation = self.current_generation();
        let mut failed_probes = 0_u8;
        loop {
            tokio::time::sleep(STEADY_HEALTH_INTERVAL).await;
            if self.shutdown_armed.load(Ordering::Acquire)
                || !self.generation_is_current(generation)
            {
                return;
            }
            let inspected = {
                let Ok(mut inner) = self.inner.lock() else {
                    return;
                };
                let Some(process) = inner.process.as_mut() else {
                    return;
                };
                let state = process.observe_exit();
                Some((
                    process.client(),
                    process.descriptor().collector_boot_id.clone(),
                    state,
                ))
            };
            let Some((client, collector_boot_id, child_state)) = inspected else {
                return;
            };
            match child_state {
                Ok(Some(status)) => {
                    self.fail_generation(generation, "child_exited", true, Some(status))
                        .await;
                    return;
                }
                Err(_) => {
                    self.fail_generation(generation, "child_inspection_failed", false, None)
                        .await;
                    return;
                }
                Ok(None) => {}
            }
            let assessment = match client.health().await {
                Ok(health) => classify_steady_health_response(
                    health.status,
                    health.schema_version.major,
                    &health.collector_boot_id,
                    &collector_boot_id,
                ),
                Err(error) => classify_steady_health_error(error),
            };
            match assessment {
                SteadyHealthAssessment::Healthy => {
                    failed_probes = 0;
                    if let Ok(mut inner) = self.inner.lock() {
                        if inner.generation == generation
                            && matches!(
                                &inner.state,
                                DesktopDiagnosticsSupervisorStateV1::Ready { .. }
                            )
                        {
                            reset_restart_budget_after_health(&mut inner, Instant::now());
                        }
                    }
                }
                SteadyHealthAssessment::TransientFailure => {
                    failed_probes = failed_probes.saturating_add(1);
                    if failed_probes >= HEALTH_FAILURE_THRESHOLD {
                        self.fail_generation(generation, "health_unavailable", true, None)
                            .await;
                        return;
                    }
                }
                SteadyHealthAssessment::LatchedFailure(classification) => {
                    self.fail_generation(generation, classification, false, None)
                        .await;
                    return;
                }
            }
        }
    }

    pub(super) async fn fail_generation(
        self: &Arc<Self>,
        generation: u64,
        classification: &'static str,
        may_retry: bool,
        mut exit_status: Option<std::process::ExitStatus>,
    ) {
        let _decision = self.decisions.lock().await;
        if !self.generation_is_current(generation) || self.shutdown_armed.load(Ordering::Acquire) {
            return;
        }
        self.publish_degraded(classification, false);
        let process = self
            .inner
            .lock()
            .ok()
            .and_then(|mut inner| inner.process.take());
        if let Some(mut process) = process {
            match process.observe_exit() {
                Ok(Some(status)) => {
                    // A health-triggered failure can find the child exited by
                    // now; the reap observation still belongs on the record.
                    exit_status = exit_status.or(Some(status));
                    process.finish_reaped();
                }
                Ok(None) => {
                    if process.terminate_and_reap().await.is_err() {
                        if let Ok(mut inner) = self.inner.lock() {
                            inner.process = Some(process);
                        }
                        self.publish_degraded("child_inspection_failed", false);
                        return;
                    }
                }
                Err(_) => {
                    if let Ok(mut inner) = self.inner.lock() {
                        inner.process = Some(process);
                    }
                    self.publish_degraded("child_inspection_failed", false);
                    return;
                }
            }
        }
        if may_retry
            && self
                .restart_burst_locked(Some(CollectorDeathCertificate::new(
                    classification,
                    exit_status,
                )))
                .await
        {
            self.spawn_monitor();
        }
    }

    pub(super) fn accept_ready(&self, process: OwnedCollectorProcess) {
        // The local tail's discovery point follows every ready generation.
        let (endpoint, capability) = process.tail_descriptor();
        super::super::descriptor_file::write(endpoint, capability.expose_for_descriptor_file());
        let client = process.client();
        let collector_boot_id = process.descriptor().collector_boot_id.clone();
        let schema_major = process.descriptor().schema_major;
        // A fresh collector generation owns a fresh pair of terminal slots.
        // `accept_ready` is reached only while the lifecycle decision mutex is
        // held, so reset precedes publication to every child watcher.
        self.terminal_control.reset_for_new_collector();
        let (generation, state) = self
            .inner
            .lock()
            .map(|mut inner| {
                inner.generation = inner.generation.saturating_add(1);
                inner.ready_since = Some(Instant::now());
                inner.process = Some(process);
                inner.retained_launch = None;
                let state = DesktopDiagnosticsSupervisorStateV1::Ready {
                    collector_boot_id,
                    schema_major,
                    restart_count: inner.restart_count,
                };
                inner.state = state.clone();
                (inner.generation, state)
            })
            .unwrap_or((
                0,
                DesktopDiagnosticsSupervisorStateV1::Degraded {
                    classification: "child_inspection_failed".to_string(),
                    restart_count: 0,
                    retry_exhausted: true,
                },
            ));
        if matches!(&state, DesktopDiagnosticsSupervisorStateV1::Degraded { .. }) {
            self.producer.set_ready_client(generation, None);
            self.state_tx.send_replace(state);
            return;
        }
        self.producer.set_ready_client(generation, Some(client));
        self.generation_tx.send_replace(generation);
        self.state_tx.send_replace(state);
    }

    pub(super) fn accept_restart_budget(&self) -> bool {
        let now = Instant::now();
        self.inner
            .lock()
            .map(|mut inner| accept_restart_budget_at(&mut inner, now))
            .unwrap_or(false)
    }

    pub(super) fn publish_starting(&self, launch_kind: CollectorLaunchKindV1, attempt: u8) {
        let restart_count = self
            .inner
            .lock()
            .map(|inner| inner.restart_count)
            .unwrap_or_default();
        self.publish_state(DesktopDiagnosticsSupervisorStateV1::Starting {
            launch_kind,
            attempt,
            restart_count,
        });
    }

    pub(super) fn publish_degraded(&self, classification: &'static str, retry_exhausted: bool) {
        // The tail's discovery point must not outlive a ready generation.
        super::super::descriptor_file::remove();
        self.fallback.set_active(true);
        let (generation, state) = self
            .inner
            .lock()
            .map(|mut inner| {
                inner.generation = inner.generation.saturating_add(1);
                let state = DesktopDiagnosticsSupervisorStateV1::Degraded {
                    classification: classification.to_string(),
                    restart_count: inner.restart_count,
                    retry_exhausted,
                };
                inner.state = state.clone();
                (inner.generation, state)
            })
            .unwrap_or((
                0,
                DesktopDiagnosticsSupervisorStateV1::Degraded {
                    classification: "child_inspection_failed".to_string(),
                    restart_count: 0,
                    retry_exhausted: true,
                },
            ));
        self.producer.set_ready_client(generation, None);
        self.generation_tx.send_replace(generation);
        self.state_tx.send_replace(state);
    }

    pub(super) fn publish_state(&self, state: DesktopDiagnosticsSupervisorStateV1) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.state = state.clone();
        }
        self.state_tx.send_replace(state);
    }

    pub(super) fn resolve_startup(&self, result: StartupBarrierResult) {
        if *self.startup_tx.borrow() == StartupBarrierResult::Pending {
            self.startup_tx.send_replace(result);
        }
    }

    pub(super) fn current_generation(&self) -> u64 {
        self.inner
            .lock()
            .map(|inner| inner.generation)
            .unwrap_or_default()
    }

    pub(super) fn generation_is_current(&self, generation: u64) -> bool {
        self.inner
            .lock()
            .map(|inner| {
                inner.generation == generation
                    && matches!(
                        &inner.state,
                        DesktopDiagnosticsSupervisorStateV1::Ready { .. }
                    )
            })
            .unwrap_or(false)
    }

    pub(super) fn require_generation(&self, generation: u64) -> Result<(), SupervisorUnavailable> {
        self.generation_is_current(generation)
            .then_some(())
            .ok_or(SupervisorUnavailable::Replaced)
    }

    pub(super) fn invalidate_generation(&self) {
        let generation = self
            .inner
            .lock()
            .map(|mut inner| {
                inner.generation = inner.generation.saturating_add(1);
                inner.generation
            })
            .unwrap_or_default();
        self.producer.set_ready_client(generation, None);
        self.generation_tx.send_replace(generation);
    }

    pub(super) fn retain_failed_launch(&self, error: &mut CollectorLaunchError) {
        let Some(retained) = error.take_retained_child() else {
            return;
        };
        if let Ok(mut inner) = self.inner.lock() {
            inner.retained_launch = Some(retained);
        }
    }

    #[cfg(test)]
    pub(crate) fn kill_current_process_for_test(&self) -> Result<(), std::io::Error> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| std::io::Error::other("collector supervisor lock poisoned"))?;
        inner
            .process
            .as_mut()
            .ok_or_else(|| std::io::Error::other("collector process missing"))?
            .start_kill()
    }

    #[cfg(test)]
    pub(crate) fn inject_process_fault_for_test(
        &self,
        fault: crate::diagnostics_collector::process::CollectorProcessTestFault,
    ) -> Result<(), std::io::Error> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| std::io::Error::other("collector supervisor lock poisoned"))?;
        inner
            .process
            .as_mut()
            .ok_or_else(|| std::io::Error::other("collector process missing"))?
            .inject_test_fault(fault);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn clear_process_faults_for_test(&self) -> Result<(), std::io::Error> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| std::io::Error::other("collector supervisor lock poisoned"))?;
        inner
            .process
            .as_mut()
            .ok_or_else(|| std::io::Error::other("collector process missing"))?
            .clear_test_faults();
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn has_owned_process_for_test(&self) -> bool {
        self.inner
            .lock()
            .map(|inner| inner.process.is_some())
            .unwrap_or(false)
    }

    #[cfg(test)]
    pub(crate) fn set_state_for_test(&self, state: DesktopDiagnosticsSupervisorStateV1) {
        self.publish_state(state);
    }
}
