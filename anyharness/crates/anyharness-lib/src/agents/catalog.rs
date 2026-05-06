use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration as StdDuration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use anyharness_contract::v1::{
    WorkspaceSessionLaunchControl, WorkspaceSessionLaunchControlKey,
    WorkspaceSessionLaunchControlValue,
};

use crate::agents::model::{
    AgentDescriptor, AgentKind, AgentProcessArtifactSpec, AgentProcessFallback,
    AgentProcessInstallSpec, AuthSpec, CommandSpec, CredentialDiscoveryKind, LaunchSpecTemplate,
    LoginSpec, ModelCatalogStatus, ModelLaunchRemediationMetadata, ModelRegistryMetadata,
    ModelRegistryModelMetadata, NativeArtifactSpec, NativeInstallSpec, Platform,
    SessionDefaultControlKey, SessionDefaultControlMetadata, SessionDefaultControlValueMetadata,
    SessionDefaultControlsState,
};

const DEFAULT_REMOTE_AGENT_CATALOG_URL: &str = "https://api.proliferate.com/v1/catalogs/agents";
const MODEL_CATALOG_URL_ENV: &str = "ANYHARNESS_MODEL_CATALOG_URL";
const DISABLE_REMOTE_MODEL_CATALOG_ENV: &str = "ANYHARNESS_DISABLE_REMOTE_MODEL_CATALOG";
const ENABLE_CANDIDATE_MODELS_ENV: &str = "ANYHARNESS_MODEL_CATALOG_CANDIDATES";
const LAUNCH_CATALOG_URL_ENV: &str = "ANYHARNESS_LAUNCH_CATALOG_URL";
const DISABLE_REMOTE_LAUNCH_CATALOG_ENV: &str = "ANYHARNESS_DISABLE_REMOTE_LAUNCH_CATALOG";
const ENABLE_CANDIDATE_LAUNCH_CATALOG_ENV: &str = "ANYHARNESS_LAUNCH_CATALOG_CANDIDATES";
const AGENT_CATALOG_URL_ENV: &str = "ANYHARNESS_AGENT_CATALOG_URL";
const DISABLE_REMOTE_AGENT_CATALOG_ENV: &str = "ANYHARNESS_DISABLE_REMOTE_AGENT_CATALOG";
const CACHE_MAX_AGE_HOURS: i64 = 24;
const LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS: usize = 160;
const BUNDLED_AGENT_CATALOG: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../catalogs/agents/v1/catalog.json"
));
static CACHE_WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Returns the runtime-owned model registry catalog exposed by AnyHarness.
///
/// This is retained for tests and simple callers. Application code should use
/// [`ModelCatalogService`] so fresh remote/cached catalog rows can override the
/// bundled fallback.
pub fn model_registries() -> Vec<ModelRegistryMetadata> {
    effective_registries(bundled_model_registries(), false)
}

pub fn bundled_launch_catalog_agents() -> Vec<LaunchCatalogAgentMetadata> {
    let result = (|| -> anyhow::Result<Vec<LaunchCatalogAgentMetadata>> {
        let document = bundled_agent_catalog_document()?;
        validate_agent_catalog_document(&document)?;
        Ok(agent_catalog_to_launch_agents(&document, false)?)
    })();
    match result {
        Ok(agents) => agents,
        Err(error) => {
            tracing::debug!(error = %error, "using empty bundled launch catalog");
            vec![]
        }
    }
}

/// Returns built-in agent process/auth descriptors from the bundled agent
/// catalog. Remote catalogs are intentionally not trusted for process metadata.
pub fn bundled_agent_descriptors() -> Vec<AgentDescriptor> {
    match bundled_agent_catalog_document()
        .and_then(|catalog| agent_catalog_to_descriptors(&catalog))
    {
        Ok(descriptors) => descriptors,
        Err(error) => {
            tracing::error!(error = %error, "bundled agent catalog process descriptors are invalid");
            vec![]
        }
    }
}

#[derive(Debug, Clone)]
pub struct LaunchCatalogRuntimeSnapshot {
    pub catalog_version: String,
    pub agents: Vec<LaunchCatalogAgentMetadata>,
}

/// Service for resolving the effective launch catalog at runtime.
///
/// The launch catalog owns user-facing launch controls. It follows the same
/// network policy as the model catalog: remote refresh is background-only,
/// cached data must be fresh and compatible, and the bundled JSON remains the
/// final offline fallback.
#[derive(Debug, Clone)]
pub struct LaunchCatalogService {
    cache_path: PathBuf,
    remote_url: Option<String>,
    allow_candidates: bool,
}

impl LaunchCatalogService {
    pub fn new(runtime_home: PathBuf) -> Self {
        let remote_url = configured_launch_remote_url();
        let allow_candidates = env_flag_enabled(ENABLE_CANDIDATE_LAUNCH_CATALOG_ENV);
        Self::with_options(
            runtime_home
                .join("agent-catalog")
                .join("v1")
                .join("launch-catalog-cache.json"),
            remote_url,
            allow_candidates,
        )
    }

    fn with_options(
        cache_path: PathBuf,
        remote_url: Option<String>,
        allow_candidates: bool,
    ) -> Self {
        Self {
            cache_path,
            remote_url,
            allow_candidates,
        }
    }

    pub fn snapshot(&self) -> LaunchCatalogRuntimeSnapshot {
        match self.cached_remote_snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                tracing::debug!(error = %error, "using bundled launch catalog");
                self.bundled_snapshot()
            }
        }
    }

    pub fn agents(&self) -> Vec<LaunchCatalogAgentMetadata> {
        self.snapshot().agents
    }

    pub fn bundled_agents(&self) -> Vec<LaunchCatalogAgentMetadata> {
        self.bundled_snapshot().agents
    }

    pub fn bundled_snapshot(&self) -> LaunchCatalogRuntimeSnapshot {
        bundled_agent_catalog_document()
            .and_then(|catalog| {
                effective_launch_catalog_snapshot_from_agent_catalog(catalog, self.allow_candidates)
            })
            .unwrap_or_else(|error| {
                tracing::debug!(error = %error, "using empty bundled launch catalog");
                LaunchCatalogRuntimeSnapshot {
                    catalog_version: "bundled-invalid".to_string(),
                    agents: vec![],
                }
            })
    }

    pub fn spawn_refresh(self: &Arc<Self>) {
        if self.remote_url.is_none() {
            return;
        }

        let service = Arc::clone(self);
        tokio::spawn(async move {
            if let Err(error) = service.refresh_remote_catalog().await {
                tracing::debug!(error = %error, "remote launch catalog refresh failed");
            }
        });
    }

    pub async fn refresh_remote_catalog(&self) -> anyhow::Result<()> {
        let url = self
            .remote_url
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("remote launch catalog is disabled"))?;
        let client = reqwest::Client::builder()
            .timeout(StdDuration::from_secs(5))
            .build()?;
        let raw = client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        let catalog: AgentCatalogDocument = serde_json::from_str(&raw)?;
        validate_agent_catalog_document(&catalog)?;
        let snapshot = effective_launch_catalog_snapshot_from_agent_catalog(
            catalog.clone(),
            self.allow_candidates,
        )?;
        if snapshot.agents.is_empty() {
            anyhow::bail!("remote agent catalog has no selectable launch agents");
        }

        let cached = CachedAgentCatalog {
            fetched_at: Utc::now().to_rfc3339(),
            catalog,
        };
        write_agent_cache_file(&self.cache_path, &cached)?;
        Ok(())
    }

    fn cached_remote_snapshot(&self) -> anyhow::Result<LaunchCatalogRuntimeSnapshot> {
        let raw = fs::read_to_string(&self.cache_path)?;
        if let Ok(cached) = serde_json::from_str::<CachedAgentCatalog>(&raw) {
            let fetched_at = DateTime::parse_from_rfc3339(&cached.fetched_at)?.with_timezone(&Utc);
            let age = Utc::now().signed_duration_since(fetched_at);
            if age > Duration::hours(CACHE_MAX_AGE_HOURS) {
                anyhow::bail!("cached remote agent catalog is stale");
            }

            let snapshot = effective_launch_catalog_snapshot_from_agent_catalog(
                cached.catalog,
                self.allow_candidates,
            )?;
            if snapshot.agents.is_empty() {
                anyhow::bail!("cached remote agent catalog has no selectable launch agents");
            }
            return Ok(snapshot);
        }

        let cached: CachedLaunchCatalog = serde_json::from_str(&raw)?;
        let fetched_at = DateTime::parse_from_rfc3339(&cached.fetched_at)?.with_timezone(&Utc);
        let age = Utc::now().signed_duration_since(fetched_at);
        if age > Duration::hours(CACHE_MAX_AGE_HOURS) {
            anyhow::bail!("cached remote launch catalog is stale");
        }

        let snapshot = effective_launch_catalog_snapshot(cached.catalog, self.allow_candidates)?;
        if snapshot.agents.is_empty() {
            anyhow::bail!("cached remote launch catalog has no selectable agents");
        }
        Ok(snapshot)
    }
}

/// Service for resolving the effective model catalog at runtime.
///
/// The service never blocks launch on network access. It reads a fresh cached
/// remote catalog when available, otherwise falls back to the bundled catalog.
#[derive(Debug, Clone)]
pub struct ModelCatalogService {
    cache_path: PathBuf,
    remote_url: Option<String>,
    allow_candidates: bool,
}

impl ModelCatalogService {
    pub fn new(runtime_home: PathBuf) -> Self {
        let remote_url = configured_remote_url();
        let allow_candidates = env_flag_enabled(ENABLE_CANDIDATE_MODELS_ENV);
        Self::with_options(
            runtime_home
                .join("agent-catalog")
                .join("v1")
                .join("model-catalog-cache.json"),
            remote_url,
            allow_candidates,
        )
    }

    fn with_options(
        cache_path: PathBuf,
        remote_url: Option<String>,
        allow_candidates: bool,
    ) -> Self {
        Self {
            cache_path,
            remote_url,
            allow_candidates,
        }
    }

    pub fn registries(&self) -> Vec<ModelRegistryMetadata> {
        match self.cached_remote_registries() {
            Ok(registries) => registries,
            Err(error) => {
                tracing::debug!(error = %error, "using bundled model catalog");
                self.bundled_registries()
            }
        }
    }

    pub fn registry(&self, kind: &str) -> Option<ModelRegistryMetadata> {
        self.registries()
            .into_iter()
            .find(|registry| registry.kind == kind)
    }

