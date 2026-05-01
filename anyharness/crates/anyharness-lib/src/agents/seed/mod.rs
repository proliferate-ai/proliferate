mod archive;
mod health;
mod quarantine;
#[cfg(test)]
mod tests;
mod types;

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use anyharness_contract::v1::{
    AgentSeedFailureKind, AgentSeedHealth, AgentSeedLastAction, AgentSeedOwnership,
    AgentSeedSource, AgentSeedStatus,
};
use uuid::Uuid;

use super::install_lock::AgentInstallLock;
use super::installer::{self, is_valid_executable, InstalledArtifactResult};
use super::model::{AgentKind, ArtifactRole, Platform};
#[cfg(test)]
use archive::validate_archive_link_target;
use archive::{
    checksum_path, extract_archive_securely, read_manifest_from_archive, validate_manifest,
    validate_relative_path, verify_archive_checksum, verify_seed_executables,
};
use health::{
    failed_health, health_from_state, missing_bundled_seed_health, not_configured_dev_health,
};
use quarantine::strip_quarantine_best_effort;
#[cfg(test)]
use types::AgentSeedManifestArtifact;
use types::{
    AgentSeedArtifactOwner, AgentSeedArtifactRecord, AgentSeedManifest, AgentSeedState, SeedError,
};

const STATE_SCHEMA_VERSION: u32 = 1;
const MANIFEST_SCHEMA_VERSION: u32 = 1;
const STATE_REL_PATH: &str = "agent-seed/state.json";
const SEED_DIR_ENV: &str = "ANYHARNESS_AGENT_SEED_DIR";
const SEED_EXPECTED_ENV: &str = "ANYHARNESS_AGENT_SEED_EXPECTED";
const UNSAFE_EXTERNAL_SEED_ENV: &str = "ANYHARNESS_AGENT_SEED_DIR_UNSAFE";

#[derive(Clone)]
pub struct AgentSeedStore {
    inner: Arc<RwLock<AgentSeedHealth>>,
}

impl AgentSeedStore {
    pub fn new(initial: AgentSeedHealth) -> Self {
        Self {
            inner: Arc::new(RwLock::new(initial)),
        }
    }

    pub fn not_configured_dev() -> Self {
        Self::new(not_configured_dev_health())
    }

    pub fn health(&self) -> AgentSeedHealth {
        self.inner
            .read()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| failed_health(AgentSeedFailureKind::Io, AgentSeedSource::None))
    }

    pub fn set_health(&self, health: AgentSeedHealth) {
        if let Ok(mut guard) = self.inner.write() {
            *guard = health;
        }
    }

    pub fn hydration_pending(&self) -> bool {
        self.health().status == AgentSeedStatus::Hydrating
    }

    pub fn refresh_from_state(&self, runtime_home: &Path) {
        let Ok(state) = load_agent_seed_state(runtime_home) else {
            return;
        };
        let current = self.health();
        self.set_health(health_from_state(&state, current.source));
    }
}

pub fn configured_agent_seed_store() -> AgentSeedStore {
    AgentSeedStore::new(configured_agent_seed_initial_health())
}

pub fn hydrate_configured_agent_seed(runtime_home: &Path, store: &AgentSeedStore) {
    let initial_health = configured_agent_seed_initial_health();
    if initial_health.status != AgentSeedStatus::Hydrating {
        store.set_health(initial_health);
        return;
    }

    let Some(target) = initial_health.target.clone() else {
        store.set_health(failed_health(
            AgentSeedFailureKind::UnsupportedTarget,
            AgentSeedSource::None,
        ));
        return;
    };
    let Some(seed_dir) = std::env::var_os(SEED_DIR_ENV).map(PathBuf::from) else {
        store.set_health(missing_bundled_seed_health(&target));
        return;
    };
    let source = initial_health.source.clone();

    store.set_health(initial_health);

    let result = hydrate_agent_seed(runtime_home, &seed_dir, &target, source.clone());
    match result {
        Ok(health) => store.set_health(health),
        Err(error) => {
            tracing::warn!(
                error = %error,
                runtime_home = %runtime_home.display(),
                seed_dir = %seed_dir.display(),
                "agent seed hydration failed"
            );
            store.set_health(failed_health(error.failure_kind(), source));
        }
    }
}

