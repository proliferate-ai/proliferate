mod agent_process;
mod downloads;
pub mod install_policy;
mod lock;
pub mod manifest;
pub(crate) mod managed_npm;
mod native;
mod npm;
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
    install_agent, install_agent_with_pins, InstallError, InstallOptions,
    InstalledArtifactResult,
};