    pub fn bundled_registries(&self) -> Vec<ModelRegistryMetadata> {
        match bundled_agent_catalog_document()
            .and_then(|catalog| registries_from_agent_catalog(&catalog, self.allow_candidates))
        {
            Ok(registries) => registries,
            Err(error) => {
                tracing::debug!(error = %error, "using empty bundled model catalog");
                vec![]
            }
        }
    }

    pub fn spawn_refresh(self: &Arc<Self>) {
        if self.remote_url.is_none() {
            return;
        }

        let service = Arc::clone(self);
        tokio::spawn(async move {
            if let Err(error) = service.refresh_remote_catalog().await {
                tracing::debug!(error = %error, "remote model catalog refresh failed");
            }
        });
    }

    pub async fn refresh_remote_catalog(&self) -> anyhow::Result<()> {
        let url = self
            .remote_url
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("remote model catalog is disabled"))?;
        let client = reqwest::Client::builder()
            .timeout(StdDuration::from_secs(5))
            .build()?;
        let raw = client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        if let Ok(catalog) = serde_json::from_str::<AgentCatalogDocument>(&raw) {
            validate_agent_catalog_document(&catalog)?;
            let registries = registries_from_agent_catalog(&catalog, self.allow_candidates)?;
            if registries.is_empty() {
                anyhow::bail!("remote agent catalog has no selectable registries");
            }

            let cached = CachedAgentCatalog {
                fetched_at: Utc::now().to_rfc3339(),
                catalog,
            };
            write_agent_cache_file(&self.cache_path, &cached)?;
            return Ok(());
        }

        let catalog: ModelCatalogDocument = serde_json::from_str(&raw)?;
        let registries =
            effective_remote_registries_from_document(&catalog, self.allow_candidates)?;
        if registries.is_empty() {
            anyhow::bail!("remote model catalog has no selectable registries");
        }