fn configured_agent_seed_initial_health() -> AgentSeedHealth {
    let Some(target) = Platform::current_target_triple() else {
        return failed_health(
            AgentSeedFailureKind::UnsupportedTarget,
            AgentSeedSource::None,
        );
    };

    let expected = env_truthy(SEED_EXPECTED_ENV);
    let seed_dir = std::env::var_os(SEED_DIR_ENV).map(PathBuf::from);
    let source = if expected {
        AgentSeedSource::Bundled
    } else if seed_dir.is_some() {
        AgentSeedSource::ExternalDev
    } else {
        AgentSeedSource::None
    };

    if seed_dir.is_none() {
        return if expected {
            missing_bundled_seed_health(target)
        } else {
            not_configured_dev_health()
        };
    }

    if !expected && !cfg!(debug_assertions) && !env_truthy(UNSAFE_EXTERNAL_SEED_ENV) {
        return failed_health(AgentSeedFailureKind::InvalidManifest, AgentSeedSource::None);
    }

    AgentSeedHealth {
        status: AgentSeedStatus::Hydrating,
        source,
        ownership: AgentSeedOwnership::NotConfigured,
        seed_version: None,
        target: Some(target.to_string()),
        seeded_agents: Vec::new(),
        last_action: AgentSeedLastAction::None,
        seed_owned_artifact_count: 0,
        skipped_existing_artifact_count: 0,
        repaired_artifact_count: 0,
        failure_kind: None,
    }
}

pub fn bundled_node_bin(runtime_home: &Path) -> Option<PathBuf> {
    let platform = Platform::detect()?;
    let candidate = runtime_home
        .join("node")
        .join(platform.target_triple())
        .join("bin")
        .join(platform.node_binary_name());
    is_valid_executable(&candidate).then_some(candidate)
}

pub fn bundled_node_bin_dir(runtime_home: &Path) -> Option<PathBuf> {
    bundled_node_bin(runtime_home).and_then(|path| path.parent().map(Path::to_path_buf))
}

pub fn mark_installed_artifacts_user_modified(
    runtime_home: &Path,
    kind: &AgentKind,
    installed: &[InstalledArtifactResult],
) {
    if installed.is_empty() {
        return;
    }

    let state_path = state_path(runtime_home);
    let Ok(mut state) = load_agent_seed_state(runtime_home) else {
        return;
    };

    let mut changed = false;
    for installed_artifact in installed {
        let role = role_name(&installed_artifact.role);
        for record in &mut state.artifacts {
            if record.kind == kind.as_str() && record.role == role {
                record.owner = AgentSeedArtifactOwner::UserModified;
                record.last_observed_checksum =
                    checksum_path(&runtime_home.join(&record.path)).ok();
                changed = true;
            }
        }
    }

    if changed {
        state.last_action = AgentSeedLastAction::None;
        if let Err(error) = save_agent_seed_state_path(&state_path, &state) {
            tracing::warn!(
                error = %error,
                runtime_home = %runtime_home.display(),
                agent = kind.as_str(),
                "failed to mark seed-owned agent artifacts as user modified"
            );
        }
    }
}

fn load_agent_seed_state(runtime_home: &Path) -> Result<AgentSeedState, std::io::Error> {
    let state_path = state_path(runtime_home);
    let raw = fs::read_to_string(state_path)?;
    serde_json::from_str(&raw).map_err(std::io::Error::other)
}

fn hydrate_agent_seed(
    runtime_home: &Path,
    seed_dir: &Path,
    target: &str,
    source: AgentSeedSource,
) -> Result<AgentSeedHealth, SeedError> {
    let archive_path = seed_dir.join(format!("agent-seed-{target}.tar.zst"));
    let checksum_path = seed_dir.join(format!("agent-seed-{target}.sha256"));
    if !archive_path.is_file() || !checksum_path.is_file() {
        return Err(SeedError::MissingArchive);
    }

    verify_archive_checksum(&archive_path, &checksum_path)?;
    let manifest = read_manifest_from_archive(&archive_path)?;
    validate_manifest(&manifest, target)?;

    let staging = runtime_home
        .join("agent-seed")
        .join(format!("staging-{}", Uuid::new_v4()));
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;

    let _node_lock = AgentInstallLock::acquire_node(runtime_home)?;
    let _claude_lock = AgentInstallLock::acquire_agent(runtime_home, &AgentKind::Claude)?;
    let _codex_lock = AgentInstallLock::acquire_agent(runtime_home, &AgentKind::Codex)?;

    let extract_result = (|| -> Result<AgentSeedHealth, SeedError> {
        extract_archive_securely(&archive_path, &staging)?;
        let health = apply_seed_payload(runtime_home, &staging, &manifest, source)?;
        strip_quarantine_best_effort(runtime_home);
        verify_seed_executables(runtime_home, &manifest)?;
        Ok(health)
    })();

    let _ = fs::remove_dir_all(&staging);
    extract_result
}

