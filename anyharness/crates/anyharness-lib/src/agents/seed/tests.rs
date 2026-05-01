use super::*;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn temp_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("{name}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).expect("create temp dir");
    path
}

fn write_staged_artifact(staging: &Path, rel_path: &str, contents: &[u8]) -> String {
    let path = staging.join(rel_path);
    fs::create_dir_all(path.parent().expect("artifact parent")).expect("create parent");
    fs::write(&path, contents).expect("write staged artifact");
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(&path)
            .expect("artifact metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("chmod staged artifact");
    }
    checksum_path(&path).expect("checksum staged artifact")
}

fn manifest(seed_version: &str, rel_path: &str, sha256: String) -> AgentSeedManifest {
    manifest_with_seeded_agents(seed_version, rel_path, sha256, Vec::new())
}

fn manifest_with_seeded_agents(
    seed_version: &str,
    rel_path: &str,
    sha256: String,
    seeded_agents: Vec<String>,
) -> AgentSeedManifest {
    manifest_with_artifacts(
        seed_version,
        seeded_agents,
        vec![AgentSeedManifestArtifact {
            path: rel_path.to_string(),
            kind: "claude".into(),
            role: "native".into(),
            sha256,
            executable: true,
        }],
    )
}

fn manifest_with_artifacts(
    seed_version: &str,
    seeded_agents: Vec<String>,
    artifacts: Vec<AgentSeedManifestArtifact>,
) -> AgentSeedManifest {
    AgentSeedManifest {
        schema_version: MANIFEST_SCHEMA_VERSION,
        seed_version: seed_version.to_string(),
        target: "test-target".into(),
        seeded_agents,
        artifacts,
    }
}

#[test]
fn apply_seed_payload_writes_missing_artifacts() {
    let runtime_home = temp_dir("agent-seed-runtime");
    let staging = temp_dir("agent-seed-staging");
    let rel_path = "agents/claude/native/claude";
    let sha256 = write_staged_artifact(&staging, rel_path, b"seeded claude");

    let health = apply_seed_payload(
        &runtime_home,
        &staging,
        &manifest("seed-v1", rel_path, sha256.clone()),
        AgentSeedSource::ExternalDev,
    )
    .expect("apply seed");

    assert_eq!(health.status, AgentSeedStatus::Ready);
    assert_eq!(health.ownership, AgentSeedOwnership::FullSeed);
    assert_eq!(health.seed_owned_artifact_count, 1);
    assert_eq!(health.last_action, AgentSeedLastAction::Hydrated);
    assert_eq!(
        checksum_path(&runtime_home.join(rel_path)).expect("hydrated checksum"),
        sha256
    );
    let state = load_agent_seed_state(&runtime_home).expect("load seed state");
    assert_eq!(state.artifacts[0].owner, AgentSeedArtifactOwner::Seed);

    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(staging);
}

#[test]
fn apply_seed_payload_preserves_existing_user_artifacts() {
    let runtime_home = temp_dir("agent-seed-runtime");
    let staging = temp_dir("agent-seed-staging");
    let rel_path = "agents/claude/native/claude";
    let sha256 = write_staged_artifact(&staging, rel_path, b"seeded claude");
    let existing = runtime_home.join(rel_path);
    fs::create_dir_all(existing.parent().expect("existing parent")).expect("create parent");
    fs::write(&existing, b"user claude").expect("write existing artifact");

    let health = apply_seed_payload(
        &runtime_home,
        &staging,
        &manifest_with_seeded_agents("seed-v1", rel_path, sha256, vec!["claude".into()]),
        AgentSeedSource::ExternalDev,
    )
    .expect("apply seed");

    assert_eq!(health.status, AgentSeedStatus::Partial);
    assert_eq!(health.ownership, AgentSeedOwnership::UserOwnedExisting);
    assert_eq!(health.seed_owned_artifact_count, 0);
    assert_eq!(health.skipped_existing_artifact_count, 1);
    assert_eq!(fs::read(&existing).expect("read existing"), b"user claude");
    let state = load_agent_seed_state(&runtime_home).expect("load seed state");
    assert_eq!(
        state.artifacts[0].owner,
        AgentSeedArtifactOwner::UserExisting
    );

    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(staging);
}

