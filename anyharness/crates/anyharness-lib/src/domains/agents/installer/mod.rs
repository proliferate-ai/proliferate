mod agent_process;
pub mod auto_install;
mod downloads;
pub mod install_policy;
mod lock;
pub(crate) mod managed_npm;
pub mod manifest;
mod npm;
mod npm_platform;
pub mod off_runtime;
mod pinned;
pub mod progress;
pub mod reconcile;
pub mod seed;
mod service;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub use lock::AgentInstallLock;
pub(crate) use service::regenerate_seeded_agent_launchers;
pub use service::{
    install_agent, install_agent_with_pins, install_agent_with_pins_and_progress, InstallError,
    InstallErrorKind, InstallOptions, InstalledArtifactResult,
};
