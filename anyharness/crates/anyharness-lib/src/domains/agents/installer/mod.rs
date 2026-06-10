mod agent_process;
mod downloads;
mod lock;
pub(crate) mod managed_npm;
mod native;
mod npm;
mod service;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub use lock::AgentInstallLock;
pub(crate) use service::regenerate_seeded_agent_launchers;
pub use service::{install_agent, InstallError, InstallOptions, InstalledArtifactResult};
