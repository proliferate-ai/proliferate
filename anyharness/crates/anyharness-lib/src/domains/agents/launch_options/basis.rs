use std::fmt::Write;
use std::fs::Metadata;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::domains::agents::installer::manifest::{read_manifest, role_name};
use crate::domains::agents::model::{ResolvedArtifact, SpawnSpec};
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
    // v3 adds model-scoped control observations. Folding the observation
    // schema into the basis prevents a runtime upgrade from continuing to
    // serve a persisted flat v2 row under the new admission rules.
    hasher.update(b"harness-launch-options-v3\0");
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
        let ambient_native_override = effective_ambient_native_override(harness_kind);
        hash_effective_native_artifact(
            &mut hasher,
            resolved.native.as_ref(),
            ambient_native_override.as_deref(),
        );
        hash_resolved_artifact(&mut hasher, &resolved.agent_process);
        if let Some(spawn) = resolved.spawn.as_ref() {
            hash_spawn_spec(&mut hasher, spawn);
        } else {
            hash_field(&mut hasher, b"no-effective-spawn-spec");
        }
    } else {
        hash_field(&mut hasher, b"unregistered-harness");
    }

    let auth_sequence = load_state_file(runtime_home)
        .ok()
        .flatten()
        .map(|state| state.sequence)
        .unwrap_or(0);
    hasher.update(auth_sequence.to_be_bytes());

    let mut revision = String::with_capacity(64);
    for byte in hasher.finalize() {
        let _ = write!(&mut revision, "{byte:02x}");
    }
    revision
}

fn effective_ambient_native_override(harness_kind: &str) -> Option<PathBuf> {
    if harness_kind != "claude" {
        return None;
    }
    std::env::var_os("CLAUDE_CODE_EXECUTABLE")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn hash_effective_native_artifact(
    hasher: &mut Sha256,
    resolved_native: Option<&ResolvedArtifact>,
    ambient_native_override: Option<&Path>,
) {
    if let Some(native) = resolved_native {
        hash_resolved_artifact(hasher, native);
    } else if let Some(path) = ambient_native_override {
        // When readiness found no native artifact, the Claude adapter can
        // still inherit this host-level executable selector. It is therefore
        // part of the executable identity actually used by probe and launch.
        hash_field(hasher, b"ambient-native-override");
        hash_executable_metadata(hasher, path);
    } else {
        hash_field(hasher, b"no-native-artifact");
    }
}

fn hash_spawn_spec(hasher: &mut Sha256, spawn: &SpawnSpec) {
    hash_field(hasher, b"effective-spawn-spec");
    hash_executable_metadata(hasher, &spawn.program);
    for arg in &spawn.args {
        hash_field(hasher, b"spawn-arg");
        hash_field(hasher, arg.as_bytes());
    }

    let mut env = spawn.env.iter().collect::<Vec<_>>();
    env.sort_by(|(left, _), (right, _)| left.cmp(right));
    for (key, value) in env {
        hash_field(hasher, b"spawn-env");
        hash_field(hasher, key.as_bytes());
        hash_field(hasher, value.as_bytes());
    }

    if let Some(cwd) = spawn.cwd.as_deref() {
        hash_field(hasher, b"spawn-cwd");
        hash_field(hasher, cwd.as_os_str().as_encoded_bytes());
    } else {
        hash_field(hasher, b"no-spawn-cwd");
    }
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

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock after epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "anyharness-launch-basis-{label}-{}-{unique}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn spawn_spec_digest(spawn: &SpawnSpec) -> Vec<u8> {
        let mut hasher = Sha256::new();
        hash_spawn_spec(&mut hasher, spawn);
        hasher.finalize().to_vec()
    }

    #[test]
    fn managed_native_transition_changes_basis_even_when_agent_process_is_stable() {
        let home = TestDir::new("managed-native-transition");
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

        let home = TestDir::new("path-executable-replacement");
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

    #[test]
    fn complete_spawn_spec_changes_effective_identity() {
        let base = SpawnSpec {
            program: PathBuf::from("/tmp/agent-adapter"),
            args: vec!["--stdio".to_string()],
            env: std::collections::HashMap::from([(
                "CLAUDE_CODE_EXECUTABLE".to_string(),
                "/tmp/claude-a".to_string(),
            )]),
            cwd: Some(PathBuf::from("/tmp/adapter-a")),
        };

        let mut changed_args = base.clone();
        changed_args.args.push("--models-from=config-b".to_string());
        assert_ne!(spawn_spec_digest(&base), spawn_spec_digest(&changed_args));

        let mut changed_env = base.clone();
        changed_env.env.insert(
            "CLAUDE_CODE_EXECUTABLE".to_string(),
            "/tmp/claude-b".to_string(),
        );
        assert_ne!(spawn_spec_digest(&base), spawn_spec_digest(&changed_env));

        let mut changed_cwd = base.clone();
        changed_cwd.cwd = Some(PathBuf::from("/tmp/adapter-b"));
        assert_ne!(spawn_spec_digest(&base), spawn_spec_digest(&changed_cwd));
    }

    #[test]
    fn unresolved_native_includes_ambient_executable_selector() {
        let mut first = Sha256::new();
        hash_effective_native_artifact(&mut first, None, Some(Path::new("/tmp/claude-native-a")));

        let mut second = Sha256::new();
        hash_effective_native_artifact(&mut second, None, Some(Path::new("/tmp/claude-native-b")));

        assert_ne!(first.finalize().as_slice(), second.finalize().as_slice());
    }
}