fn apply_seed_payload(
    runtime_home: &Path,
    staging: &Path,
    manifest: &AgentSeedManifest,
    source: AgentSeedSource,
) -> Result<AgentSeedHealth, SeedError> {
    let mut state = load_agent_seed_state(runtime_home).unwrap_or_else(|_| AgentSeedState {
        schema_version: STATE_SCHEMA_VERSION,
        seed_version: None,
        target: None,
        seeded_agents: Vec::new(),
        artifacts: Vec::new(),
        last_action: AgentSeedLastAction::None,
        repaired_artifact_count: 0,
        skipped_existing_artifact_count: 0,
    });

    let mut previous_records: HashMap<String, AgentSeedArtifactRecord> = state
        .artifacts
        .iter()
        .cloned()
        .map(|record| (record.path.clone(), record))
        .collect();
    let mut next_records = Vec::with_capacity(manifest.artifacts.len());
    let mut repaired = 0_u32;
    let mut skipped = 0_u32;
    let mut wrote = 0_u32;

    for artifact in &manifest.artifacts {
        let rel_path = validate_relative_path(&artifact.path)?;
        let src = staging.join(&rel_path);
        let dest = runtime_home.join(&rel_path);
        let existing_checksum = checksum_path(&dest).ok();
        let previous = previous_records.remove(&artifact.path);

        let mut owner = AgentSeedArtifactOwner::Seed;
        let should_write = match previous.as_ref().map(|record| &record.owner) {
            None => {
                if dest.exists() {
                    owner = AgentSeedArtifactOwner::UserExisting;
                    skipped += 1;
                    false
                } else {
                    true
                }
            }
            Some(AgentSeedArtifactOwner::Seed) => {
                if !dest.exists() {
                    repaired += 1;
                    true
                } else if existing_checksum.as_deref()
                    == previous
                        .as_ref()
                        .map(|record| record.seed_checksum.as_str())
                    && previous.as_ref().map(|record| record.seed_version.as_str())
                        != Some(manifest.seed_version.as_str())
                {
                    // The on-disk artifact still matches the prior seed, so the
                    // desktop-owned file is safe to replace with this new seed.
                    true
                } else if existing_checksum.as_deref()
                    == previous
                        .as_ref()
                        .map(|record| record.seed_checksum.as_str())
                {
                    false
                } else {
                    owner = AgentSeedArtifactOwner::UserModified;
                    skipped += 1;
                    false
                }
            }
            Some(AgentSeedArtifactOwner::UserExisting | AgentSeedArtifactOwner::UserModified) => {
                owner = previous
                    .as_ref()
                    .map(|record| record.owner.clone())
                    .unwrap_or(AgentSeedArtifactOwner::UserExisting);
                skipped += 1;
                false
            }
        };

        if should_write {
            copy_staged_artifact(&src, &dest)?;
            let checksum = checksum_path(&dest)?;
            if checksum != artifact.sha256 {
                return Err(SeedError::VerificationFailed(format!(
                    "{} checksum mismatch after copy",
                    artifact.path
                )));
            }
            wrote += 1;
        }

        let observed = checksum_path(&dest).ok();
        next_records.push(AgentSeedArtifactRecord {
            path: artifact.path.clone(),
            kind: artifact.kind.clone(),
            role: artifact.role.clone(),
            owner,
            seed_version: manifest.seed_version.clone(),
            seed_checksum: artifact.sha256.clone(),
            last_observed_checksum: observed,
        });
    }

    let launcher_agents = seed_owned_agent_process_agents(&manifest.seeded_agents, &next_records);
    installer::regenerate_seeded_agent_launchers(runtime_home, &launcher_agents)
        .map_err(|error| SeedError::VerificationFailed(error.to_string()))?;

    let seed_owned = next_records
        .iter()
        .filter(|record| record.owner == AgentSeedArtifactOwner::Seed)
        .count() as u32;
    let total = next_records.len() as u32;
    let ownership = if total == 0 {
        AgentSeedOwnership::NotConfigured
    } else if seed_owned == total {
        AgentSeedOwnership::FullSeed
    } else if seed_owned == 0 {
        AgentSeedOwnership::UserOwnedExisting
    } else {
        AgentSeedOwnership::PartialSeed
    };
    let status = match ownership {
        AgentSeedOwnership::FullSeed => AgentSeedStatus::Ready,
        AgentSeedOwnership::PartialSeed | AgentSeedOwnership::UserOwnedExisting => {
            AgentSeedStatus::Partial
        }
        AgentSeedOwnership::NotConfigured => AgentSeedStatus::Failed,
    };
    let last_action = if repaired > 0 {
        AgentSeedLastAction::Repaired
    } else if wrote > 0 {
        AgentSeedLastAction::Hydrated
    } else {
        AgentSeedLastAction::None
    };

    state.schema_version = STATE_SCHEMA_VERSION;
    state.seed_version = Some(manifest.seed_version.clone());
    state.target = Some(manifest.target.clone());
    state.seeded_agents = manifest.seeded_agents.clone();
    state.artifacts = next_records;
    state.last_action = last_action.clone();
    state.repaired_artifact_count = repaired;
    state.skipped_existing_artifact_count = skipped;
    save_agent_seed_state_path(&state_path(runtime_home), &state)?;

    Ok(AgentSeedHealth {
        status,
        source,
        ownership,
        seed_version: Some(manifest.seed_version.clone()),
        target: Some(manifest.target.clone()),
        seeded_agents: manifest.seeded_agents.clone(),
        last_action,
        seed_owned_artifact_count: seed_owned,
        skipped_existing_artifact_count: skipped,
        repaired_artifact_count: repaired,
        failure_kind: None,
    })
}

