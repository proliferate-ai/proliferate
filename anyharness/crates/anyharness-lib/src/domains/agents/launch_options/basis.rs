use std::path::Path;
use std::fmt::Write;

use sha2::{Digest, Sha256};

use crate::domains::agents::installer::manifest::{read_manifest, role_name};
use crate::domains::agents::model::ArtifactRole;
use crate::domains::agents::route_auth::state::load_state_file;

/// Hash only product-owned launch-option inputs. Workspace/session environment
/// is deliberately absent from this function and from every caller.
pub fn compute_harness_basis_revision(runtime_home: &Path, harness_kind: &str) -> String {
    let install_identity = read_manifest(runtime_home, harness_kind)
        .and_then(|manifest| {
            let agent_process = role_name(&ArtifactRole::AgentProcess);
            manifest
                .artifacts
                .into_iter()
                .find(|artifact| artifact.role == agent_process)
        })
        .map(|artifact| {
            format!(
                "{}:{}:{}:{}",
                artifact.role,
                artifact.version.unwrap_or_default(),
                artifact.sha256.unwrap_or_default(),
                artifact.source
            )
        })
        .unwrap_or_else(|| "uninstalled".to_string());
    let auth_revision = load_state_file(runtime_home)
        .ok()
        .flatten()
        .map(|state| state.revision)
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(b"harness-launch-options-v1\0");
    hasher.update(harness_kind.as_bytes());
    hasher.update(b"\0");
    hasher.update(install_identity.as_bytes());
    hasher.update(b"\0");
    hasher.update(auth_revision.to_be_bytes());
    let mut revision = String::with_capacity(64);
    for byte in hasher.finalize() {
        let _ = write!(&mut revision, "{byte:02x}");
    }
    revision
}
