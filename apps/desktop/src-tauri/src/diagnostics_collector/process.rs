use std::fmt;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream as StdUnixStream;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{
    ConnectionDescriptorV1, HealthStatusV1, TokenReferenceKindV1,
};
use proliferate_diagnostics_protocol::v1::validation::parse_connection_descriptor_value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;

use crate::agent_seed_env::current_target_triple;

use super::client::{CollectorHttpClient, SecretCapability};
use super::fallback::FallbackDiagnosticsWriter;

pub(crate) const COLLECTOR_LAUNCH_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const COLLECTOR_GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const COLLECTOR_FORCE_REAP_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_DESCRIPTOR_BYTES: usize = 4_096;
const MAX_CONTROL_COMMAND_BYTES: usize = 4_096;
const MAX_STDERR_RECORD_BYTES: usize = 4_096;
const PLACEHOLDER_MARKER: &[u8] = b"diagnostics collector placeholder";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollectorLaunchErrorKind {
    UnsupportedTarget,
    BinaryMissing,
    BinaryInvalid,
    SpawnFailed,
    EndpointUnavailable,
    ReadinessTimeout,
    AuthenticationFailed,
    SchemaIncompatible,
    BootIdMismatch,
    ChildExited,
    ChildInspectionFailed,
}

pub(crate) struct CollectorLaunchError {
    pub(crate) kind: CollectorLaunchErrorKind,
    pub(crate) detail: &'static str,
    retained_child: Option<RetainedLaunchChild>,
}

impl CollectorLaunchError {
    pub(crate) fn new(kind: CollectorLaunchErrorKind, detail: &'static str) -> Self {
        Self {
            kind,
            detail,
            retained_child: None,
        }
    }

    fn with_retained_child(
        kind: CollectorLaunchErrorKind,
        detail: &'static str,
        child: Child,
        stderr_task: Option<JoinHandle<()>>,
    ) -> Self {
        Self {
            kind,
            detail,
            retained_child: Some(RetainedLaunchChild { child, stderr_task }),
        }
    }

    pub(crate) fn take_retained_child(&mut self) -> Option<RetainedLaunchChild> {
        self.retained_child.take()
    }
}

impl fmt::Debug for CollectorLaunchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CollectorLaunchError")
            .field("kind", &self.kind)
            .field("detail", &self.detail)
            .field("retained_child", &self.retained_child.is_some())
            .finish()
    }
}

pub(crate) struct RetainedLaunchChild {
    child: Child,
    stderr_task: Option<JoinHandle<()>>,
}

impl RetainedLaunchChild {
    pub(crate) async fn terminate_and_reap(&mut self) -> Result<(), io::Error> {
        match self.child.try_wait()? {
            Some(_) => {}
            None => {
                self.child.start_kill()?;
                tokio::time::timeout(COLLECTOR_FORCE_REAP_TIMEOUT, self.child.wait())
                    .await
                    .map_err(|_| {
                        io::Error::new(io::ErrorKind::TimedOut, "collector reap timed out")
                    })??;
            }
        }
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
        Ok(())
    }
}

impl Drop for RetainedLaunchChild {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
    }
}

#[derive(Clone)]
pub(crate) struct CollectorProcessLauncher {
    binary: PathBuf,
    release: String,
    environment: String,
    /// Identity of this installation, handed to the collector so it can stamp
    /// exported records with it. `None` when the identity could not be read or
    /// created, which is an observability degradation and never a launch
    /// failure: the collector then exports records with no install attribute.
    install_id: Option<String>,
    fallback: FallbackDiagnosticsWriter,
}

impl fmt::Debug for CollectorProcessLauncher {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CollectorProcessLauncher")
            .field("binary", &self.binary.file_name())
            .field("release", &self.release)
            .field("environment", &self.environment)
            .field("install_id", &self.install_id)
            .finish_non_exhaustive()
    }
}