        let cached = CachedModelCatalog {
            fetched_at: Utc::now().to_rfc3339(),
            catalog,
        };
        write_cache_file(&self.cache_path, &cached)?;
        Ok(())
    }

    fn cached_remote_registries(&self) -> anyhow::Result<Vec<ModelRegistryMetadata>> {
        let raw = fs::read_to_string(&self.cache_path)?;
        if let Ok(cached) = serde_json::from_str::<CachedAgentCatalog>(&raw) {
            let fetched_at = DateTime::parse_from_rfc3339(&cached.fetched_at)?.with_timezone(&Utc);
            let age = Utc::now().signed_duration_since(fetched_at);
            if age > Duration::hours(CACHE_MAX_AGE_HOURS) {
                anyhow::bail!("cached remote agent catalog is stale");
            }

            let registries = registries_from_agent_catalog(&cached.catalog, self.allow_candidates)?;
            if registries.is_empty() {
                anyhow::bail!("cached remote agent catalog has no selectable registries");
            }
            return Ok(registries);
        }

        let cached: CachedModelCatalog = serde_json::from_str(&raw)?;
        let fetched_at = DateTime::parse_from_rfc3339(&cached.fetched_at)?.with_timezone(&Utc);
        let age = Utc::now().signed_duration_since(fetched_at);
        if age > Duration::hours(CACHE_MAX_AGE_HOURS) {
            anyhow::bail!("cached remote model catalog is stale");
        }

        let remote_registries = raw_registries_from_document(&cached.catalog)?;
        let registries = effective_registries(
            merge_catalog_registries(remote_registries, bundled_model_registries()),
            self.allow_candidates,
        );
        if registries.is_empty() {
            anyhow::bail!("cached remote model catalog has no selectable registries");
        }
        Ok(registries)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedModelCatalog {
    fetched_at: String,
    catalog: ModelCatalogDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedLaunchCatalog {
    fetched_at: String,
    catalog: LaunchCatalogDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedAgentCatalog {
    fetched_at: String,
    catalog: AgentCatalogDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogDocument {
    pub schema_version: u32,
    pub catalog_version: String,
    pub generated_at: String,
    #[serde(default)]
    pub agents: Vec<AgentCatalogAgent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAgent {
    pub kind: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub process: AgentCatalogProcess,
    pub session: AgentCatalogSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogSession {
    pub default_model_id: String,
    #[serde(default)]
    pub default_mode_id: Option<String>,
    #[serde(default)]
    pub models: Vec<AgentCatalogModel>,
    #[serde(default)]
    pub controls: Vec<AgentCatalogControl>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogModel {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub status: ModelCatalogStatus,
    pub is_default: bool,
    #[serde(default)]
    pub min_runtime_version: Option<String>,
    #[serde(default)]
    pub launch_remediation: Option<ModelLaunchRemediationMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogControl {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub control_type: String,
    #[serde(default)]
    pub default_value: Option<String>,
    #[serde(default)]
    pub values: Vec<AgentCatalogControlValue>,
    #[serde(default)]
    pub surfaces: AgentCatalogControlSurfaces,
    #[serde(default)]
    pub apply: AgentCatalogControlApply,
    #[serde(default)]
    pub value_source: String,
    #[serde(default)]
    pub missing_live_config_policy: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogControlSurfaces {
    #[serde(default)]
    pub start: bool,
    #[serde(default)]
    pub session: bool,
    #[serde(default)]
    pub automation: bool,
    #[serde(default)]
    pub settings: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogControlApply {
    #[serde(default)]
    pub create_field: Option<String>,
    #[serde(default)]
    pub live_config_id: Option<String>,
    #[serde(default)]
    pub live_setter: Option<String>,
    #[serde(default)]
    pub queue_before_materialized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogControlValue {
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogProcess {
    #[serde(default)]
    pub native: Option<AgentCatalogNativeArtifact>,
    pub agent_process: AgentCatalogAgentProcessArtifact,
    pub launch: AgentCatalogLaunch,
    pub auth: AgentCatalogAuth,
    #[serde(default)]
    pub docs_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogNativeArtifact {
    pub install: AgentCatalogNativeInstall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAgentProcessArtifact {
    pub install: AgentCatalogAgentProcessInstall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum AgentCatalogNativeInstall {
    #[serde(rename = "direct_binary")]
    DirectBinary {
        #[serde(default)]
        latest_version_url: Option<String>,
        binary_url_template: String,
        platform_map: HashMap<String, String>,
    },
    #[serde(rename = "tarball_release")]
    TarballRelease {
        latest_url_template: String,
        versioned_url_template: String,
        expected_binary_template: String,
        platform_map: HashMap<String, String>,
    },
    #[serde(rename = "path_only")]
    PathOnly {
        candidate_binaries: Vec<String>,
        #[serde(default)]
        docs_url: Option<String>,
    },
    #[serde(rename = "manual")]
    Manual { docs_url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum AgentCatalogAgentProcessInstall {
    #[serde(rename = "registry_backed")]
    RegistryBacked {
        registry_id: String,
        fallback: AgentCatalogAgentProcessFallback,
    },
    #[serde(rename = "managed_npm_package")]
    ManagedNpmPackage {
        package: String,
        #[serde(default)]
        package_subdir: Option<PathBuf>,
        #[serde(default)]
        source_build_binary_name: Option<String>,
        executable_relpath: PathBuf,
    },
    #[serde(rename = "path_only")]
    PathOnly {
        candidate_binaries: Vec<String>,
        #[serde(default)]
        default_args: Vec<String>,
        #[serde(default)]
        docs_url: Option<String>,
    },
    #[serde(rename = "manual")]
    Manual { docs_url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum AgentCatalogAgentProcessFallback {
    #[serde(rename = "npm_package")]
    NpmPackage {
        package: String,
        #[serde(default)]
        package_subdir: Option<PathBuf>,
        #[serde(default)]
        source_build_binary_name: Option<String>,
        executable_relpath: PathBuf,
    },
    #[serde(rename = "native_subcommand")]
    NativeSubcommand { args: Vec<String> },
    #[serde(rename = "binary_hint")]
    BinaryHint {
        candidate_binaries: Vec<String>,
        args: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogLaunch {
    pub executable_name: String,
    #[serde(default)]
    pub default_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAuth {
    #[serde(default)]
    pub env_vars: Vec<String>,
    #[serde(default)]
    pub login: Option<AgentCatalogLogin>,
    pub discovery: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogLogin {
    pub label: String,
    pub command: AgentCatalogCommand,
    pub reuses_user_state: bool,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogCommand {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelCatalogDocument {
    catalog_version: String,
    generated_at: String,
    providers: Vec<ModelCatalogProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelCatalogProvider {
    kind: String,
    display_name: String,
    default_model_id: Option<String>,
    models: Vec<ModelCatalogModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelCatalogModel {
    id: String,
    display_name: String,
    description: Option<String>,
    is_default: bool,
    status: ModelCatalogStatus,
    #[serde(default)]
    aliases: Vec<String>,
    min_runtime_version: Option<String>,
    launch_remediation: Option<ModelLaunchRemediationMetadata>,
    #[serde(
        default,
        skip_serializing_if = "RawSessionDefaultControlsState::is_omitted"
    )]
    session_default_controls: RawSessionDefaultControlsState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCatalogDocument {
    pub schema_version: u32,
    pub catalog_version: String,
    pub generated_at: String,
    pub agents: Vec<LaunchCatalogAgentMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCatalogAgentMetadata {
    pub kind: String,
    pub display_name: String,
    pub default_model_id: String,
    #[serde(default)]
    pub launch_controls: Vec<WorkspaceSessionLaunchControl>,
    pub models: Vec<LaunchCatalogModelMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCatalogModelMetadata {
    pub id: String,
    #[serde(default)]
    pub status: Option<ModelCatalogStatus>,
    #[serde(default)]
    pub launch_controls: Vec<WorkspaceSessionLaunchControl>,
}

#[derive(Debug, Clone, Default)]
enum RawSessionDefaultControlsState {
    #[default]
    Omitted,
    Present(Vec<serde_json::Value>),
}

impl RawSessionDefaultControlsState {
    fn is_omitted(&self) -> bool {
        matches!(self, Self::Omitted)
    }
}

impl<'de> Deserialize<'de> for RawSessionDefaultControlsState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Vec::<serde_json::Value>::deserialize(deserializer).map(Self::Present)
    }
}

impl Serialize for RawSessionDefaultControlsState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Omitted => serializer.serialize_none(),
            Self::Present(values) => values.serialize(serializer),
        }
    }
}

fn configured_remote_url() -> Option<String> {
    if env_flag_enabled(DISABLE_REMOTE_AGENT_CATALOG_ENV)
        || env_flag_enabled(DISABLE_REMOTE_MODEL_CATALOG_ENV)
    {
        return None;
    }

    let configured = std::env::var(AGENT_CATALOG_URL_ENV)
        .or_else(|_| std::env::var(MODEL_CATALOG_URL_ENV))
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    match configured.as_deref() {
        Some("off") | Some("disabled") | Some("none") => None,
        Some(url) => Some(url.to_string()),
        None => Some(DEFAULT_REMOTE_AGENT_CATALOG_URL.to_string()),
    }
}

fn configured_launch_remote_url() -> Option<String> {
    if env_flag_enabled(DISABLE_REMOTE_AGENT_CATALOG_ENV)
        || env_flag_enabled(DISABLE_REMOTE_LAUNCH_CATALOG_ENV)
    {
        return None;
    }

    let configured = std::env::var(AGENT_CATALOG_URL_ENV)
        .or_else(|_| std::env::var(LAUNCH_CATALOG_URL_ENV))
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    match configured.as_deref() {
        Some("off") | Some("disabled") | Some("none") => None,
        Some(url) => Some(url.to_string()),
        None => Some(DEFAULT_REMOTE_AGENT_CATALOG_URL.to_string()),
    }
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
}

fn write_cache_file(path: &Path, cached: &CachedModelCatalog) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = unique_cache_tmp_path(path);
    fs::write(&tmp_path, serde_json::to_vec_pretty(cached)?)?;
    replace_cache_file(&tmp_path, path)?;
    Ok(())
}

#[cfg(test)]
fn write_launch_cache_file(path: &Path, cached: &CachedLaunchCatalog) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = unique_cache_tmp_path(path);
    fs::write(&tmp_path, serde_json::to_vec_pretty(cached)?)?;
    replace_cache_file(&tmp_path, path)?;
    Ok(())
}

fn write_agent_cache_file(path: &Path, cached: &CachedAgentCatalog) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = unique_cache_tmp_path(path);
    fs::write(&tmp_path, serde_json::to_vec_pretty(cached)?)?;
    replace_cache_file(&tmp_path, path)?;
    Ok(())
}

fn unique_cache_tmp_path(path: &Path) -> PathBuf {
    let counter = CACHE_WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("catalog-cache");
    path.with_file_name(format!(
        "{file_name}.{}.{}.{}.tmp",
        std::process::id(),
        nanos,
        counter
    ))
}

fn replace_cache_file(tmp_path: &Path, path: &Path) -> anyhow::Result<()> {
    if let Err(error) = fs::remove_file(path) {
        if error.kind() != io::ErrorKind::NotFound {
            let _ = fs::remove_file(tmp_path);
            return Err(error.into());
        }
    }
    if let Err(error) = fs::rename(tmp_path, path) {
        let _ = fs::remove_file(tmp_path);
        return Err(error.into());
    }
    Ok(())
}

fn bundled_agent_catalog_document() -> anyhow::Result<AgentCatalogDocument> {
    let catalog: AgentCatalogDocument = serde_json::from_str(BUNDLED_AGENT_CATALOG)?;
    validate_agent_catalog_document(&catalog)?;
    Ok(catalog)
}

fn validate_agent_catalog_document(catalog: &AgentCatalogDocument) -> anyhow::Result<()> {
    if catalog.schema_version != 1 {
        anyhow::bail!("agent catalog schema version is not supported");
    }
    if catalog.catalog_version.trim().is_empty() {
        anyhow::bail!("agent catalog version is empty");
    }
    DateTime::parse_from_rfc3339(&catalog.generated_at)?;
    if catalog.agents.is_empty() {
        anyhow::bail!("agent catalog has no agents");
    }
    let mut seen_agents = HashSet::new();
    for agent in &catalog.agents {
        validate_agent_catalog_agent(agent, &mut seen_agents)?;
    }
    Ok(())
}

fn validate_agent_catalog_agent(
    agent: &AgentCatalogAgent,
    seen_agents: &mut HashSet<String>,
) -> anyhow::Result<()> {
    if AgentKind::parse(agent.kind.as_str()).is_none() {
        anyhow::bail!("agent catalog agent '{}' is not supported", agent.kind);
    }
    if !seen_agents.insert(agent.kind.clone()) {
        anyhow::bail!("agent catalog agent '{}' is duplicated", agent.kind);
    }
    if agent.display_name.trim().is_empty() {
        anyhow::bail!("agent catalog agent '{}' display name is empty", agent.kind);
    }
    if agent.session.models.is_empty() {
        anyhow::bail!("agent catalog agent '{}' has no models", agent.kind);
    }
    if agent.session.default_model_id.trim().is_empty() {
        anyhow::bail!(
            "agent catalog agent '{}' default model is empty",
            agent.kind
        );
    }
    let mut seen_model_values = HashSet::new();
    let mut default_count = 0;
    for model in &agent.session.models {
        if model.id.trim().is_empty() {
            anyhow::bail!("agent catalog agent '{}' has empty model id", agent.kind);
        }
        if !seen_model_values.insert(model.id.clone()) {
            anyhow::bail!(
                "agent catalog agent '{}' model '{}' is duplicated",
                agent.kind,
                model.id
            );
        }
        for alias in &model.aliases {
            if !seen_model_values.insert(alias.clone()) {
                anyhow::bail!(
                    "agent catalog agent '{}' model alias '{}' collides",
                    agent.kind,
                    alias
                );
            }
        }
        if let Some(remediation) = &model.launch_remediation {
            if model.status != ModelCatalogStatus::Active {
                anyhow::bail!(
                    "agent catalog agent '{}' model '{}' has launch remediation but is not active",
                    agent.kind,
                    model.id
                );
            }
            let message = remediation.message.trim();
            if message.is_empty() {
                anyhow::bail!(
                    "agent catalog agent '{}' model '{}' launch remediation message is empty",
                    agent.kind,
                    model.id
                );
            }
            if message.chars().count() > LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS {
                anyhow::bail!(
                    "agent catalog agent '{}' model '{}' launch remediation message is too long",
                    agent.kind,
                    model.id
                );
            }
        }
        if model.is_default {
            default_count += 1;
            if model.id != agent.session.default_model_id {
                anyhow::bail!(
                    "agent catalog agent '{}' default model '{}' does not match defaultModelId '{}'",
                    agent.kind,
                    model.id,
                    agent.session.default_model_id
                );
            }
        }
    }
    if default_count != 1 {
        anyhow::bail!(
            "agent catalog agent '{}' must have exactly one default model",
            agent.kind
        );
    }
    if !agent
        .session
        .models
        .iter()
        .any(|model| model.id == agent.session.default_model_id)
    {
        anyhow::bail!(
            "agent catalog agent '{}' defaultModelId '{}' is not in models",
            agent.kind,
            agent.session.default_model_id
        );
    }
    let mut seen_controls = HashSet::new();
    for control in &agent.session.controls {
        validate_agent_catalog_control(&agent.kind, control, &mut seen_controls)?;
    }
    Ok(())
}

fn validate_agent_catalog_control(
    agent_kind: &str,
    control: &AgentCatalogControl,
    seen_controls: &mut HashSet<String>,
) -> anyhow::Result<()> {
    if !seen_controls.insert(control.key.clone()) {
        anyhow::bail!(
            "agent catalog agent '{}' control '{}' is duplicated",
            agent_kind,
            control.key
        );
    }
    if control.label.trim().is_empty() {
        anyhow::bail!(
            "agent catalog agent '{}' control '{}' label is empty",
            agent_kind,
            control.key
        );
    }
    if control.control_type != "select" {
        anyhow::bail!(
            "agent catalog agent '{}' control '{}' has unsupported type '{}'",
            agent_kind,
            control.key,
            control.control_type
        );
    }
    if !matches!(
        control.missing_live_config_policy.as_str(),
        "ignore_default" | "queue_then_conflict" | "block_prompt" | "remediate"
    ) {
        anyhow::bail!(
            "agent catalog agent '{}' control '{}' has unsupported missingLiveConfigPolicy '{}'",
            agent_kind,
            control.key,
            control.missing_live_config_policy
        );
    }
    if let Some(create_field) = control.apply.create_field.as_deref() {
        if !supported_agent_catalog_create_field(&control.key, create_field) {
            anyhow::bail!(
                "agent catalog agent '{}' control '{}' has unsupported createField '{}'",
                agent_kind,
                control.key,
                create_field
            );
        }
    }
    if control.value_source == "inline" {
        if control.values.is_empty() {
            anyhow::bail!(
                "agent catalog agent '{}' inline control '{}' has no values",
                agent_kind,
                control.key
            );
        }
        let value_ids: HashSet<&str> = control
            .values
            .iter()
            .map(|value| value.value.as_str())
            .collect();
        if let Some(default_value) = control.default_value.as_deref() {
            if !value_ids.contains(default_value) {
                anyhow::bail!(
                    "agent catalog agent '{}' inline control '{}' default '{}' is not a value",
                    agent_kind,
                    control.key,
                    default_value
                );
            }
        }
    }
    Ok(())
}

fn supported_agent_catalog_create_field(control_key: &str, create_field: &str) -> bool {
    matches!(
        (control_key, create_field),
        ("model", "modelId") | ("mode", "modeId")
    )
}

fn agent_catalog_to_descriptors(
    catalog: &AgentCatalogDocument,
) -> anyhow::Result<Vec<AgentDescriptor>> {
    // Trust boundary: process/install/auth descriptors may only be materialized
    // from the bundled catalog. Remote catalog refresh paths intentionally use
    // the session/model adapters below and must not call this conversion.
    validate_agent_catalog_document(catalog)?;
    catalog
        .agents
        .iter()
        .map(agent_catalog_agent_to_descriptor)
        .collect()
}

fn agent_catalog_agent_to_descriptor(agent: &AgentCatalogAgent) -> anyhow::Result<AgentDescriptor> {
    let kind = AgentKind::parse(agent.kind.as_str())
        .ok_or_else(|| anyhow::anyhow!("unsupported agent kind '{}'", agent.kind))?;
    Ok(AgentDescriptor {
        kind,
        native: agent
            .process
            .native
            .as_ref()
            .map(agent_catalog_native_to_spec)
            .transpose()?,
        agent_process: AgentProcessArtifactSpec {
            install: agent_catalog_agent_process_install_to_spec(
                &agent.process.agent_process.install,
            )?,
        },
        launch: LaunchSpecTemplate {
            executable_name: agent.process.launch.executable_name.clone(),
            default_args: agent.process.launch.default_args.clone(),
        },
        auth: AuthSpec {
            env_vars: agent.process.auth.env_vars.clone(),
            login: agent.process.auth.login.as_ref().map(|login| LoginSpec {
                label: login.label.clone(),
                command: CommandSpec {
                    program: login.command.program.clone(),
                    args: login.command.args.clone(),
                },
                reuses_user_state: login.reuses_user_state,
                message: login.message.clone(),
            }),
            discovery: parse_credential_discovery(agent.process.auth.discovery.as_str())?,
        },
        docs_url: agent.process.docs_url.clone(),
    })
}

fn agent_catalog_native_to_spec(
    artifact: &AgentCatalogNativeArtifact,
) -> anyhow::Result<NativeArtifactSpec> {
    let install = match &artifact.install {
        AgentCatalogNativeInstall::DirectBinary {
            latest_version_url,
            binary_url_template,
            platform_map,
        } => NativeInstallSpec::DirectBinary {
            latest_version_url: latest_version_url.clone(),
            binary_url_template: binary_url_template.clone(),
            platform_map: parse_platform_map(platform_map)?,
        },
        AgentCatalogNativeInstall::TarballRelease {
            latest_url_template,
            versioned_url_template,
            expected_binary_template,
            platform_map,
        } => NativeInstallSpec::TarballRelease {
            latest_url_template: latest_url_template.clone(),
            versioned_url_template: versioned_url_template.clone(),
            expected_binary_template: expected_binary_template.clone(),
            platform_map: parse_platform_map(platform_map)?,
        },
        AgentCatalogNativeInstall::PathOnly {
            candidate_binaries,
            docs_url,
        } => NativeInstallSpec::PathOnly {
            candidate_binaries: candidate_binaries.clone(),
            docs_url: docs_url.clone(),
        },
        AgentCatalogNativeInstall::Manual { docs_url } => NativeInstallSpec::Manual {
            docs_url: docs_url.clone(),
        },
    };
    Ok(NativeArtifactSpec { install })
}

fn agent_catalog_agent_process_install_to_spec(
    install: &AgentCatalogAgentProcessInstall,
) -> anyhow::Result<AgentProcessInstallSpec> {
    Ok(match install {
        AgentCatalogAgentProcessInstall::RegistryBacked {
            registry_id,
            fallback,
        } => AgentProcessInstallSpec::RegistryBacked {
            registry_id: registry_id.clone(),
            fallback: agent_catalog_fallback_to_spec(fallback),
        },
        AgentCatalogAgentProcessInstall::ManagedNpmPackage {
            package,
            package_subdir,
            source_build_binary_name,
            executable_relpath,
        } => AgentProcessInstallSpec::ManagedNpmPackage {
            package: package.clone(),
            package_subdir: package_subdir.clone(),
            source_build_binary_name: source_build_binary_name.clone(),
            executable_relpath: executable_relpath.clone(),
        },
        AgentCatalogAgentProcessInstall::PathOnly {
            candidate_binaries,
            default_args,
            docs_url,
        } => AgentProcessInstallSpec::PathOnly {
            candidate_binaries: candidate_binaries.clone(),
            default_args: default_args.clone(),
            docs_url: docs_url.clone(),
        },
        AgentCatalogAgentProcessInstall::Manual { docs_url } => AgentProcessInstallSpec::Manual {
            docs_url: docs_url.clone(),
        },
    })
}

fn agent_catalog_fallback_to_spec(
    fallback: &AgentCatalogAgentProcessFallback,
) -> AgentProcessFallback {
    match fallback {
        AgentCatalogAgentProcessFallback::NpmPackage {
            package,
            package_subdir,
            source_build_binary_name,
            executable_relpath,
        } => AgentProcessFallback::NpmPackage {
            package: package.clone(),
            package_subdir: package_subdir.clone(),
            source_build_binary_name: source_build_binary_name.clone(),
            executable_relpath: executable_relpath.clone(),
        },
        AgentCatalogAgentProcessFallback::NativeSubcommand { args } => {
            AgentProcessFallback::NativeSubcommand { args: args.clone() }
        }
        AgentCatalogAgentProcessFallback::BinaryHint {
            candidate_binaries,
            args,
        } => AgentProcessFallback::BinaryHint {
            candidate_binaries: candidate_binaries.clone(),
            args: args.clone(),
        },
    }
}

fn parse_platform_map(raw: &HashMap<String, String>) -> anyhow::Result<Vec<(Platform, String)>> {
    raw.iter()
        .map(|(key, value)| Ok((parse_platform(key)?, value.clone())))
        .collect()
}

fn parse_platform(value: &str) -> anyhow::Result<Platform> {
    match value {
        "macos_arm64" => Ok(Platform::MacosArm64),
        "macos_x64" => Ok(Platform::MacosX64),
        "linux_x64" => Ok(Platform::LinuxX64),
        "linux_arm64" => Ok(Platform::LinuxArm64),
        "windows_x64" => Ok(Platform::WindowsX64),
        "windows_arm64" => Ok(Platform::WindowsArm64),
        _ => anyhow::bail!("unsupported platform key '{value}'"),
    }
}

fn parse_credential_discovery(value: &str) -> anyhow::Result<CredentialDiscoveryKind> {
    match value {
        "none" => Ok(CredentialDiscoveryKind::None),
        "claude" => Ok(CredentialDiscoveryKind::Claude),
        "codex" => Ok(CredentialDiscoveryKind::Codex),
        "gemini" => Ok(CredentialDiscoveryKind::Gemini),
        "opencode" => Ok(CredentialDiscoveryKind::OpenCode),
        "cursor" => Ok(CredentialDiscoveryKind::Cursor),
        _ => anyhow::bail!("unsupported credential discovery '{value}'"),
    }
}

fn registries_from_agent_catalog(
    catalog: &AgentCatalogDocument,
    allow_candidates: bool,
) -> anyhow::Result<Vec<ModelRegistryMetadata>> {
    validate_agent_catalog_document(catalog)?;
    Ok(effective_registries(
        catalog
            .agents
            .iter()
            .map(agent_catalog_agent_to_registry)
            .collect::<anyhow::Result<Vec<_>>>()?,
        allow_candidates,
    ))
}

fn agent_catalog_agent_to_registry(
    agent: &AgentCatalogAgent,
) -> anyhow::Result<ModelRegistryMetadata> {
    let session_default_controls = session_default_controls_for_agent(agent)?;
    Ok(ModelRegistryMetadata {
        kind: agent.kind.clone(),
        display_name: agent.display_name.clone(),
        default_model_id: Some(agent.session.default_model_id.clone()),
        models: agent
            .session
            .models
            .iter()
            .map(|model| ModelRegistryModelMetadata {
                id: model.id.clone(),
                display_name: model.display_name.clone(),
                description: model.description.clone(),
                is_default: model.is_default,
                status: model.status,
                aliases: model.aliases.clone(),
                min_runtime_version: model.min_runtime_version.clone(),
                launch_remediation: model.launch_remediation.clone(),
                session_default_controls: session_default_controls.clone(),
                session_default_controls_state: if session_default_controls.is_empty() {
                    SessionDefaultControlsState::Empty
                } else {
                    SessionDefaultControlsState::Valid
                },
            })
            .collect(),
    })
}

fn session_default_controls_for_agent(
    agent: &AgentCatalogAgent,
) -> anyhow::Result<Vec<SessionDefaultControlMetadata>> {
    agent
        .session
        .controls
        .iter()
        .filter(|control| matches!(control.key.as_str(), "reasoning" | "effort" | "fast_mode"))
        .map(agent_catalog_control_to_session_default_control)
        .collect()
}

fn agent_catalog_control_to_session_default_control(
    control: &AgentCatalogControl,
) -> anyhow::Result<SessionDefaultControlMetadata> {
    let key = match control.key.as_str() {
        "reasoning" => SessionDefaultControlKey::Reasoning,
        "effort" => SessionDefaultControlKey::Effort,
        "fast_mode" => SessionDefaultControlKey::FastMode,
        _ => anyhow::bail!("unsupported session default control '{}'", control.key),
    };
    Ok(SessionDefaultControlMetadata {
        key,
        label: control.label.clone(),
        values: control
            .values
            .iter()
            .map(|value| SessionDefaultControlValueMetadata {
                value: value.value.clone(),
                label: value.label.clone(),
                description: value.description.clone(),
                is_default: value.is_default,
            })
            .collect(),
        default_value: control.default_value.clone(),
    })
}

fn effective_launch_catalog_snapshot_from_agent_catalog(
    catalog: AgentCatalogDocument,
    allow_candidates: bool,
) -> anyhow::Result<LaunchCatalogRuntimeSnapshot> {
    validate_agent_catalog_document(&catalog)?;
    let catalog_version = catalog.catalog_version.clone();
    let agents = agent_catalog_to_launch_agents(&catalog, allow_candidates)?;
    Ok(LaunchCatalogRuntimeSnapshot {
        catalog_version,
        agents,
    })
}

fn agent_catalog_to_launch_agents(
    catalog: &AgentCatalogDocument,
    allow_candidates: bool,
) -> anyhow::Result<Vec<LaunchCatalogAgentMetadata>> {
    catalog
        .agents
        .iter()
        .filter_map(
            |agent| match agent_catalog_agent_to_launch_agent(agent, allow_candidates) {
                Ok(Some(agent)) => Some(Ok(agent)),
                Ok(None) => None,
                Err(error) => Some(Err(error)),
            },
        )
        .collect()
}

fn agent_catalog_agent_to_launch_agent(
    agent: &AgentCatalogAgent,
    allow_candidates: bool,
) -> anyhow::Result<Option<LaunchCatalogAgentMetadata>> {
    let models = agent
        .session
        .models
        .iter()
        .filter(|model| allow_candidates || model.status != ModelCatalogStatus::Candidate)
        .map(|model| LaunchCatalogModelMetadata {
            id: model.id.clone(),
            status: Some(model.status),
            launch_controls: vec![],
        })
        .collect::<Vec<_>>();
    if models.is_empty() {
        return Ok(None);
    }
    Ok(Some(LaunchCatalogAgentMetadata {
        kind: agent.kind.clone(),
        display_name: agent.display_name.clone(),
        default_model_id: agent.session.default_model_id.clone(),
        launch_controls: agent
            .session
            .controls
            .iter()
            .filter_map(agent_catalog_control_to_launch_control)
            .collect(),
        models,
    }))
}

fn agent_catalog_control_to_launch_control(
    control: &AgentCatalogControl,
) -> Option<WorkspaceSessionLaunchControl> {
    let key = match control.key.as_str() {
        "mode" => WorkspaceSessionLaunchControlKey::Mode,
        "collaboration_mode" => WorkspaceSessionLaunchControlKey::CollaborationMode,
        "access_mode" => WorkspaceSessionLaunchControlKey::AccessMode,
        "reasoning" => WorkspaceSessionLaunchControlKey::Reasoning,
        "effort" => WorkspaceSessionLaunchControlKey::Effort,
        "fast_mode" => WorkspaceSessionLaunchControlKey::FastMode,
        "model" => return None,
        _ => return None,
    };
    let create_field = control
        .apply
        .create_field
        .as_ref()
        .filter(|field| supported_agent_catalog_create_field(&control.key, field))
        .cloned();
    let phase = if create_field.is_some() {
        anyharness_contract::v1::WorkspaceSessionLaunchControlPhase::CreateSession
    } else {
        anyharness_contract::v1::WorkspaceSessionLaunchControlPhase::LiveDefault
    };
    Some(WorkspaceSessionLaunchControl {
        key,
        label: control.label.clone(),
        control_type: control.control_type.clone(),
        default_value: control.default_value.clone(),
        values: control
            .values
            .iter()
            .map(|value| WorkspaceSessionLaunchControlValue {
                value: value.value.clone(),
                label: value.label.clone(),
                description: value.description.clone(),
                is_default: value.is_default,
            })
            .collect(),
        phase,
        create_field,
    })
}

#[cfg(test)]
fn effective_registries_from_document(
    catalog: &ModelCatalogDocument,
    allow_candidates: bool,
) -> anyhow::Result<Vec<ModelRegistryMetadata>> {
    Ok(effective_registries(
        raw_registries_from_document(catalog)?,
        allow_candidates,
    ))
}

fn effective_remote_registries_from_document(
    catalog: &ModelCatalogDocument,
    allow_candidates: bool,
) -> anyhow::Result<Vec<ModelRegistryMetadata>> {
    let remote_registries = raw_registries_from_document(catalog)?;
    Ok(effective_registries(
        merge_catalog_registries(remote_registries, bundled_model_registries()),
        allow_candidates,
    ))
}

fn effective_launch_catalog_snapshot(
    catalog: LaunchCatalogDocument,
    allow_candidates: bool,
) -> anyhow::Result<LaunchCatalogRuntimeSnapshot> {
    validate_launch_catalog_document(&catalog)?;
    let catalog_version = catalog.catalog_version.clone();
    let agents = catalog
        .agents
        .into_iter()
        .filter_map(|mut agent| {
            agent.models.retain(|model| {
                allow_candidates || model.status != Some(ModelCatalogStatus::Candidate)
            });
            if agent.models.is_empty() {
                None
            } else {
                Some(agent)
            }
        })
        .collect();
    Ok(LaunchCatalogRuntimeSnapshot {
        catalog_version,
        agents,
    })
}

fn raw_registries_from_document(
    catalog: &ModelCatalogDocument,
) -> anyhow::Result<Vec<ModelRegistryMetadata>> {
    if catalog.catalog_version.trim().is_empty() {
        anyhow::bail!("model catalog version is empty");
    }
    DateTime::parse_from_rfc3339(&catalog.generated_at)?;

    let mut seen_provider_kinds = HashSet::new();
    let mut registries = Vec::new();
    for provider in &catalog.providers {
        validate_provider(provider, &mut seen_provider_kinds)?;
        let registry = provider_to_registry(provider)?;
        registries.push(registry);
    }
    Ok(registries)
}

fn validate_launch_catalog_document(catalog: &LaunchCatalogDocument) -> anyhow::Result<()> {
    if catalog.schema_version != 1 {
        anyhow::bail!("launch catalog schema version is not supported");
    }
    if catalog.catalog_version.trim().is_empty() {
        anyhow::bail!("launch catalog version is empty");
    }
    DateTime::parse_from_rfc3339(&catalog.generated_at)?;
    if catalog.agents.is_empty() {
        anyhow::bail!("launch catalog has no agents");
    }
    let mut seen_agents = HashSet::new();
    for agent in &catalog.agents {
        if AgentKind::parse(agent.kind.as_str()).is_none() {
            anyhow::bail!("launch catalog agent '{}' is not supported", agent.kind);
        }
        if !seen_agents.insert(agent.kind.clone()) {
            anyhow::bail!("launch catalog agent '{}' is duplicated", agent.kind);
        }
        if agent.display_name.trim().is_empty() {
            anyhow::bail!(
                "launch catalog agent '{}' display name is empty",
                agent.kind
            );
        }
        if agent.default_model_id.trim().is_empty() {
            anyhow::bail!(
                "launch catalog agent '{}' default model is empty",
                agent.kind
            );
        }
        if agent.models.is_empty() {
            anyhow::bail!("launch catalog agent '{}' has no models", agent.kind);
        }
        let mut seen_models = HashSet::new();
        let mut seen_control_keys = HashSet::new();
        for control in &agent.launch_controls {
            validate_launch_control(&agent.kind, None, control, &mut seen_control_keys)?;
        }
        for model in &agent.models {
            if model.id.trim().is_empty() {
                anyhow::bail!("launch catalog agent '{}' has empty model id", agent.kind);
            }
            if !seen_models.insert(model.id.clone()) {
                anyhow::bail!(
                    "launch catalog agent '{}' model '{}' is duplicated",
                    agent.kind,
                    model.id
                );
            }
            let mut seen_model_control_keys = HashSet::new();
            for control in &model.launch_controls {
                validate_launch_control(
                    &agent.kind,
                    Some(model.id.as_str()),
                    control,
                    &mut seen_model_control_keys,
                )?;
            }
        }
    }
    Ok(())
}

fn validate_launch_control(
    agent_kind: &str,
    model_id: Option<&str>,
    control: &WorkspaceSessionLaunchControl,
    seen_control_keys: &mut HashSet<WorkspaceSessionLaunchControlKey>,
) -> anyhow::Result<()> {
    if !seen_control_keys.insert(control.key.clone()) {
        anyhow::bail!(
            "launch catalog control '{:?}' is duplicated for {}",
            control.key,
            launch_control_owner(agent_kind, model_id)
        );
    }
    if control.label.trim().is_empty() {
        anyhow::bail!(
            "launch catalog control '{:?}' label is empty for {}",
            control.key,
            launch_control_owner(agent_kind, model_id)
        );
    }
    if control.control_type != "select" {
        anyhow::bail!(
            "launch catalog control '{:?}' has unsupported type '{}' for {}",
            control.key,
            control.control_type,
            launch_control_owner(agent_kind, model_id)
        );
    }
    if control.values.is_empty() {
        anyhow::bail!(
            "launch catalog control '{:?}' has no values for {}",
            control.key,
            launch_control_owner(agent_kind, model_id)
        );
    }
    let mut seen_values = HashSet::new();
    for value in &control.values {
        if value.value.trim().is_empty() {
            anyhow::bail!(
                "launch catalog control '{:?}' has an empty value for {}",
                control.key,
                launch_control_owner(agent_kind, model_id)
            );
        }
        if !seen_values.insert(value.value.clone()) {
            anyhow::bail!(
                "launch catalog control '{:?}' value '{}' is duplicated for {}",
                control.key,
                value.value,
                launch_control_owner(agent_kind, model_id)
            );
        }
        if value.label.trim().is_empty() {
            anyhow::bail!(
                "launch catalog control '{:?}' value '{}' label is empty for {}",
                control.key,
                value.value,
                launch_control_owner(agent_kind, model_id)
            );
        }
    }
    if let Some(default_value) = control.default_value.as_deref() {
        if !seen_values.contains(default_value) {
            anyhow::bail!(
                "launch catalog control '{:?}' default '{}' is not a value for {}",
                control.key,
                default_value,
                launch_control_owner(agent_kind, model_id)
            );
        }
    }
    match control.phase {
        anyharness_contract::v1::WorkspaceSessionLaunchControlPhase::CreateSession => {
            if control.create_field.as_deref() != Some("modeId") {
                anyhow::bail!(
                    "launch catalog create_session control '{:?}' must target modeId for {}",
                    control.key,
                    launch_control_owner(agent_kind, model_id)
                );
            }
        }
        anyharness_contract::v1::WorkspaceSessionLaunchControlPhase::LiveDefault => {
            if control.create_field.is_some() {
                anyhow::bail!(
                    "launch catalog live_default control '{:?}' cannot have createField for {}",
                    control.key,
                    launch_control_owner(agent_kind, model_id)
                );
            }
        }
    }
    Ok(())
}

fn launch_control_owner(agent_kind: &str, model_id: Option<&str>) -> String {
    match model_id {
        Some(model_id) => format!("agent '{agent_kind}' model '{model_id}'"),
        None => format!("agent '{agent_kind}'"),
    }
}

fn validate_provider(
    provider: &ModelCatalogProvider,
    seen_provider_kinds: &mut HashSet<String>,
) -> anyhow::Result<()> {
    if provider.kind.trim().is_empty() {
        anyhow::bail!("model catalog provider kind is empty");
    }
    if AgentKind::parse(provider.kind.as_str()).is_none() {
        anyhow::bail!(
            "model catalog provider '{}' is not supported",
            provider.kind
        );
    }
    if !seen_provider_kinds.insert(provider.kind.clone()) {
        anyhow::bail!("model catalog provider '{}' is duplicated", provider.kind);
    }
    if provider.display_name.trim().is_empty() {
        anyhow::bail!(
            "model catalog provider '{}' display name is empty",
            provider.kind
        );
    }
    if provider.models.is_empty() {
        anyhow::bail!("model catalog provider '{}' has no models", provider.kind);
    }
    let mut seen_model_ids = HashSet::new();
    for model in &provider.models {
        if model.id.trim().is_empty() {
            anyhow::bail!(
                "model catalog provider '{}' has empty model id",
                provider.kind
            );
        }
        if model.display_name.trim().is_empty() {
            anyhow::bail!(
                "model catalog provider '{}' model '{}' display name is empty",
                provider.kind,
                model.id
            );
        }
        if !seen_model_ids.insert(model.id.clone()) {
            anyhow::bail!(
                "model catalog provider '{}' model '{}' is duplicated",
                provider.kind,
                model.id
            );
        }
        for alias in &model.aliases {
            if alias.trim().is_empty() {
                anyhow::bail!(
                    "model catalog provider '{}' model '{}' has empty alias",
                    provider.kind,
                    model.id
                );
            }
        }
        if let Some(remediation) = &model.launch_remediation {
            if model.status != ModelCatalogStatus::Active {
                anyhow::bail!(
                    "model catalog provider '{}' model '{}' has launch remediation but is not active",
                    provider.kind,
                    model.id
                );
            }
            let message = remediation.message.trim();
            if message.is_empty() {
                anyhow::bail!(
                    "model catalog provider '{}' model '{}' launch remediation message is empty",
                    provider.kind,
                    model.id
                );
            }
            if message.chars().count() > LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS {
                anyhow::bail!(
                    "model catalog provider '{}' model '{}' launch remediation message is too long",
                    provider.kind,
                    model.id
                );
            }
        }
    }
    Ok(())
}

fn provider_to_registry(provider: &ModelCatalogProvider) -> anyhow::Result<ModelRegistryMetadata> {
    let models = provider
        .models
        .iter()
        .map(|model| {
            let (session_default_controls, session_default_controls_state) =
                parse_remote_session_default_controls(
                    &provider.kind,
                    &model.id,
                    &model.session_default_controls,
                );
            Ok(ModelRegistryModelMetadata {
                id: model.id.clone(),
                display_name: model.display_name.clone(),
                description: model.description.clone(),
                is_default: model.is_default,
                status: model.status,
                aliases: model.aliases.clone(),
                min_runtime_version: model.min_runtime_version.clone(),
                launch_remediation: model.launch_remediation.clone(),
                session_default_controls,
                session_default_controls_state,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    Ok(ModelRegistryMetadata {
        kind: provider.kind.clone(),
        display_name: provider.display_name.clone(),
        default_model_id: provider.default_model_id.clone(),
        models,
    })
}

fn parse_remote_session_default_controls(
    provider_kind: &str,
    model_id: &str,
    state: &RawSessionDefaultControlsState,
) -> (
    Vec<SessionDefaultControlMetadata>,
    SessionDefaultControlsState,
) {
    let RawSessionDefaultControlsState::Present(raw_controls) = state else {
        return (vec![], SessionDefaultControlsState::Omitted);
    };
    if raw_controls.is_empty() {
        return (vec![], SessionDefaultControlsState::Empty);
    }

    match parse_raw_session_default_controls(raw_controls) {
        Ok(controls) => (controls, SessionDefaultControlsState::Valid),
        Err(error) => {
            tracing::debug!(
                provider_kind,
                model_id,
                error = %error,
                "ignoring invalid remote model session default controls"
            );
            (vec![], SessionDefaultControlsState::Invalid)
        }
    }
}

fn parse_raw_session_default_controls(
    values: &[serde_json::Value],
) -> anyhow::Result<Vec<SessionDefaultControlMetadata>> {
    let mut controls = Vec::with_capacity(values.len());
    for value in values {
        controls.push(parse_raw_session_default_control(value)?);
    }
    validate_session_default_controls(&controls)?;
    Ok(controls)
}

fn parse_raw_session_default_control(
    value: &serde_json::Value,
) -> anyhow::Result<SessionDefaultControlMetadata> {
    let object = value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("session default control is not an object"))?;
    let key = object
        .get("key")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("session default control key is missing"))?;
    let key = match key {
        "reasoning" => SessionDefaultControlKey::Reasoning,
        "effort" => SessionDefaultControlKey::Effort,
        "fast_mode" => SessionDefaultControlKey::FastMode,
        other => anyhow::bail!("unknown session default control key '{other}'"),
    };
    let label = object
        .get("label")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("session default control label is missing"))?
        .to_string();
    let default_value = object
        .get("defaultValue")
        .map(|value| {
            value.as_str().map(str::to_string).ok_or_else(|| {
                anyhow::anyhow!("session default control defaultValue is not a string")
            })
        })
        .transpose()?;
    let raw_values = object
        .get("values")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("session default control values are missing"))?;

    let values = raw_values
        .iter()
        .map(parse_raw_session_default_control_value)
        .collect::<anyhow::Result<Vec<_>>>()?;

    Ok(SessionDefaultControlMetadata {
        key,
        label,
        values,
        default_value,
    })
}

fn parse_raw_session_default_control_value(
    value: &serde_json::Value,
) -> anyhow::Result<SessionDefaultControlValueMetadata> {
    let object = value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("session default control value is not an object"))?;
    let value_id = object
        .get("value")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("session default control value id is missing"))?
        .to_string();
    let label = object
        .get("label")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("session default control value label is missing"))?
        .to_string();
    let description = object
        .get("description")
        .map(|value| {
            value.as_str().map(str::to_string).ok_or_else(|| {
                anyhow::anyhow!("session default control value description is not a string")
            })
        })
        .transpose()?;
    let is_default = object
        .get("isDefault")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    Ok(SessionDefaultControlValueMetadata {
        value: value_id,
        label,
        description,
        is_default,
    })
}

fn validate_session_default_controls(
    controls: &[SessionDefaultControlMetadata],
) -> anyhow::Result<()> {
    let mut seen_keys = HashSet::new();
    for control in controls {
        if !seen_keys.insert(control.key) {
            anyhow::bail!("duplicate session default control key");
        }
        if control.label.trim().is_empty() {
            anyhow::bail!("session default control label is empty");
        }
        if control.values.is_empty() {
            anyhow::bail!("session default control has no values");
        }

        let mut seen_values = HashSet::new();
        let mut default_count = 0usize;
        for value in &control.values {
            if value.value.trim().is_empty() {
                anyhow::bail!("session default control value id is empty");
            }
            if value.label.trim().is_empty() {
                anyhow::bail!("session default control value label is empty");
            }
            if !seen_values.insert(value.value.clone()) {
                anyhow::bail!("duplicate session default control value");
            }
            if value.is_default {
                default_count += 1;
            }
        }

        match control.default_value.as_deref() {
            Some(default_value) => {
                if default_value.trim().is_empty() {
                    anyhow::bail!("session default control default value is empty");
                }
                let matching_default_count = control
                    .values
                    .iter()
                    .filter(|value| value.is_default && value.value == default_value)
                    .count();
                if matching_default_count != 1 || default_count != 1 {
                    anyhow::bail!(
                        "session default control default value does not match exactly one default value"
                    );
                }
            }
            None => {
                if default_count > 0 {
                    anyhow::bail!(
                        "session default control marks a default value without defaultValue"
                    );
                }
            }
        }
    }
    Ok(())
}

fn effective_registries(
    registries: Vec<ModelRegistryMetadata>,
    allow_candidates: bool,
) -> Vec<ModelRegistryMetadata> {
    registries
        .into_iter()
        .filter_map(|registry| effective_registry(registry, allow_candidates))
        .collect()
}

fn merge_catalog_registries(
    remote_registries: Vec<ModelRegistryMetadata>,
    bundled_registries: Vec<ModelRegistryMetadata>,
) -> Vec<ModelRegistryMetadata> {
    let mut remaining_bundled = bundled_registries;
    let mut merged = Vec::new();

    for remote_registry in remote_registries {
        let bundled_index = remaining_bundled
            .iter()
            .position(|registry| registry.kind == remote_registry.kind);
        let registry = if let Some(index) = bundled_index {
            merge_catalog_registry(remote_registry, remaining_bundled.remove(index))
        } else {
            remote_registry
        };
        merged.push(registry);
    }

    merged.extend(remaining_bundled);
    merged
}

fn merge_catalog_registry(
    remote_registry: ModelRegistryMetadata,
    bundled_registry: ModelRegistryMetadata,
) -> ModelRegistryMetadata {
    let mut remaining_bundled_models = bundled_registry.models;
    let mut models = Vec::new();

    for remote_model in remote_registry.models {
        let bundled_index = remaining_bundled_models
            .iter()
            .position(|model| model.id == remote_model.id);
        let model = if let Some(index) = bundled_index {
            let bundled_model = remaining_bundled_models.remove(index);
            if remote_model.status == ModelCatalogStatus::Candidate
                && bundled_model.status == ModelCatalogStatus::Active
            {
                bundled_model
            } else {
                merge_catalog_model(remote_model, Some(bundled_model))
            }
        } else {
            merge_catalog_model(remote_model, None)
        };
        models.push(model);
    }

    models.extend(remaining_bundled_models);

    ModelRegistryMetadata {
        kind: remote_registry.kind,
        display_name: remote_registry.display_name,
        default_model_id: remote_registry
            .default_model_id
            .or(bundled_registry.default_model_id),
        models,
    }
}

fn merge_catalog_model(
    mut remote_model: ModelRegistryModelMetadata,
    bundled_model: Option<ModelRegistryModelMetadata>,
) -> ModelRegistryModelMetadata {
    let Some(bundled_model) = bundled_model else {
        if remote_model.session_default_controls_state == SessionDefaultControlsState::Invalid {
            remote_model.session_default_controls = vec![];
            remote_model.session_default_controls_state = SessionDefaultControlsState::Empty;
        }
        return remote_model;
    };

    let should_use_remote_controls = remote_model.session_default_controls_state
        == SessionDefaultControlsState::Valid
        && !remote_model.session_default_controls.is_empty();
    if !should_use_remote_controls {
        remote_model.session_default_controls = bundled_model.session_default_controls;
        remote_model.session_default_controls_state =
            if remote_model.session_default_controls.is_empty() {
                SessionDefaultControlsState::Empty
            } else {
                SessionDefaultControlsState::Valid
            };
    }

    remote_model
}

fn effective_registry(
    registry: ModelRegistryMetadata,
    allow_candidates: bool,
) -> Option<ModelRegistryMetadata> {
    let mut models = registry
        .models
        .into_iter()
        .filter(|model| model_is_selectable(model, allow_candidates))
        .collect::<Vec<_>>();
    if models.is_empty() {
        return None;
    }

    let preferred_default_id = registry
        .default_model_id
        .as_deref()
        .filter(|default_id| models.iter().any(|model| model.id == *default_id))
        .map(str::to_string)
        .or_else(|| {
            models
                .iter()
                .find(|model| model.is_default)
                .map(|model| model.id.clone())
        })
        .or_else(|| models.first().map(|model| model.id.clone()));

    if let Some(default_id) = preferred_default_id.as_deref() {
        for model in &mut models {
            model.is_default = model.id == default_id;
        }
    }

    Some(ModelRegistryMetadata {
        kind: registry.kind,
        display_name: registry.display_name,
        default_model_id: preferred_default_id,
        models,
    })
}

fn model_is_selectable(model: &ModelRegistryModelMetadata, allow_candidates: bool) -> bool {
    match model.status {
        ModelCatalogStatus::Active => runtime_version_allows_model(model),
        ModelCatalogStatus::Candidate => allow_candidates && runtime_version_allows_model(model),
        ModelCatalogStatus::Deprecated | ModelCatalogStatus::Hidden => false,
    }
}

fn runtime_version_allows_model(model: &ModelRegistryModelMetadata) -> bool {
    model
        .min_runtime_version
        .as_deref()
        .map(|min_version| version_at_least(env!("CARGO_PKG_VERSION"), min_version))
        .unwrap_or(true)
}

fn version_at_least(current: &str, min: &str) -> bool {
    parse_version(current) >= parse_version(min)
}

fn parse_version(version: &str) -> Vec<u64> {
    version
        .split(['.', '-'])
        .take(3)
        .map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

/// Bundled offline fallback catalog.
pub fn bundled_model_registries() -> Vec<ModelRegistryMetadata> {
    match bundled_agent_catalog_document()
        .and_then(|catalog| registries_from_agent_catalog(&catalog, false))
    {
        Ok(registries) => registries,
        Err(error) => {
            tracing::error!(error = %error, "bundled agent catalog model registry is invalid");
            vec![]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model::ModelLaunchRemediationKind;

    fn temp_cache_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "anyharness-model-catalog-test-{}.json",
            uuid::Uuid::new_v4()
        ))
    }

    fn service_for_cache(cache_path: PathBuf, allow_candidates: bool) -> ModelCatalogService {
        ModelCatalogService::with_options(cache_path, None, allow_candidates)
    }

    fn launch_service_for_cache(cache_path: PathBuf) -> LaunchCatalogService {
        LaunchCatalogService::with_options(cache_path, None, false)
    }

    fn remote_catalog_with_models(
        kind: &str,
        default_model_id: Option<&str>,
        models: Vec<ModelCatalogModel>,
    ) -> ModelCatalogDocument {
        ModelCatalogDocument {
            catalog_version: "2026-04-25.1".to_string(),
            generated_at: Utc::now().to_rfc3339(),
            providers: vec![ModelCatalogProvider {
                kind: kind.to_string(),
                display_name: "Codex".to_string(),
                default_model_id: default_model_id.map(str::to_string),
                models,
            }],
        }
    }

    fn remote_model(id: &str, status: ModelCatalogStatus, is_default: bool) -> ModelCatalogModel {
        ModelCatalogModel {
            id: id.to_string(),
            display_name: format!("Remote {id}"),
            description: Some(format!("Remote description for {id}")),
            is_default,
            status,
            aliases: vec![],
            min_runtime_version: None,
            launch_remediation: None,
            session_default_controls: RawSessionDefaultControlsState::Omitted,
        }
    }

    fn control_json(key: &str) -> serde_json::Value {
        serde_json::json!({
            "key": key,
            "label": "Remote control",
            "defaultValue": "off",
            "values": [
                { "value": "off", "label": "Off", "isDefault": true },
                { "value": "on", "label": "On", "isDefault": false }
            ]
        })
    }

    fn remote_model_with_controls(
        id: &str,
        controls: RawSessionDefaultControlsState,
    ) -> ModelCatalogModel {
        ModelCatalogModel {
            session_default_controls: controls,
            ..remote_model(id, ModelCatalogStatus::Active, true)
        }
    }

    fn remote_launch_catalog(label: &str) -> LaunchCatalogDocument {
        LaunchCatalogDocument {
            schema_version: 1,
            catalog_version: "remote-launch-test".to_string(),
            generated_at: Utc::now().to_rfc3339(),
            agents: vec![LaunchCatalogAgentMetadata {
                kind: "codex".to_string(),
                display_name: "Codex".to_string(),
                default_model_id: "gpt-5.4".to_string(),
                launch_controls: vec![WorkspaceSessionLaunchControl {
                    key: WorkspaceSessionLaunchControlKey::Mode,
                    label: label.to_string(),
                    control_type: "select".to_string(),
                    default_value: Some("read-only".to_string()),
                    values: vec![
                        anyharness_contract::v1::WorkspaceSessionLaunchControlValue {
                            value: "read-only".to_string(),
                            label: "Read Only".to_string(),
                            description: None,
                            is_default: true,
                        },
                    ],
                    phase:
                        anyharness_contract::v1::WorkspaceSessionLaunchControlPhase::CreateSession,
                    create_field: Some("modeId".to_string()),
                }],
                models: vec![LaunchCatalogModelMetadata {
                    id: "gpt-5.4".to_string(),
                    status: Some(ModelCatalogStatus::Active),
                    launch_controls: vec![],
                }],
            }],
        }
    }

    fn write_cache(path: &Path, fetched_at: String, catalog: ModelCatalogDocument) {
        write_cache_file(
            path,
            &CachedModelCatalog {
                fetched_at,
                catalog,
            },
        )
        .expect("write cache file");
    }

    fn write_launch_cache(path: &Path, fetched_at: String, catalog: LaunchCatalogDocument) {
        write_launch_cache_file(
            path,
            &CachedLaunchCatalog {
                fetched_at,
                catalog,
            },
        )
        .expect("write launch cache file");
    }

    #[test]
    fn agent_catalog_rejects_unsupported_create_field() {
        let mut catalog = bundled_agent_catalog_document().expect("bundled catalog");
        let codex = catalog
            .agents
            .iter_mut()
            .find(|agent| agent.kind == "codex")
            .expect("codex agent");
        let effort = codex
            .session
            .controls
            .iter_mut()
            .find(|control| control.key == "effort")
            .expect("effort control");
        effort.apply.create_field = Some("arbitraryField".to_string());

        let error = validate_agent_catalog_document(&catalog).expect_err("invalid create field");

        assert!(
            error.to_string().contains("unsupported createField"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn fresh_cached_launch_catalog_overrides_bundled_controls() {
        let cache_path = temp_cache_path();
        write_launch_cache(
            &cache_path,
            Utc::now().to_rfc3339(),
            remote_launch_catalog("Remote Permissions"),
        );

        let snapshot = launch_service_for_cache(cache_path).snapshot();

        assert_eq!(snapshot.catalog_version, "remote-launch-test");
        let codex = snapshot
            .agents
            .into_iter()
            .find(|agent| agent.kind == "codex")
            .expect("codex launch agent");
        assert_eq!(codex.launch_controls[0].label, "Remote Permissions");
    }

    #[test]
    fn stale_cached_launch_catalog_falls_back_to_bundled_catalog() {
        let cache_path = temp_cache_path();
        write_launch_cache(
            &cache_path,
            (Utc::now() - Duration::hours(CACHE_MAX_AGE_HOURS + 1)).to_rfc3339(),
            remote_launch_catalog("Remote Permissions"),
        );

        let snapshot = launch_service_for_cache(cache_path).snapshot();

        assert_ne!(snapshot.catalog_version, "remote-launch-test");
        assert!(snapshot.agents.iter().any(|agent| agent.kind == "codex"));
    }

    #[test]
    fn claude_registry_uses_concise_product_labels() {
        let claude = model_registries()
            .into_iter()
            .find(|config| config.kind == "claude")
            .expect("claude registry");

        let labels = claude
            .models
            .iter()
            .map(|model| {
                (
                    model.id.as_str(),
                    model.display_name.as_str(),
                    model.description.as_deref(),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            claude.default_model_id.as_deref(),
            Some("us.anthropic.claude-sonnet-4-6")
        );
        assert!(labels.iter().any(|(id, name, description)| {
            *id == "us.anthropic.claude-sonnet-4-6"
                && *name == "Sonnet"
                && description
                    .unwrap_or("")
                    .contains("Best for everyday tasks")
        }));
        assert!(labels.iter().any(|(id, name, description)| {
            *id == "us.anthropic.claude-opus-4-7[1m]"
                && *name == "Opus 4.7 (1M context)"
                && description.unwrap_or("").contains("long sessions")
        }));
        let opus_47 = claude
            .models
            .iter()
            .find(|model| model.id == "us.anthropic.claude-opus-4-7[1m]")
            .expect("opus 4.7 model");
        assert!(!opus_47
            .aliases
            .iter()
            .any(|alias| alias == "claude-opus-4-6"));
        assert!(opus_47
            .aliases
            .iter()
            .any(|alias| alias == "claude-opus-4-6-1m"));
        assert!(opus_47
            .aliases
            .iter()
            .any(|alias| alias == "claude-opus-4-7-1m"));
        assert!(labels.iter().any(|(id, name, description)| {
            *id == "us.anthropic.claude-opus-4-6-v1"
                && *name == "Opus 4.6"
                && description.unwrap_or("").contains("Opus 4.6")
        }));
    }

    #[test]
    fn bundled_codex_gpt_5_5_is_active_with_remediation() {
        let codex = model_registries()
            .into_iter()
            .find(|config| config.kind == "codex")
            .expect("codex registry");

        assert_eq!(codex.default_model_id.as_deref(), Some("gpt-5.5"));
        let gpt_55 = codex
            .models
            .iter()
            .find(|model| model.id == "gpt-5.5")
            .expect("gpt 5.5 model");
        assert_eq!(
            gpt_55
                .launch_remediation
                .as_ref()
                .map(|remediation| remediation.kind),
            Some(ModelLaunchRemediationKind::ManagedReinstall)
        );
    }

    #[test]
    fn cursor_gpt_5_5_uses_external_update_remediation() {
        let service = service_for_cache(temp_cache_path(), true);
        let cursor = service
            .bundled_registries()
            .into_iter()
            .find(|config| config.kind == "cursor")
            .expect("cursor registry");

        let gpt_55 = cursor
            .models
            .iter()
            .find(|model| model.id == "gpt-5.5[context=272k,reasoning=medium,fast=false]")
            .expect("cursor gpt 5.5 model");
        assert_eq!(
            gpt_55
                .launch_remediation
                .as_ref()
                .map(|remediation| remediation.kind),
            Some(ModelLaunchRemediationKind::ExternalUpdate)
        );
    }

    #[test]
    fn fresh_cached_remote_catalog_overlays_bundled_catalog() {
        let cache_path = temp_cache_path();
        write_cache(
            &cache_path,
            Utc::now().to_rfc3339(),
            remote_catalog_with_models(
                "codex",
                Some("gpt-remote"),
                vec![remote_model("gpt-remote", ModelCatalogStatus::Active, true)],
            ),
        );
        let service = service_for_cache(cache_path.clone(), false);

        let codex = service.registry("codex").expect("codex registry");

        assert_eq!(codex.default_model_id.as_deref(), Some("gpt-remote"));
        assert_eq!(codex.models[0].display_name, "Remote gpt-remote");
        assert!(codex.models.iter().any(|model| model.id == "gpt-5.5"));
        let _ = fs::remove_file(cache_path);
    }

    #[test]
    fn remote_candidate_does_not_hide_bundled_active_model() {
        let cache_path = temp_cache_path();
        write_cache(
            &cache_path,
            Utc::now().to_rfc3339(),
            remote_catalog_with_models(
                "codex",
                Some("gpt-5.4"),
                vec![
                    remote_model("gpt-5.5", ModelCatalogStatus::Candidate, false),
                    remote_model("gpt-5.4", ModelCatalogStatus::Active, true),
                ],
            ),
        );
        let service = service_for_cache(cache_path.clone(), false);

        let codex = service.registry("codex").expect("codex registry");
        let gpt_55 = codex
            .models
            .iter()
            .find(|model| model.id == "gpt-5.5")
            .expect("bundled active gpt 5.5 remains selectable");

        assert_eq!(gpt_55.status, ModelCatalogStatus::Active);
        assert_eq!(gpt_55.display_name, "GPT-5.5");
        assert!(!gpt_55.session_default_controls.is_empty());
        let _ = fs::remove_file(cache_path);
    }

    #[test]
    fn remote_catalog_preserves_bundled_controls_when_omitted_or_empty() {
        for controls in [
            RawSessionDefaultControlsState::Omitted,
            RawSessionDefaultControlsState::Present(vec![]),
        ] {
            let catalog = remote_catalog_with_models(
                "codex",
                Some("gpt-5.4"),
                vec![remote_model_with_controls("gpt-5.4", controls)],
            );

            let registries =
                effective_remote_registries_from_document(&catalog, false).expect("remote catalog");
            let codex = registries
                .into_iter()
                .find(|registry| registry.kind == "codex")
                .expect("codex registry");
            let gpt_54 = codex
                .models
                .iter()
                .find(|model| model.id == "gpt-5.4")
                .expect("gpt 5.4");

            assert_eq!(
                gpt_54
                    .session_default_controls
                    .iter()
                    .map(|control| control.key)
                    .collect::<Vec<_>>(),
                vec![
                    SessionDefaultControlKey::Effort,
                    SessionDefaultControlKey::FastMode
                ]
            );
        }
    }

    #[test]
    fn remote_catalog_replaces_bundled_controls_when_valid_non_empty() {
        let catalog = remote_catalog_with_models(
            "codex",
            Some("gpt-5.4"),
            vec![remote_model_with_controls(
                "gpt-5.4",
                RawSessionDefaultControlsState::Present(vec![control_json("fast_mode")]),
            )],
        );

        let registries =
            effective_remote_registries_from_document(&catalog, false).expect("remote catalog");
        let codex = registries
            .into_iter()
            .find(|registry| registry.kind == "codex")
            .expect("codex registry");
        let gpt_54 = codex
            .models
            .iter()
            .find(|model| model.id == "gpt-5.4")
            .expect("gpt 5.4");

        assert_eq!(
            gpt_54
                .session_default_controls
                .iter()
                .map(|control| control.key)
                .collect::<Vec<_>>(),
            vec![SessionDefaultControlKey::FastMode]
        );
    }

    #[test]
    fn remote_catalog_invalid_non_empty_controls_fall_back_to_bundled() {
        let catalog = remote_catalog_with_models(
            "codex",
            Some("gpt-5.4"),
            vec![remote_model_with_controls(
                "gpt-5.4",
                RawSessionDefaultControlsState::Present(vec![
                    control_json("fast_mode"),
                    control_json("unknown_future_key"),
                ]),
            )],
        );

        let registries =
            effective_remote_registries_from_document(&catalog, false).expect("remote catalog");
        let codex = registries
            .into_iter()
            .find(|registry| registry.kind == "codex")
            .expect("codex registry");
        let gpt_54 = codex
            .models
            .iter()
            .find(|model| model.id == "gpt-5.4")
            .expect("gpt 5.4");

        assert_eq!(
            gpt_54
                .session_default_controls
                .iter()
                .map(|control| control.key)
                .collect::<Vec<_>>(),
            vec![
                SessionDefaultControlKey::Effort,
                SessionDefaultControlKey::FastMode
            ]
        );
    }

    #[test]
    fn remote_only_model_with_invalid_controls_stays_without_controls() {
        let catalog = remote_catalog_with_models(
            "codex",
            Some("gpt-remote"),
            vec![remote_model_with_controls(
                "gpt-remote",
                RawSessionDefaultControlsState::Present(vec![control_json("unknown_future_key")]),
            )],
        );

        let registries =
            effective_remote_registries_from_document(&catalog, false).expect("remote catalog");
        let codex = registries
            .into_iter()
            .find(|registry| registry.kind == "codex")
            .expect("codex registry");
        let gpt_remote = codex
            .models
            .iter()
            .find(|model| model.id == "gpt-remote")
            .expect("remote model");

        assert!(gpt_remote.session_default_controls.is_empty());
    }

    #[test]
    fn remote_hidden_model_suppresses_bundled_active_model() {
        let cache_path = temp_cache_path();
        write_cache(
            &cache_path,
            Utc::now().to_rfc3339(),
            remote_catalog_with_models(
                "codex",
                Some("gpt-5.4"),
                vec![
                    remote_model("gpt-5.5", ModelCatalogStatus::Hidden, false),
                    remote_model("gpt-5.4", ModelCatalogStatus::Active, true),
                ],
            ),
        );
        let service = service_for_cache(cache_path.clone(), false);

        let codex = service.registry("codex").expect("codex registry");

        assert!(!codex.models.iter().any(|model| model.id == "gpt-5.5"));
        let _ = fs::remove_file(cache_path);
    }

    #[test]
    fn remote_hidden_overlay_is_cacheable_when_merged_catalog_remains_selectable() {
        let catalog = remote_catalog_with_models(
            "codex",
            Some("gpt-5.4"),
            vec![remote_model("gpt-5.5", ModelCatalogStatus::Hidden, false)],
        );

        let registries = effective_remote_registries_from_document(&catalog, false)
            .expect("hidden overlay should be valid against merged catalog");
        let codex = registries
            .into_iter()
            .find(|registry| registry.kind == "codex")
            .expect("codex registry");

        assert!(!codex.models.iter().any(|model| model.id == "gpt-5.5"));
        assert!(codex.models.iter().any(|model| model.id == "gpt-5.4"));
    }

    #[test]
    fn stale_cached_remote_catalog_falls_back_to_bundled_catalog() {
        let cache_path = temp_cache_path();
        write_cache(
            &cache_path,
            (Utc::now() - Duration::hours(CACHE_MAX_AGE_HOURS + 1)).to_rfc3339(),
            remote_catalog_with_models(
                "codex",
                Some("gpt-remote"),
                vec![remote_model("gpt-remote", ModelCatalogStatus::Active, true)],
            ),
        );
        let service = service_for_cache(cache_path.clone(), false);

        let codex = service.registry("codex").expect("codex registry");

        assert_eq!(codex.default_model_id.as_deref(), Some("gpt-5.5"));
        assert!(codex.models.iter().any(|model| model.id == "gpt-5.5"));
        let _ = fs::remove_file(cache_path);
    }

    #[test]
    fn invalid_cached_remote_catalog_falls_back_to_bundled_catalog() {
        let cache_path = temp_cache_path();
        fs::write(&cache_path, b"{").expect("write invalid cache");
        let service = service_for_cache(cache_path.clone(), false);

        let codex = service.registry("codex").expect("codex registry");

        assert_eq!(codex.default_model_id.as_deref(), Some("gpt-5.5"));
        let _ = fs::remove_file(cache_path);
    }

    #[test]
    fn hidden_candidate_and_too_new_remote_models_are_not_selectable_by_default() {
        let catalog = remote_catalog_with_models(
            "codex",
            Some("active"),
            vec![
                remote_model("active", ModelCatalogStatus::Active, true),
                remote_model("candidate", ModelCatalogStatus::Candidate, false),
                remote_model("hidden", ModelCatalogStatus::Hidden, false),
                ModelCatalogModel {
                    min_runtime_version: Some("999.0.0".to_string()),
                    ..remote_model("too-new", ModelCatalogStatus::Active, false)
                },
            ],
        );

        let registries =
            effective_registries_from_document(&catalog, false).expect("valid effective registry");
        let ids = registries[0]
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["active"]);
    }

    #[test]
    fn validates_launch_remediation_metadata() {
        let catalog = remote_catalog_with_models(
            "codex",
            Some("active"),
            vec![ModelCatalogModel {
                launch_remediation: Some(ModelLaunchRemediationMetadata {
                    kind: ModelLaunchRemediationKind::ManagedReinstall,
                    message: "Update Codex tools and retry.".to_string(),
                }),
                ..remote_model("active", ModelCatalogStatus::Active, true)
            }],
        );

        let registries =
            effective_registries_from_document(&catalog, false).expect("valid remediation");

        assert_eq!(
            registries[0].models[0]
                .launch_remediation
                .as_ref()
                .map(|remediation| remediation.kind),
            Some(ModelLaunchRemediationKind::ManagedReinstall)
        );
    }

    #[test]
    fn rejects_launch_remediation_on_non_active_model() {
        let catalog = remote_catalog_with_models(
            "codex",
            Some("active"),
            vec![
                remote_model("active", ModelCatalogStatus::Active, true),
                ModelCatalogModel {
                    launch_remediation: Some(ModelLaunchRemediationMetadata {
                        kind: ModelLaunchRemediationKind::ExternalUpdate,
                        message: "Update externally.".to_string(),
                    }),
                    ..remote_model("candidate", ModelCatalogStatus::Candidate, false)
                },
            ],
        );

        let error =
            effective_registries_from_document(&catalog, false).expect_err("invalid remediation");

        assert!(error
            .to_string()
            .contains("has launch remediation but is not active"));
    }

    #[test]
    fn rejects_overlong_launch_remediation_message() {
        let catalog = remote_catalog_with_models(
            "codex",
            Some("active"),
            vec![ModelCatalogModel {
                launch_remediation: Some(ModelLaunchRemediationMetadata {
                    kind: ModelLaunchRemediationKind::Restart,
                    message: "x".repeat(LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS + 1),
                }),
                ..remote_model("active", ModelCatalogStatus::Active, true)
            }],
        );

        let error =
            effective_registries_from_document(&catalog, false).expect_err("invalid remediation");

        assert!(error.to_string().contains("message is too long"));
    }
}
