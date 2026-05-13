use serde::{Deserialize, Serialize};

use super::versions::VersionReport;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReport {
    pub supports_process_spawn: bool,
    pub supports_pty: bool,
    pub supports_filesystem: bool,
    pub supports_git: bool,
    pub supports_network_egress: bool,
    pub supports_port_forwarding: bool,
    pub supports_browser: bool,
    pub supports_computer_use: bool,
    pub supports_docker: bool,
}

pub async fn probe_capabilities(versions: &VersionReport) -> CapabilityReport {
    CapabilityReport {
        supports_process_spawn: true,
        supports_pty: !cfg!(windows),
        supports_filesystem: true,
        supports_git: versions.git_version.is_some(),
        supports_network_egress: true,
        supports_port_forwarding: true,
        supports_browser: crate::inventory::versions::command_available("google-chrome").await
            || crate::inventory::versions::command_available("chromium").await
            || crate::inventory::versions::command_available("open").await,
        supports_computer_use: cfg!(target_os = "macos"),
        supports_docker: versions.docker_version.is_some(),
    }
}