#[test]
fn apply_seed_payload_regenerates_launcher_when_agent_process_is_seed_owned() {
    let runtime_home = temp_dir("agent-seed-runtime");
    let staging = temp_dir("agent-seed-staging");
    let native_rel_path = "agents/claude/native/claude";
    let agent_process_rel_path = "agents/claude/agent_process/node_modules/.bin/claude-agent-acp";
    let native_sha = write_staged_artifact(&staging, native_rel_path, b"seeded claude native");
    let agent_process_sha =
        write_staged_artifact(&staging, agent_process_rel_path, b"seeded claude acp");
    let existing_native = runtime_home.join(native_rel_path);
    fs::create_dir_all(existing_native.parent().expect("existing native parent"))
        .expect("create existing native parent");
    fs::write(&existing_native, b"user claude native").expect("write existing native");

    let health = apply_seed_payload(
        &runtime_home,
        &staging,
        &manifest_with_artifacts(
            "seed-v1",
            vec!["claude".into()],
            vec![
                AgentSeedManifestArtifact {
                    path: native_rel_path.to_string(),
                    kind: "claude".into(),
                    role: "native".into(),
                    sha256: native_sha,
                    executable: true,
                },
                AgentSeedManifestArtifact {
                    path: agent_process_rel_path.to_string(),
                    kind: "claude".into(),
                    role: "agent_process".into(),
                    sha256: agent_process_sha,
                    executable: true,
                },
            ],
        ),
        AgentSeedSource::ExternalDev,
    )
    .expect("apply seed");

    let launcher = runtime_home.join("agents/claude/agent_process/claude-launcher");
    let launcher_script = fs::read_to_string(&launcher).expect("read launcher");
    assert_eq!(health.status, AgentSeedStatus::Partial);
    assert_eq!(health.ownership, AgentSeedOwnership::PartialSeed);
    assert_eq!(health.seed_owned_artifact_count, 1);
    assert!(launcher.is_file());
    assert!(launcher_script.contains("DISABLE_AUTOUPDATER"));
    assert!(launcher_script.contains("claude-agent-acp"));

    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(staging);
}

#[test]
fn apply_seed_payload_does_not_regress_user_modified_seed_artifacts() {
    let runtime_home = temp_dir("agent-seed-runtime");
    let staging_v1 = temp_dir("agent-seed-staging");
    let rel_path = "agents/claude/native/claude";
    let sha_v1 = write_staged_artifact(&staging_v1, rel_path, b"seeded claude v1");
    apply_seed_payload(
        &runtime_home,
        &staging_v1,
        &manifest("seed-v1", rel_path, sha_v1),
        AgentSeedSource::ExternalDev,
    )
    .expect("apply seed v1");

    let hydrated = runtime_home.join(rel_path);
    fs::write(&hydrated, b"user installed claude").expect("modify hydrated artifact");

    let staging_v2 = temp_dir("agent-seed-staging");
    let sha_v2 = write_staged_artifact(&staging_v2, rel_path, b"seeded claude v2");
    let health = apply_seed_payload(
        &runtime_home,
        &staging_v2,
        &manifest("seed-v2", rel_path, sha_v2),
        AgentSeedSource::ExternalDev,
    )
    .expect("apply seed v2");

    assert_eq!(health.status, AgentSeedStatus::Partial);
    assert_eq!(health.ownership, AgentSeedOwnership::UserOwnedExisting);
    assert_eq!(health.seed_owned_artifact_count, 0);
    assert_eq!(health.skipped_existing_artifact_count, 1);
    assert_eq!(
        fs::read(&hydrated).expect("read hydrated artifact"),
        b"user installed claude"
    );
    let state = load_agent_seed_state(&runtime_home).expect("load seed state");
    assert_eq!(
        state.artifacts[0].owner,
        AgentSeedArtifactOwner::UserModified
    );

    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(staging_v1);
    let _ = fs::remove_dir_all(staging_v2);
}

