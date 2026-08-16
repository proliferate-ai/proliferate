use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, PrivacyClassificationV1, TypedArgumentV1,
};

use crate::diagnostics_collector::producer::lifecycle::LifecycleOperation;

use super::DiagnosticsCollectorSupervisor;

/// Death certificate for a failed collector generation: what the monitor (or
/// the stop path) observed at the moment the child was declared gone. The
/// exit status is present only when the child was actually seen exited;
/// inspection failures, health losses, and latched classifications carry none.
#[derive(Debug, Clone, Copy)]
pub(super) struct CollectorDeathCertificate {
    trigger: &'static str,
    exit_status: Option<std::process::ExitStatus>,
}

impl CollectorDeathCertificate {
    pub(super) fn new(
        trigger: &'static str,
        exit_status: Option<std::process::ExitStatus>,
    ) -> Self {
        Self {
            trigger,
            exit_status,
        }
    }

    pub(super) fn arguments(&self, restart_count: u64) -> Vec<TypedArgumentV1> {
        let mut arguments = vec![
            operational_argument("trigger", ArgumentValueV1::String(self.trigger.to_owned())),
            operational_argument(
                "restart_count",
                ArgumentValueV1::Integer(i64::try_from(restart_count).unwrap_or(i64::MAX)),
            ),
        ];
        if let Some(status) = self.exit_status {
            if let Some(code) = status.code() {
                arguments.push(operational_argument(
                    "exit_code",
                    ArgumentValueV1::Integer(i64::from(code)),
                ));
            }
            #[cfg(unix)]
            {
                use std::os::unix::process::ExitStatusExt;
                if let Some(signal) = status.signal() {
                    arguments.push(operational_argument(
                        "signal",
                        ArgumentValueV1::Integer(i64::from(signal)),
                    ));
                }
            }
        }
        arguments
    }
}

fn operational_argument(name: &str, value: ArgumentValueV1) -> TypedArgumentV1 {
    TypedArgumentV1 {
        name: name.to_owned(),
        privacy: PrivacyClassificationV1::Operational,
        value,
    }
}

impl DiagnosticsCollectorSupervisor {
    /// Begins a `desktop.collector.restart` operation, attaching the death
    /// certificate when one exists. `accept_restart_budget` already counted
    /// this attempt, so the certificate's restart_count matches the Ready
    /// state this attempt would publish.
    pub(super) fn begin_restart_lifecycle(
        &self,
        certificate: Option<CollectorDeathCertificate>,
    ) -> LifecycleOperation {
        match certificate {
            Some(certificate) => {
                let restart_count = self
                    .inner
                    .lock()
                    .map(|inner| inner.restart_count)
                    .unwrap_or_default();
                self.producer.begin_lifecycle_with_arguments(
                    "desktop.collector.restart",
                    certificate.arguments(restart_count),
                )
            }
            None => self.producer.begin_lifecycle("desktop.collector.restart"),
        }
    }

    /// The certificate arguments for a child observed exited on the stop path.
    pub(super) fn child_exited_arguments(
        &self,
        status: std::process::ExitStatus,
    ) -> Vec<TypedArgumentV1> {
        let restart_count = self
            .inner
            .lock()
            .map(|inner| inner.restart_count)
            .unwrap_or_default();
        CollectorDeathCertificate::new("child_exited", Some(status)).arguments(restart_count)
    }
}