impl CollectorProcessLauncher {
    pub(crate) fn discover(
        release: String,
        environment: String,
        install_id: Option<String>,
        fallback: FallbackDiagnosticsWriter,
    ) -> Result<Self, CollectorLaunchError> {
        if !supported_target(current_target_triple()) {
            return Err(CollectorLaunchError::new(
                CollectorLaunchErrorKind::UnsupportedTarget,
                "collector target is unsupported",
            ));
        }
        let binary = resolve_binary().ok_or_else(|| {
            CollectorLaunchError::new(
                CollectorLaunchErrorKind::BinaryMissing,
                "collector binary is missing",
            )
        })?;
        Self::discover_with_binary(binary, release, environment, install_id, fallback)
    }

    fn discover_with_binary(
        binary: PathBuf,
        release: String,
        environment: String,
        install_id: Option<String>,
        fallback: FallbackDiagnosticsWriter,
    ) -> Result<Self, CollectorLaunchError> {
        validate_binary(&binary)?;
        validate_label(&release)?;
        validate_label(&environment)?;
        // An unusable identity is dropped rather than failing the launch. The
        // collector refuses an out-of-range `--install-id` outright, so
        // passing one through would trade a missing attribute for no
        // diagnostics at all.
        let install_id = retain_valid_install_id(install_id);
        Ok(Self {
            binary,
            release,
            environment,
            install_id,
            fallback,
        })
    }

    pub(crate) async fn launch(&self) -> Result<OwnedCollectorProcess, CollectorLaunchError> {
        self.launch_inner().await
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        binary: PathBuf,
        release: String,
        environment: String,
        fallback: FallbackDiagnosticsWriter,
    ) -> Self {
        Self {
            binary,
            release,
            environment,
            install_id: None,
            fallback,
        }
    }