#[test]
fn mark_installed_artifacts_user_modified_clears_last_action() {
    let runtime_home = temp_dir("agent-seed-runtime");
    let staging = temp_dir("agent-seed-staging");
    let rel_path = "agents/claude/native/claude";
    let sha = write_staged_artifact(&staging, rel_path, b"seeded claude");
    apply_seed_payload(
        &runtime_home,
        &staging,
        &manifest("seed-v1", rel_path, sha),
        AgentSeedSource::ExternalDev,
    )
    .expect("apply seed");

    mark_installed_artifacts_user_modified(
        &runtime_home,
        &AgentKind::Claude,
        &[InstalledArtifactResult {
            role: ArtifactRole::NativeCli,
            path: runtime_home.join(rel_path),
            source: "test".into(),
            version: None,
        }],
    );

    let state = load_agent_seed_state(&runtime_home).expect("load seed state");
    assert_eq!(state.last_action, AgentSeedLastAction::None);
    assert_eq!(
        state.artifacts[0].owner,
        AgentSeedArtifactOwner::UserModified
    );

    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(staging);
}

#[test]
fn apply_seed_payload_updates_clean_seed_owned_artifacts_on_version_bump() {
    let runtime_home = temp_dir("agent-seed-runtime");
    let staging_v1 = temp_dir("agent-seed-staging");
    let rel_path = "agents/claude/native/claude";
    let sha_v1 = write_staged_artifact(&staging_v1, rel_path, b"seeded claude v1");
    apply_seed_payload(
        &runtime_home,
        &staging_v1,
        &manifest("seed-v1", rel_path, sha_v1),
        AgentSeedSource::ExternalDev,
    )
    .expect("apply seed v1");

    let staging_v2 = temp_dir("agent-seed-staging");
    let sha_v2 = write_staged_artifact(&staging_v2, rel_path, b"seeded claude v2");
    let health = apply_seed_payload(
        &runtime_home,
        &staging_v2,
        &manifest("seed-v2", rel_path, sha_v2.clone()),
        AgentSeedSource::ExternalDev,
    )
    .expect("apply seed v2");

    assert_eq!(health.status, AgentSeedStatus::Ready);
    assert_eq!(health.ownership, AgentSeedOwnership::FullSeed);
    assert_eq!(
        checksum_path(&runtime_home.join(rel_path)).expect("hydrated checksum"),
        sha_v2
    );
    let state = load_agent_seed_state(&runtime_home).expect("load seed state");
    assert_eq!(state.artifacts[0].seed_version, "seed-v2");
    assert_eq!(state.artifacts[0].owner, AgentSeedArtifactOwner::Seed);

    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(staging_v1);
    let _ = fs::remove_dir_all(staging_v2);
}

#[test]
fn validate_relative_path_rejects_traversal() {
    let error = validate_relative_path("../evil").expect_err("expected traversal rejection");
    assert!(matches!(error, SeedError::InvalidArchive(_)));
}

#[test]
fn validate_archive_link_target_allows_in_tree_parent_segments() {
    validate_archive_link_target(
        Path::new("agents/claude/agent_process/node_modules/.bin/claude-agent-acp"),
        Path::new("../@agentclientprotocol/claude-agent-acp/dist/index.js"),
    )
    .expect("expected in-tree npm bin symlink to pass");
}

#[test]
fn validate_archive_link_target_rejects_escaping_parent_segments() {
    let error = validate_archive_link_target(
        Path::new("agents/claude/agent_process/node_modules/.bin/claude-agent-acp"),
        Path::new("../../../../../../evil"),
    )
    .expect_err("expected escaping symlink rejection");
    assert!(matches!(error, SeedError::InvalidArchive(_)));
}

#[test]
fn validate_manifest_rejects_unsupported_target() {
    let manifest = AgentSeedManifest {
        schema_version: MANIFEST_SCHEMA_VERSION,
        seed_version: "seed-v1".into(),
        target: "other-target".into(),
        seeded_agents: Vec::new(),
        artifacts: Vec::new(),
    };
    let error = validate_manifest(&manifest, "test-target").expect_err("expected target error");
    assert!(matches!(error, SeedError::UnsupportedTarget));
}
