use std::fmt::Write;
use std::fs::Metadata;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::domains::agents::installer::manifest::{read_manifest, role_name};
use crate::domains::agents::model::ResolvedArtifact;
use crate::domains::agents::readiness::service::resolve_agent_unrouted;
use crate::domains::agents::registry;
use crate::domains::agents::route_auth::state::load_state_file;

/// Hash only product-owned launch-option inputs. Workspace/session environment
/// is deliberately absent from this function and from every caller.
///
/// Install identity includes every managed artifact plus the executable files
/// actually selected by readiness. The latter is load-bearing for PATH-only
/// and override-backed harnesses, which have no installer manifest at all.
pub fn compute_harness_basis_revision(runtime_home: &Path, harness_kind: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"harness-launch-options-v2\0");
    hasher.update(harness_kind.as_bytes());
    hasher.update(b"\0");

    match read_manifest(runtime_home, harness_kind) {
        Some(mut manifest) => {
            manifest
                .artifacts
                .sort_by(|left, right| left.role.cmp(&right.role));
            for artifact in manifest.artifacts {
                hash_field(&mut hasher, artifact.role.as_bytes());
                hash_field(
                    &mut hasher,
                    artifact.version.as_deref().unwrap_or_default().as_bytes(),
                );
                hash_field(
                    &mut hasher,
                    artifact.sha256.as_deref().unwrap_or_default().as_bytes(),
                );
                hash_field(&mut hasher, artifact.source.as_bytes());
            }
        }
        None => hash_field(&mut hasher, b"no-install-manifest"),
    }

    if let Some(descriptor) = registry::descriptor(harness_kind) {
        let resolved = resolve_agent_unrouted(&descriptor, runtime_home);
        if let Some(native) = resolved.native.as_ref() {
            hash_resolved_artifact(&mut hasher, native);
        } else {
            hash_field(&mut hasher, b"no-native-artifact");
        }
        hash_resolved_artifact(&mut hasher, &resolved.agent_process);
        if let Some(spawn) = resolved.spawn.as_ref() {
            hash_field(&mut hasher, b"effective-spawn-program");
            hash_executable_metadata(&mut hasher, &spawn.program);
        }
    } else {
        hash_field(&mut hasher, b"unregistered-harness");
    }

    let auth_revision = load_state_file(runtime_home)
        .ok()
        .flatten()
        .map(|state| state.revision)
        .unwrap_or(0);
    hasher.update(auth_revision.to_be_bytes());

    let mut revision = String::with_capacity(64);
    for byte in hasher.finalize() {
        let _ = write!(&mut revision, "{byte:02x}");
    }
    revision
}

fn hash_resolved_artifact(hasher: &mut Sha256, artifact: &ResolvedArtifact) {
    hash_field(hasher, role_name(&artifact.role).as_bytes());
    hash_field(
        hasher,
        if artifact.installed {
            b"installed"
        } else {
            b"absent"
        },
    );
    hash_field(
        hasher,
        artifact.source.as_deref().unwrap_or_default().as_bytes(),
    );
    hash_field(
        hasher,
        artifact.version.as_deref().unwrap_or_default().as_bytes(),
    );
    if let Some(path) = artifact.path.as_deref() {
        hash_executable_metadata(hasher, path);
    } else {
        hash_field(hasher, b"no-effective-path");
    }
}

fn hash_executable_metadata(hasher: &mut Sha256, path: &Path) {
    hash_field(hasher, path.as_os_str().as_encoded_bytes());
    match std::fs::metadata(path) {
        Ok(metadata) => hash_metadata(hasher, &metadata),
        Err(_) => hash_field(hasher, b"effective-path-unreadable"),
    }
}

#[cfg(unix)]
fn hash_metadata(hasher: &mut Sha256, metadata: &Metadata) {
    use std::os::unix::fs::MetadataExt;

    // The path is already folded into the outer hash. Device/inode plus size
    // and both modification/change timestamps distinguish path replacement
    // and in-place rewrite without reading an executable into memory.
    for value in [
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime() as u64,
        metadata.mtime_nsec() as u64,
        metadata.ctime() as u64,
        metadata.ctime_nsec() as u64,
    ] {
        hasher.update(value.to_be_bytes());
    }
}

#[cfg(not(unix))]
fn hash_metadata(hasher: &mut Sha256, metadata: &Metadata) {
    hasher.update(metadata.len().to_be_bytes());
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok());
    hasher.update(
        modified
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
            .to_be_bytes(),
    );
}

fn hash_field(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::installer::manifest::{record_entries, ManifestArtifact};
    use crate::domains::agents::model::ArtifactRole;

    #[test]
    fn managed_native_transition_changes_basis_even_when_agent_process_is_stable() {
        let home = tempfile::tempdir().expect("temp runtime home");
        let entries = |native_sha: &str| {
            vec![
                ManifestArtifact {
                    role: role_name(&ArtifactRole::AgentProcess).to_string(),
                    version: Some("adapter-1".to_string()),
                    sha256: Some("adapter-sha".to_string()),
                    source: "managed_npm".to_string(),
                    installed_at: "2026-08-19T00:00:00Z".to_string(),
                    path: "ignored-by-basis".to_string(),
                },
                ManifestArtifact {
                    role: role_name(&ArtifactRole::NativeCli).to_string(),
                    version: Some("native-1".to_string()),
                    sha256: Some(native_sha.to_string()),
                    source: "managed".to_string(),
                    installed_at: "2026-08-19T00:00:00Z".to_string(),
                    path: "ignored-by-basis".to_string(),
                },
            ]
        };

        record_entries(home.path(), "claude", entries("native-sha-1"))
            .expect("record first manifest");
        let first = compute_harness_basis_revision(home.path(), "claude");
        record_entries(home.path(), "claude", entries("native-sha-2"))
            .expect("record changed native manifest");
        let second = compute_harness_basis_revision(home.path(), "claude");

        assert_ne!(first, second);
    }

    #[cfg(unix)]
    #[test]
    fn path_executable_replacement_changes_effective_identity() {
        use std::os::unix::fs::PermissionsExt;

        let home = tempfile::tempdir().expect("temp runtime home");
        let executable = home.path().join("grok");
        std::fs::write(&executable, "#!/bin/sh\nexit 0\n").expect("write first executable");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755))
            .expect("make first executable");

        let mut first = Sha256::new();
        hash_executable_metadata(&mut first, &executable);
        let first = first.finalize();

        let replacement = home.path().join("grok-replacement");
        std::fs::write(&replacement, "#!/bin/sh\nexit 7\n").expect("write replacement executable");
        std::fs::set_permissions(&replacement, std::fs::Permissions::from_mode(0o755))
            .expect("make replacement executable");
        std::fs::rename(&replacement, &executable).expect("replace executable");

        let mut second = Sha256::new();
        hash_executable_metadata(&mut second, &executable);
        assert_ne!(first.as_slice(), second.finalize().as_slice());
    }
}
