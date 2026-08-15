use std::sync::atomic::{AtomicBool, Ordering};

use super::wire::DegradedClassification;
use crate::{producer::transport::CollectorClient, DiagnosticsComponent};

#[cfg(unix)]
#[path = "activation_capability.rs"]
mod capability;

static ACTIVATION_TAKEN: AtomicBool = AtomicBool::new(false);

pub enum DesktopDiagnosticsActivation {
    Disabled,
    Bundled(DesktopDiagnosticsBootstrap),
    BundledDegraded(DesktopDiagnosticsDegradedBootstrap),
    /// Dev-only, see [`DevEnvDiagnosticsBootstrap`].
    #[cfg(debug_assertions)]
    DevEnv(DevEnvDiagnosticsBootstrap),
}

pub enum BundledDesktopDiagnosticsBootstrap {
    Ready(DesktopDiagnosticsBootstrap),
    Degraded(DesktopDiagnosticsDegradedBootstrap),
    #[cfg(debug_assertions)]
    DevEnv(DevEnvDiagnosticsBootstrap),
}

impl From<DesktopDiagnosticsBootstrap> for BundledDesktopDiagnosticsBootstrap {
    fn from(value: DesktopDiagnosticsBootstrap) -> Self {
        Self::Ready(value)
    }
}

impl From<DesktopDiagnosticsDegradedBootstrap> for BundledDesktopDiagnosticsBootstrap {
    fn from(value: DesktopDiagnosticsDegradedBootstrap) -> Self {
        Self::Degraded(value)
    }
}

#[cfg(debug_assertions)]
impl From<DevEnvDiagnosticsBootstrap> for BundledDesktopDiagnosticsBootstrap {
    fn from(value: DevEnvDiagnosticsBootstrap) -> Self {
        Self::DevEnv(value)
    }
}

