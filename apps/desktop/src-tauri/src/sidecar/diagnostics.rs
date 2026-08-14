//! Bundled diagnostics wiring for the Tauri-owned `anyharness serve` child.
//!
//! On the two accepted packaged macOS targets the owned launch carries the
//! reserved bridge and shutdown descriptors; everywhere else the legacy spawn
//! is preserved untouched. Descriptor or remap failure before a successful
//! exec closes every partial authority and performs at most one direct
//! unprotected product launch — an observability outcome (`Disabled`), never
//! a product-launch failure. A returned successful protected spawn is the
//! point of no retry.

use std::{collections::HashMap, io, sync::Arc};

use tokio::process::{Child, Command};

use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use crate::diagnostics_collector::child_bridge::{
    fallback_root::{resolve_fallback_root, FallbackRootOutcome},
    launch::PreparedChildDiagnosticsLaunch,
    runtime::{ChildDiagnosticsBridge, ChildProcessPresence, DesktopChildDiagnosticsState},
};
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use proliferate_diagnostics_client::bridge::wire::{
    FallbackUnavailableClassification, WireComponent,
};

pub(super) struct SpawnedAnyharness {
    pub(super) child: Child,
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    pub(super) bridge: Option<ChildDiagnosticsBridge>,
}

/// Launches the owned AnyHarness child. The direct executable and command are
/// fully prepared by the caller before any observability descriptor exists.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
pub(super) fn spawn_owned_anyharness(
    binary: &str,
    port: u16,
    launch_env: &HashMap<String, String>,
    supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> io::Result<SpawnedAnyharness> {
    let Some(protected_binary) = protected_anyharness_binary(binary) else {
        // PATH lookups, scripts, wrappers, symlinks that cannot be
        // canonicalized, and non-native images retain the legacy product
        // launch but never inherit protected observability descriptors.
        return spawn_unprotected(&|| super::build_spawn_command(binary, port, launch_env));
    };
    // Resolve the login-shell PATH and finish the complete Command before
    // any protected descriptor exists. The fallback builds a fresh command
    // only after `prepared` and every partial descriptor have dropped.
    let protected_command = super::build_spawn_command(&protected_binary, port, launch_env);
    let build_unprotected = || super::build_spawn_command(binary, port, launch_env);
    if matches!(
        supervisor.state(),
        crate::diagnostics_collector::supervisor::DesktopDiagnosticsSupervisorStateV1::Unsupported { .. }
    ) {
        return spawn_unprotected(&build_unprotected);
    }
    let prepared = match PreparedChildDiagnosticsLaunch::create() {
        Ok(prepared) => prepared,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "diagnostics descriptors unavailable; launching AnyHarness unprotected"
            );
            return spawn_unprotected(&build_unprotected);
        }
    };
    let fallback = anyharness_fallback_root();
    if matches!(
        supervisor.state(),
        crate::diagnostics_collector::supervisor::DesktopDiagnosticsSupervisorStateV1::Unsupported { .. }
    ) {
        drop(prepared);
        return spawn_unprotected(&build_unprotected);
    }
    match prepared.spawn(protected_command) {
        Ok(launch) => {
            let bridge = ChildDiagnosticsBridge::start(
                WireComponent::Anyharness,
                launch.bridge,
                launch.shutdown_writer,
                Arc::clone(supervisor),
                fallback,
            );
            Ok(SpawnedAnyharness {
                child: launch.child,
                bridge: Some(bridge),
            })
        }
        Err(error) => {
            tracing::warn!(
                error = %error,
                "protected AnyHarness spawn failed before exec; retrying unprotected once"
            );
            spawn_unprotected(&build_unprotected)
        }
    }
}

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
pub(super) fn spawn_owned_anyharness(
    binary: &str,
    port: u16,
    launch_env: &HashMap<String, String>,
    _supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> io::Result<SpawnedAnyharness> {
    Ok(SpawnedAnyharness {
        child: super::build_spawn_command(binary, port, launch_env).spawn()?,
    })
}

/// Returns one canonical direct native image eligible for protected exec.
/// Reading only the fixed Mach-O header keeps validation bounded; product
/// launch falls back unprotected when ownership cannot be proven.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
pub(super) fn protected_anyharness_binary(binary: &str) -> Option<String> {
    crate::diagnostics_collector::child_bridge::native_image::canonical_current_target_executable(
        std::path::Path::new(binary),
    )
    .ok()?
    .to_str()
    .map(str::to_owned)
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
fn spawn_unprotected(build_command: &impl Fn() -> Command) -> io::Result<SpawnedAnyharness> {
    Ok(SpawnedAnyharness {
        child: build_command().spawn()?,
        bridge: None,
    })
}

/// The fixed AnyHarness fallback authority:
/// `<anyharness runtime home>/logs/diagnostics-fallback`.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
fn anyharness_fallback_root() -> FallbackRootOutcome {
    match crate::app_config::anyharness_runtime_home_path() {
        Ok(home) => resolve_fallback_root(&home, &["logs"]),
        Err(_) => FallbackRootOutcome::Unavailable(
            FallbackUnavailableClassification::DirectoryUnavailable,
        ),
    }
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
impl super::SidecarProcess {
    pub(crate) fn diagnostics_bridge(&self) -> Option<&ChildDiagnosticsBridge> {
        self.diagnostics_bridge.as_ref()
    }

    /// The bounded per-component state for PR 6 consumption; never fabricates
    /// a producer snapshot.
    pub(crate) async fn child_diagnostics_state(&mut self) -> DesktopChildDiagnosticsState {
        self.child_diagnostics_state_until(
            tokio::time::Instant::now()
                + proliferate_diagnostics_client::bridge::wire::CHILD_STATUS_RESPONSE_DEADLINE,
        )
        .await
    }

    /// Uses the caller's absolute deadline for owner inspection and the
    /// protected status request so a joined support capture cannot create a
    /// second per-child 100 ms window.
    pub(crate) async fn child_diagnostics_state_until(
        &mut self,
        deadline: tokio::time::Instant,
    ) -> DesktopChildDiagnosticsState {
        let process = match self.child.as_mut() {
            None => ChildProcessPresence::Missing,
            Some(child) => ChildProcessPresence::from_observation(child.try_wait()),
        };
        match self.diagnostics_bridge.as_ref() {
            Some(bridge) => bridge.diagnostics_state_until(process, deadline).await,
            None => DesktopChildDiagnosticsState::without_bridge(process),
        }
    }

    /// Consumes one identity-stable child reap proof. The bridge may submit a
    /// producer-death control record only when it also retained a matching
    /// ordered delivery fence for this producer and collector generation.
    pub(super) async fn finish_diagnostics_reap(
        &self,
        status: std::process::ExitStatus,
        kind: crate::diagnostics_collector::child_bridge::reap::ChildReapKind,
        deadline: tokio::time::Instant,
    ) {
        if let Some(bridge) = self.diagnostics_bridge.as_ref() {
            let proof = crate::diagnostics_collector::child_bridge::reap::VerifiedChildReap::new(
                status, kind,
            );
            let _ = bridge.finish_verified_reap(proof, deadline).await;
        }
    }
}

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
impl super::SidecarProcess {
    pub(super) async fn finish_diagnostics_reap(
        &self,
        _status: std::process::ExitStatus,
        _kind: crate::diagnostics_collector::child_bridge::reap::ChildReapKind,
        _deadline: tokio::time::Instant,
    ) {
    }
}

/// Publishes the collector's connection identity for an externally launched
/// AnyHarness (`ANYHARNESS_DEV_URL`), which cannot inherit the bridge
/// descriptor and so produces no diagnostics at all without this.
///
/// A sourceable env snippet, not a log line: the capability is a secret, so
/// printing it into the boot log would put it in scrollback and in any log
/// capture, while a 0600 file under the app dir is picked up by one `set -a;
/// . <path>` in the `make dev` recipe. Only the path is logged.
///
/// Dev builds only, and only while the collector is Ready — the snippet is
/// rewritten on every app boot, so a collector restart is picked up the next
/// time the dev runtime is started.
#[cfg(all(debug_assertions, unix))]
pub(super) fn publish_dev_diagnostics_env(supervisor: &Arc<DiagnosticsCollectorSupervisor>) {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let Ok(path) = crate::app_config::dev_diagnostics_env_path() else {
        return;
    };
    let collector = match supervisor.dev_collector_env() {
        Ok(collector) => collector,
        Err(unavailable) => {
            tracing::warn!(
                classification = unavailable.classification(),
                "dev diagnostics env not published: collector unavailable"
            );
            return;
        }
    };
    let snippet = format!(
        "{}={}\n{}={}\n{}={}\n",
        proliferate_diagnostics_client::DEV_ENDPOINT_ENV,
        collector.endpoint,
        proliferate_diagnostics_client::DEV_CAPABILITY_ENV,
        collector.capability,
        proliferate_diagnostics_client::DEV_COLLECTOR_BOOT_ID_ENV,
        collector.collector_boot_id,
    );
    let written = path
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&path)?;
            file.write_all(snippet.as_bytes())
        });
    match written {
        Ok(()) => tracing::info!(
            dev_diagnostics_env = %path.display(),
            endpoint = %collector.endpoint,
            "external runtime can enable diagnostics with: set -a; . <dev_diagnostics_env>; set +a"
        ),
        Err(error) => tracing::warn!(
            dev_diagnostics_env = %path.display(),
            error = %error,
            "failed to publish dev diagnostics env"
        ),
    }
}
