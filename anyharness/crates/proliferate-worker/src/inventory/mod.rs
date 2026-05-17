pub mod capabilities;
pub mod mcp;
pub mod platform;
pub mod providers;
pub mod versions;

use serde_json::json;

use crate::cloud_client::InventoryPayload;

pub fn collect() -> InventoryPayload {
    InventoryPayload {
        os: Some(std::env::consts::OS.to_string()),
        arch: Some(std::env::consts::ARCH.to_string()),
        distro: platform::distro(),
        shell: platform::shell(),
        git: versions::command_version("git", &["--version"]),
        node: versions::node_inventory(),
        python: versions::python_inventory(),
        browser: capabilities::browser_inventory(),
        capabilities: Some(json!({
            "processSpawn": true,
            "filesystem": true,
            "networkEgress": true,
            "pty": true,
            "runtimeConfigManifestV1": true
        })),
        providers: providers::collect(),
        mcp: mcp::collect(),
    }
}