    async fn launch_inner(&self) -> Result<OwnedCollectorProcess, CollectorLaunchError> {
        let deadline = tokio::time::Instant::now() + COLLECTOR_LAUNCH_TIMEOUT;
        let capability = Arc::new(generate_capability()?);
        let (mut capability_parent, capability_child) = protected_pair()?;
        let (control_parent, control_child) = protected_pair()?;
        let capability_child_fd = capability_child.as_raw_fd();
        let control_child_fd = control_child.as_raw_fd();
        let capability_child_fd_arg = capability_child_fd.to_string();
        let control_child_fd_arg = control_child_fd.to_string();

        let mut command = Command::new(&self.binary);
        command
            .args([
                "--capability-fd",
                &capability_child_fd_arg,
                "--control-fd",
                &control_child_fd_arg,
                "--release",
                &self.release,
                "--environment",
                &self.environment,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // Optional, and passed as an argument rather than an environment
        // value so it travels the same audited seam as `--release` and
        // `--environment` and cannot be inherited by anything else the child
        // spawns.
        if let Some(install_id) = self.install_id.as_deref() {
            command.args(["--install-id", install_id]);
        }
        // Read at every launch, not at discovery, so a restart after sign-in
        // stamps the user the install now belongs to. Same domain filter as
        // the install id: an out-of-range value drops the attribute, never
        // the collector.
        if let Some(user_id) = retain_valid_install_id(super::identity::current_user_id()) {
            command.args(["--user-id", &user_id]);
        }
        // The Honeycomb destination, only in the hosted-product mode
        // (`export_destination.rs`). Absent, the collector's export leg is
        // `Sink::Off`: no queue, no task, nothing leaves.
        for (key, value) in super::export_destination::export_env(
            crate::desktop_telemetry_mode::resolve_desktop_telemetry_mode(),
        ) {
            command.env(key, value);
        }

        // SAFETY: after fork and before exec this closure performs only two raw,
        // checked fcntl calls. It allocates, formats, logs, and locks nothing.
        unsafe {
            command.pre_exec(move || {
                clear_cloexec_raw(capability_child_fd)?;
                clear_cloexec_raw(control_child_fd)?;
                Ok(())
            });
        }

        let mut child = command.spawn().map_err(|_| {
            CollectorLaunchError::new(
                CollectorLaunchErrorKind::SpawnFailed,
                "collector process could not be spawned",
            )
        })?;
        drop(capability_child);
        drop(control_child);

        if capability_parent
            .write_all(capability.as_bytes())
            .and_then(|_| capability_parent.write_all(b"\n"))
            .and_then(|_| capability_parent.shutdown(std::net::Shutdown::Write))
            .is_err()
        {
            return Err(failed_launch(
                child,
                None,
                CollectorLaunchErrorKind::SpawnFailed,
                "collector capability channel failed",
            )
            .await);
        }
        drop(capability_parent);

        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                return Err(failed_launch(
                    child,
                    None,
                    CollectorLaunchErrorKind::EndpointUnavailable,
                    "collector descriptor pipe is unavailable",
                )
                .await);
            }
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                return Err(failed_launch(
                    child,
                    None,
                    CollectorLaunchErrorKind::SpawnFailed,
                    "collector stderr pipe is unavailable",
                )
                .await);
            }
        };
        let stderr_task = drain_stderr(stderr, self.fallback.clone());
        let descriptor =
            match tokio::time::timeout_at(deadline, read_descriptor(stdout, capability_child_fd))
                .await
            {
                Ok(Ok(descriptor)) => descriptor,
                Ok(Err(error)) => {
                    return Err(
                        failed_launch(child, Some(stderr_task), error.kind, error.detail).await,
                    );
                }
                Err(_) => {
                    return Err(failed_launch(
                        child,
                        Some(stderr_task),
                        CollectorLaunchErrorKind::ReadinessTimeout,
                        "collector launch exceeded its deadline",
                    )
                    .await);
                }
            };
        let client = match CollectorHttpClient::new(&descriptor.endpoint, Arc::clone(&capability)) {
            Ok(client) => client,
            Err(_) => {
                return Err(failed_launch(
                    child,
                    Some(stderr_task),
                    CollectorLaunchErrorKind::EndpointUnavailable,
                    "collector endpoint could not be initialized",
                )
                .await);
            }
        };
        let health = match tokio::time::timeout_at(deadline, client.health()).await {
            Ok(Ok(health)) => health,
            Ok(Err(error)) => {
                let kind = match error {
                    super::client::CollectorClientError::Authentication => {
                        CollectorLaunchErrorKind::AuthenticationFailed
                    }
                    super::client::CollectorClientError::Deadline => {
                        CollectorLaunchErrorKind::ReadinessTimeout
                    }
                    super::client::CollectorClientError::Protocol => {
                        CollectorLaunchErrorKind::SchemaIncompatible
                    }
                    _ => CollectorLaunchErrorKind::EndpointUnavailable,
                };
                return Err(failed_launch(
                    child,
                    Some(stderr_task),
                    kind,
                    "collector authenticated readiness failed",
                )
                .await);
            }
            Err(_) => {
                return Err(failed_launch(
                    child,
                    Some(stderr_task),
                    CollectorLaunchErrorKind::ReadinessTimeout,
                    "collector authenticated readiness exceeded its deadline",
                )
                .await);
            }
        };
        if health.collector_boot_id != descriptor.collector_boot_id {
            return Err(failed_launch(
                child,
                Some(stderr_task),
                CollectorLaunchErrorKind::BootIdMismatch,
                "collector boot identity did not match",
            )
            .await);
        }
        if health.schema_version.major != CURRENT_SCHEMA_VERSION.major {
            return Err(failed_launch(
                child,
                Some(stderr_task),
                CollectorLaunchErrorKind::SchemaIncompatible,
                "collector schema major did not match",
            )
            .await);
        }
        if health.status != HealthStatusV1::Ready {
            return Err(failed_launch(
                child,
                Some(stderr_task),
                CollectorLaunchErrorKind::EndpointUnavailable,
                "collector did not report ready",
            )
            .await);
        }