fn seed_owned_agent_process_agents(
    seeded_agents: &[String],
    records: &[AgentSeedArtifactRecord],
) -> Vec<String> {
    let agent_process_role = role_name(&ArtifactRole::AgentProcess);
    seeded_agents
        .iter()
        .filter(|agent| {
            // `seeded_agents` can list an agent with no agent-process records in
            // a malformed or future manifest. Skip those instead of regenerating
            // a launcher against a missing managed executable.
            let mut found = false;
            let all_seed_owned = records
                .iter()
                .filter(|record| record.kind == agent.as_str() && record.role == agent_process_role)
                .all(|record| {
                    found = true;
                    record.owner == AgentSeedArtifactOwner::Seed
                });
            found && all_seed_owned
        })
        .cloned()
        .collect()
}

fn copy_staged_artifact(src: &Path, dest: &Path) -> Result<(), SeedError> {
    let metadata = fs::symlink_metadata(src)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    if dest.exists() || fs::symlink_metadata(dest).is_ok() {
        fs::remove_file(dest)?;
    }

    if metadata.file_type().is_symlink() {
        let target = fs::read_link(src)?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, dest)?;
        #[cfg(windows)]
        return Err(SeedError::InvalidArchive(
            "symlink seed entries are not supported on Windows yet".into(),
        ));
    } else if metadata.is_file() {
        fs::copy(src, dest)?;
        fs::set_permissions(dest, metadata.permissions())?;
    } else {
        return Err(SeedError::InvalidArchive(format!(
            "unsupported staged artifact {}",
            src.display()
        )));
    }

    Ok(())
}

fn save_agent_seed_state_path(path: &Path, state: &AgentSeedState) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("json.{}.tmp", Uuid::new_v4()));
    let raw = serde_json::to_vec_pretty(state).map_err(std::io::Error::other)?;
    {
        let mut file = File::create(&temp)?;
        file.write_all(&raw)?;
        file.sync_all()?;
    }
    fs::rename(temp, path)?;
    Ok(())
}

fn state_path(runtime_home: &Path) -> PathBuf {
    runtime_home.join(STATE_REL_PATH)
}

fn role_name(role: &ArtifactRole) -> &'static str {
    match role {
        ArtifactRole::NativeCli => "native",
        ArtifactRole::AgentProcess => "agent_process",
    }
}

fn env_truthy(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}