pub enum InitialCollectorState {
    Ready(CollectorGenerationHandle),
    Unavailable {
        generation: u64,
        classification: UnavailableClassification,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnavailableClassification {
    Starting,
    Degraded,
    Stopped,
    ShuttingDown,
    HandoffUnavailable,
}

pub struct CollectorGenerationHandle {
    pub(crate) generation: u64,
    pub(crate) collector_boot_id: String,
    pub(crate) client: std::sync::Arc<CollectorClient>,
}

pub struct DesktopDiagnosticsBootstrap {
    pub(crate) initial_state: InitialCollectorState,
    pub(crate) fallback: Option<FallbackDirectoryHandle>,
    #[cfg(unix)]
    pub(crate) bridge: std::os::unix::net::UnixStream,
    #[cfg(unix)]
    pub(crate) shutdown: std::os::fd::OwnedFd,
}

pub struct DesktopDiagnosticsDegradedBootstrap {
    pub(crate) classification: DegradedClassification,
    pub(crate) fallback: Option<FallbackDirectoryHandle>,
    #[cfg(unix)]
    pub(crate) bridge: Option<std::os::unix::net::UnixStream>,
    #[cfg(unix)]
    pub(crate) shutdown: Option<std::os::fd::OwnedFd>,
}

/// Dev-only activation for a runtime the Desktop host did not spawn.
///
/// With `ANYHARNESS_DEV_URL` the runtime is launched by `make dev`, so it never
/// inherits the control-bridge descriptor and the protected activation above
/// correctly reports `Disabled` — which is why a dev session sees zero runtime
/// records. Given the collector's loopback endpoint and capability in the
/// environment, this bootstrap talks to the same collector directly.
///
/// It carries no bridge; instead, when the host also published the snippet's
/// own path ([`DEV_ENV_PATH_ENV`]), the producer keeps re-reading that file
/// (`producer::dev_refresh`) and re-attaches to the new collector generation
/// after a restart — a file-backed twin of the fd bridge's `GenerationReady`
/// path. Without the path (an old app build's 3-line file) a collector restart
/// still ends delivery until the runtime restarts. Debug builds only.
#[cfg(debug_assertions)]
pub struct DevEnvDiagnosticsBootstrap {
    pub(crate) initial_state: InitialCollectorState,
    pub(crate) env_path: Option<std::path::PathBuf>,
}

/// Collector ingest endpoint, e.g. `http://127.0.0.1:53421/`.
#[cfg(debug_assertions)]
pub const DEV_ENDPOINT_ENV: &str = "PROLIFERATE_DIAGNOSTICS_BRIDGE_ENDPOINT";
/// Collector capability (bearer token) the host normally passes over the fd.
#[cfg(debug_assertions)]
pub const DEV_CAPABILITY_ENV: &str = "PROLIFERATE_DIAGNOSTICS_BRIDGE_TOKEN";
/// Collector boot id. Required: ingest receipts carrying a different boot id
/// latch the generation unusable, so a guessed value would silently stop
/// delivery after the first batch.
#[cfg(debug_assertions)]
pub const DEV_COLLECTOR_BOOT_ID_ENV: &str = "PROLIFERATE_DIAGNOSTICS_BRIDGE_COLLECTOR_BOOT_ID";
/// Absolute path of the env snippet itself. The host rewrites that file on
/// every new collector generation, so a producer that keeps re-reading it can
/// re-attach after a collector restart instead of staying pinned to a dead
/// generation.
#[cfg(debug_assertions)]
pub const DEV_ENV_PATH_ENV: &str = "PROLIFERATE_DIAGNOSTICS_DEV_ENV_PATH";

/// Initial generation for the dev path. With no bridge nothing pushes newer
/// generations; the file-backed refresh loop advances its own locally owned
/// counter past this on every re-attach.
#[cfg(debug_assertions)]
pub(crate) const DEV_COLLECTOR_GENERATION: u64 = 1;
/// Matches the transport's own capability bound; longer values are rejected
/// there anyway.
#[cfg(debug_assertions)]
const DEV_CAPABILITY_MAX_BYTES: usize = 256;
/// Generous filesystem-path bound for the snippet's self-path line.
#[cfg(debug_assertions)]
const DEV_ENV_PATH_MAX_BYTES: usize = 4096;
/// The whole snippet is four short lines; anything larger is not ours.
#[cfg(all(unix, debug_assertions))]
const DEV_ENV_FILE_MAX_BYTES: usize = 8192;

pub(crate) struct FallbackDirectoryHandle {
    #[cfg(unix)]
    pub(crate) descriptor: std::os::fd::OwnedFd,
}

#[cfg(unix)]
pub(crate) fn collector_generation_from_received(
    generation: u64,
    mut descriptor: proliferate_diagnostics_protocol::v1::types::ConnectionDescriptorV1,
    capability_fd: std::os::fd::OwnedFd,
) -> Result<CollectorGenerationHandle, ()> {
    use std::os::fd::AsRawFd;

    use proliferate_diagnostics_protocol::v1::{
        limits::MAX_SAFE_INTEGER, types::TokenReferenceKindV1,
        validation::validate_connection_descriptor,
    };

    let capability_deadline =
        std::time::Instant::now() + super::wire::CHILD_BOOTSTRAP_READ_DEADLINE;

    if generation > MAX_SAFE_INTEGER {
        return Err(());
    }
    descriptor.token_reference.reference = capability_fd.as_raw_fd().to_string();
    if descriptor.token_reference.kind != TokenReferenceKindV1::InheritedFileDescriptor
        || validate_connection_descriptor(&descriptor).is_err()
    {
        return Err(());
    }
    let capability = capability::read_capability_until(capability_fd, capability_deadline)?;
    let client = CollectorClient::new(&descriptor.endpoint, capability).map_err(|_| ())?;
    Ok(CollectorGenerationHandle {
        generation,
        collector_boot_id: descriptor.collector_boot_id,
        client: std::sync::Arc::new(client),
    })
}

pub fn take_desktop_activation(component: DiagnosticsComponent) -> DesktopDiagnosticsActivation {
    if ACTIVATION_TAKEN.swap(true, Ordering::AcqRel) {
        return DesktopDiagnosticsActivation::Disabled;
    }
    match platform::take(component) {
        // Only the absence of the inherited bridge is eligible for the dev
        // fallback: a descriptor that exists but is unusable stays degraded.
        DesktopDiagnosticsActivation::Disabled => dev_env_activation(),
        activation => activation,
    }
}

#[cfg(not(debug_assertions))]
fn dev_env_activation() -> DesktopDiagnosticsActivation {
    DesktopDiagnosticsActivation::Disabled
}

#[cfg(debug_assertions)]
fn dev_env_activation() -> DesktopDiagnosticsActivation {
    use proliferate_diagnostics_protocol::v1::limits::MAX_ID_BYTES;

    let Some(endpoint) = bounded_env(DEV_ENDPOINT_ENV, MAX_ID_BYTES) else {
        return DesktopDiagnosticsActivation::Disabled;
    };
    let (Some(capability), Some(collector_boot_id)) = (
        bounded_env(DEV_CAPABILITY_ENV, DEV_CAPABILITY_MAX_BYTES),
        bounded_env(DEV_COLLECTOR_BOOT_ID_ENV, MAX_ID_BYTES),
    ) else {
        eprintln!(
            "[desktop-diagnostics] {DEV_ENDPOINT_ENV} set without {DEV_CAPABILITY_ENV} and {DEV_COLLECTOR_BOOT_ID_ENV}; dev activation skipped"
        );
        return DesktopDiagnosticsActivation::Disabled;
    };
    let Ok(client) = CollectorClient::new(&endpoint, capability) else {
        eprintln!("[desktop-diagnostics] dev collector endpoint rejected: {endpoint}");
        return DesktopDiagnosticsActivation::Disabled;
    };
    eprintln!("[desktop-diagnostics] dev activation against {endpoint}");
    DesktopDiagnosticsActivation::DevEnv(DevEnvDiagnosticsBootstrap {
        initial_state: InitialCollectorState::Ready(CollectorGenerationHandle {
            generation: DEV_COLLECTOR_GENERATION,
            collector_boot_id,
            client: std::sync::Arc::new(client),
        }),
        // Optional: absent with an old app build's 3-line snippet, which
        // freezes the producer on the boot-time generation as before.
        env_path: bounded_env(DEV_ENV_PATH_ENV, DEV_ENV_PATH_MAX_BYTES)
            .map(std::path::PathBuf::from),
    })
}

/// The three collector values parsed back out of the published snippet.
#[cfg(all(unix, debug_assertions))]
pub(crate) struct ParsedDevEnv {
    pub(crate) endpoint: String,
    pub(crate) capability: String,
    pub(crate) collector_boot_id: String,
}

/// Parses the host-published dev env snippet with the same bounds as
/// [`dev_env_activation`]. Rejects missing keys and out-of-bound values.
/// The file is 0600 and the capability is a secret: callers must never log
/// values, only the endpoint.
#[cfg(all(unix, debug_assertions))]
pub(crate) fn parse_dev_env_file(path: &std::path::Path) -> Option<ParsedDevEnv> {
    use proliferate_diagnostics_protocol::v1::limits::MAX_ID_BYTES;

    let content = std::fs::read_to_string(path).ok()?;
    if content.len() > DEV_ENV_FILE_MAX_BYTES {
        return None;
    }
    let (mut endpoint, mut capability, mut collector_boot_id) = (None, None, None);
    for line in content.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let slot = match key {
            DEV_ENDPOINT_ENV => &mut endpoint,
            DEV_CAPABILITY_ENV => &mut capability,
            DEV_COLLECTOR_BOOT_ID_ENV => &mut collector_boot_id,
            _ => continue,
        };
        *slot = Some(value.trim().to_owned());
    }
    let bounded = |value: &Option<String>, limit: usize| {
        value
            .as_deref()
            .is_some_and(|value| !value.is_empty() && value.len() <= limit)
    };
    if !bounded(&endpoint, MAX_ID_BYTES)
        || !bounded(&capability, DEV_CAPABILITY_MAX_BYTES)
        || !bounded(&collector_boot_id, MAX_ID_BYTES)
    {
        return None;
    }
    Some(ParsedDevEnv {
        endpoint: endpoint?,
        capability: capability?,
        collector_boot_id: collector_boot_id?,
    })
}

#[cfg(debug_assertions)]
fn bounded_env(name: &str, limit: usize) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && value.len() <= limit)
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
#[path = "activation_platform.rs"]
mod platform;

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
mod platform {
    use super::*;

    pub(super) fn take(_: DiagnosticsComponent) -> DesktopDiagnosticsActivation {
        DesktopDiagnosticsActivation::Disabled
    }
}

#[cfg(all(
    test,
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
#[path = "activation_tests.rs"]
mod tests;

#[cfg(all(
    test,
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
#[path = "activation_parse_tests.rs"]
mod parse_tests;

#[cfg(all(
    test,
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
#[path = "activation_review_tests.rs"]
mod review_tests;