        if control_parent.set_nonblocking(true).is_err() {
            return Err(failed_launch(
                child,
                Some(stderr_task),
                CollectorLaunchErrorKind::SpawnFailed,
                "collector control channel setup failed",
            )
            .await);
        }
        let control = match tokio::net::UnixStream::from_std(control_parent) {
            Ok(control) => control,
            Err(_) => {
                return Err(failed_launch(
                    child,
                    Some(stderr_task),
                    CollectorLaunchErrorKind::SpawnFailed,
                    "collector control channel setup failed",
                )
                .await);
            }
        };

        Ok(OwnedCollectorProcess {
            child: Some(child),
            control: Some(control),
            client: Arc::new(client),
            descriptor,
            capability,
            stderr_task: Some(stderr_task),
            orderly_shutdown_requested: false,
            #[cfg(test)]
            test_faults: CollectorProcessTestFaults::default(),
        })
    }
}

async fn failed_launch(
    mut child: Child,
    stderr_task: Option<JoinHandle<()>>,
    intended_kind: CollectorLaunchErrorKind,
    intended_detail: &'static str,
) -> CollectorLaunchError {
    let preserve_intended = matches!(
        intended_kind,
        CollectorLaunchErrorKind::AuthenticationFailed
            | CollectorLaunchErrorKind::SchemaIncompatible
            | CollectorLaunchErrorKind::BootIdMismatch
    );
    let result = match child.try_wait() {
        Ok(Some(_)) if !preserve_intended => CollectorLaunchError::new(
            CollectorLaunchErrorKind::ChildExited,
            "collector exited during launch",
        ),
        Ok(Some(_)) => CollectorLaunchError::new(intended_kind, intended_detail),
        Ok(None) => {
            if child.start_kill().is_err() {
                return CollectorLaunchError::with_retained_child(
                    CollectorLaunchErrorKind::ChildInspectionFailed,
                    "collector launch cleanup could not be requested",
                    child,
                    stderr_task,
                );
            } else {
                match tokio::time::timeout(COLLECTOR_FORCE_REAP_TIMEOUT, child.wait()).await {
                    Ok(Ok(_)) => CollectorLaunchError::new(intended_kind, intended_detail),
                    Ok(Err(_)) | Err(_) => {
                        return CollectorLaunchError::with_retained_child(
                            CollectorLaunchErrorKind::ChildInspectionFailed,
                            "collector launch cleanup could not be verified",
                            child,
                            stderr_task,
                        );
                    }
                }
            }
        }
        Err(_) => {
            return CollectorLaunchError::with_retained_child(
                CollectorLaunchErrorKind::ChildInspectionFailed,
                "collector launch child could not be inspected",
                child,
                stderr_task,
            );
        }
    };
    if let Some(task) = stderr_task {
        task.abort();
    }
    result
}

pub(crate) struct OwnedCollectorProcess {
    child: Option<Child>,
    control: Option<tokio::net::UnixStream>,
    client: Arc<CollectorHttpClient>,
    descriptor: ConnectionDescriptorV1,
    capability: Arc<SecretCapability>,
    stderr_task: Option<JoinHandle<()>>,
    orderly_shutdown_requested: bool,
    #[cfg(test)]
    test_faults: CollectorProcessTestFaults,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollectorProcessTestFault {
    TryWait,
    ControlWrite,
    Kill,
    GracefulDeadline,
}

#[cfg(test)]
#[derive(Default)]
struct CollectorProcessTestFaults {
    try_wait: bool,
    control_write: bool,
    kill: bool,
    graceful_deadline: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollectorShutdownOutcome {
    Graceful,
    GracefulDeadlineExceeded,
    ControlWriteFailed,
}

#[path = "process/helpers.rs"]
mod helpers;
#[path = "process/owned.rs"]
mod owned;

use helpers::{
    clear_cloexec_raw, drain_stderr, generate_capability, protected_pair, read_descriptor,
    resolve_binary, retain_valid_install_id, supported_target, validate_binary, validate_label,
};
#[cfg(test)]
use owned::typed_shutdown_command;
#[cfg(test)]
#[path = "process_tests.rs"]
mod tests;
