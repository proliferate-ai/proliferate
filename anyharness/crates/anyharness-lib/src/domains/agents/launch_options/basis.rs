use std::fmt::Write;
use std::fs::Metadata;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::domains::agents::installer::manifest::{read_manifest, role_name};
use crate::domains::agents::model::{ResolvedArtifact, SpawnSpec};
use crate::domains::agents::readiness::service::resolve_agent_unrouted;
use crate::domains::agents::registry;
use crate::domains::agent_auth::route_auth::{current_server_origin, load_effective_state};

/// Hash only product-owned launch-option inputs. Workspace/session environment
/// is deliberately absent from this function and from every caller.
///
/// Install identity includes every managed artifact plus the executable files
/// actually selected by readiness. The latter is load-bearing for PATH-only
/// and override-backed harnesses, which have no installer manifest at all.
pub fn compute_harness_basis_revision(runtime_home: &Path, harness_kind: &str) -> String {
    let mut hasher = Sha256::new();
    // v4 replaces the global-document fold with the harness's OWN auth-entry
    // content hash (below) — the fold change legitimately invalidates every
    // basis once at upgrade. v3 added model-scoped control observations.
    hasher.update(b"harness-launch-options-v4\0");
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

    hash_harness_auth_entry(&mut hasher, runtime_home, harness_kind);

    let mut revision = String::with_capacity(64);
    for byte in hasher.finalize() {
        let _ = write!(&mut revision, "{byte:02x}");
    }
    revision
}

/// Fold the harness's OWN entry from the applied agent-auth document — a
/// content hash, never the document's global `sequence`.
///
/// The old fold hashed the whole document's sequence, so EVERY push
/// invalidated EVERY harness's launch options — a re-render that changed only
/// grok's auth made codex's persisted observation unservable (the probe-decay
/// bug's first half). Downstream invalidation keys on per-harness content
/// (spec §2, "A no-op render changes neither"), so this hashes exactly what a
/// launch render would consume for THIS harness:
///
/// - the SAME effective-state seam launches use ([`load_effective_state`]
///   with the current server origin), so an origin-mismatched or absent
///   document reads as no entry here exactly as it renders native there;
/// - the harness's `HarnessAuth` entry serialized canonically (serde_json
///   without `preserve_order`, so `settings` maps are key-sorted) when
///   present, else a `no-auth-entry` marker;
/// - a malformed/unreadable state file hashes as absent, matching the render
///   plane's tolerance (readiness must not churn a basis the launcher itself
///   tolerates).
fn hash_harness_auth_entry(hasher: &mut Sha256, runtime_home: &Path, harness_kind: &str) {
    let entry_bytes = load_effective_state(runtime_home, current_server_origin().as_deref())
        .ok()
        .flatten()
        .and_then(|state| {
            state
                .harnesses
                .iter()
                .find(|entry| entry.harness_kind == harness_kind)
                .and_then(|entry| serde_json::to_vec(entry).ok())
        });
    match entry_bytes {
        Some(bytes) => {
            hash_field(hasher, b"auth-entry");
            hash_field(hasher, &bytes);
        }
        None => hash_field(hasher, b"no-auth-entry"),
    }
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

    fn write_state_json(home: &Path, value: &serde_json::Value) {
        let path = crate::domains::agent_auth::route_auth::state_file_path(home);
        std::fs::create_dir_all(path.parent().expect("state parent")).expect("create agent-auth");
        std::fs::write(&path, serde_json::to_vec_pretty(value).expect("serialize"))
            .expect("write state");
    }

    fn state_doc(sequence: i64, harnesses: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "version": 2,
            "sequence": sequence,
            "harnesses": harnesses,
        })
    }

    fn codex_entry(key: &str) -> serde_json::Value {
        serde_json::json!({
            "harness_kind": "codex",
            "sources": [{ "kind": "gateway", "base_url": "https://gw.example", "key": key }],
        })
    }

    fn grok_entry(key: &str) -> serde_json::Value {
        serde_json::json!({
            "harness_kind": "grok",
            "sources": [{ "kind": "api_key", "env_var_name": "XAI_API_KEY", "value": key }],
        })
    }

    /// The probe-decay fix, pinned from both sides:
    /// - a push that changed ONLY the sequence (identical harness entry) leaves
    ///   the basis unchanged — a no-op render cannot invalidate launch options;
    /// - a push that changed ONLY ANOTHER harness's entry leaves this
    ///   harness's basis unchanged — changing grok's auth cannot dim codex;
    /// - a push that changed THIS harness's entry changes the basis (the
    ///   regression guard: content still invalidates).
    #[test]
    fn basis_ignores_noop_renders() {
        let home = TestDir::new("basis-noop-renders");

        write_state_json(
            home.path(),
            &state_doc(
                1,
                serde_json::json!([codex_entry("sk-vk-1"), grok_entry("xai-1")]),
            ),
        );
        let baseline = compute_harness_basis_revision(home.path(), "codex");

        // Sequence moved, codex's entry byte-identical → basis unchanged.
        write_state_json(
            home.path(),
            &state_doc(
                2,
                serde_json::json!([codex_entry("sk-vk-1"), grok_entry("xai-1")]),
            ),
        );
        assert_eq!(
            compute_harness_basis_revision(home.path(), "codex"),
            baseline,
            "a sequence-only push must not invalidate the harness's basis"
        );

        // Only grok's entry changed → codex's basis still unchanged.
        write_state_json(
            home.path(),
            &state_doc(
                3,
                serde_json::json!([codex_entry("sk-vk-1"), grok_entry("xai-2")]),
            ),
        );
        assert_eq!(
            compute_harness_basis_revision(home.path(), "codex"),
            baseline,
            "another harness's auth change must not invalidate this harness's basis"
        );

        // Codex's own entry changed → the basis moves.
        write_state_json(
            home.path(),
            &state_doc(
                4,
                serde_json::json!([codex_entry("sk-vk-2"), grok_entry("xai-2")]),
            ),
        );
        assert_ne!(
            compute_harness_basis_revision(home.path(), "codex"),
            baseline,
            "the harness's own auth change must invalidate its basis"
        );
    }

    /// Absent entry, present entry, and malformed state are three distinct
    /// worlds only where the render plane treats them distinctly: absent and
    /// malformed both render tolerantly (no route), so both hash as absent.
    #[test]
    fn basis_hashes_malformed_state_as_absent() {
        let home = TestDir::new("basis-malformed-absent");
        let absent = compute_harness_basis_revision(home.path(), "codex");

        let path = crate::domains::agent_auth::route_auth::state_file_path(home.path());
        std::fs::create_dir_all(path.parent().expect("state parent")).expect("create agent-auth");
        std::fs::write(&path, b"{ not json").expect("write malformed state");
        assert_eq!(
            compute_harness_basis_revision(home.path(), "codex"),
            absent,
            "a malformed state file must hash as no entry, matching render tolerance"
        );

        write_state_json(
            home.path(),
            &state_doc(1, serde_json::json!([codex_entry("sk-vk-1")])),
        );
        assert_ne!(
            compute_harness_basis_revision(home.path(), "codex"),
            absent,
            "a present entry must hash differently from no entry"
        );
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
