pub mod capabilities;
pub mod mcp;
pub mod platform;
pub mod providers;
pub mod versions;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::anyharness_client::AnyHarnessClient;
use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReport {
    pub os_kind: String,
    pub os_version: Option<String>,
    pub arch: String,
    pub distro: Option<String>,
    pub shell: Option<String>,
    pub package_managers: Vec<String>,
    pub workspace_roots: Vec<String>,
    pub capabilities: capabilities::CapabilityReport,
    #[serde(rename = "toolVersions")]
    pub versions: versions::VersionReport,
    pub provider_readiness: serde_json::Value,
    pub mcp_readiness: serde_json::Value,
    pub anyharness_runtime_inventory: Option<serde_json::Value>,
    pub reported_at: String,
}

pub async fn collect(anyharness: &AnyHarnessClient) -> Result<InventoryReport> {
    let platform = platform::probe_platform().await;
    let versions = versions::probe_versions().await;
    let capabilities = capabilities::probe_capabilities(&versions).await;
    let anyharness_runtime_inventory = anyharness.runtime_inventory().await.ok();

    Ok(InventoryReport {
        os_kind: platform.os_kind,
        os_version: platform.os_version,
        arch: platform.arch,
        distro: platform.distro,
        shell: platform.shell,
        package_managers: platform.package_managers,
        workspace_roots: platform.workspace_roots,
        capabilities,
        versions,
        provider_readiness: providers::probe_provider_readiness().await,
        mcp_readiness: mcp::probe_mcp_readiness().await,
        anyharness_runtime_inventory,
        reported_at: Utc::now().to_rfc3339(),
    })
}

pub fn hash_report(report: &InventoryReport) -> Result<String> {
    let bytes = serde_json::to_vec(report)?;
    let digest = Sha256::digest(bytes);
    Ok(to_hex(&digest))
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}
