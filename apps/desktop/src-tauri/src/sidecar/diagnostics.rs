//! Bundled diagnostics wiring for the Tauri-owned `anyharness serve` child.
//!
//! On the two accepted packaged macOS targets the owned launch carries the
//! reserved bridge and shutdown descriptors; everywhere else the legacy spawn
//! is preserved untouched. Descriptor or remap failure before a successful
//! exec closes every partial authority and performs at most one direct
//! unprotected product launch — an observability outcome (`Disabled`), never
//! a product-launch failure. A returned successful protected spawn is the
//! point of no retry.

use std::{io, sync::Arc};

use tokio::process::{Child, Command};

use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use crate::diagnostics_collector::child_bridge::{
    fallback_root::{resolve_fallback_root, FallbackRootOutcome},
    launch::PreparedChildDiagnosticsLaunch,
    runtime::{
        ChildBridgeConnection, ChildDiagnosticsBridge, ChildProcessPresence,
        DesktopChildDiagnosticsState,
    },
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
    build_command: impl Fn() -> Command,
    supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> io::Result<SpawnedAnyharness> {
    let prepared = match PreparedChildDiagnosticsLaunch::create() {
        Ok(prepared) => prepared,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "diagnostics descriptors unavailable; launching AnyHarness unprotected"
            );
            return spawn_unprotected(&build_command);
        }
    };
    let fallback = anyharness_fallback_root();
    match prepared.spawn(build_command()) {
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
            spawn_unprotected(&build_command)
        }
    }
}

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
pub(super) fn spawn_owned_anyharness(
    build_command: impl Fn() -> Command,
    _supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> io::Result<SpawnedAnyharness> {
    Ok(SpawnedAnyharness {
        child: build_command().spawn()?,
    })
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
        let process = match self.child.as_mut() {
            None => ChildProcessPresence::Missing,
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => ChildProcessPresence::Exited,
                Ok(None) => ChildProcessPresence::Running,
                Err(_) => ChildProcessPresence::Missing,
            },
        };
        match self.diagnostics_bridge.as_ref() {
            Some(bridge) => bridge.diagnostics_state(process).await,
            None => DesktopChildDiagnosticsState {
                process,
                bridge: ChildBridgeConnection::NotActivated,
                producer: None,
            },
        }
    }

    /// Consumes one identity-stable child reap proof. The bridge may submit a
    /// producer-death control record only when it also retained a matching
    /// ordered delivery fence for this producer and collector generation.
    pub(super) async fn finish_diagnostics_reap(&self, status: std::process::ExitStatus) {
        if let Some(bridge) = self.diagnostics_bridge.as_ref() {
            let proof = crate::diagnostics_collector::child_bridge::reap::VerifiedChildReap::from_exit_status(status);
            let _ = bridge.finish_verified_reap(proof).await;
        }
    }
}

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
impl super::SidecarProcess {
    pub(super) async fn finish_diagnostics_reap(&self, _status: std::process::ExitStatus) {}
}
