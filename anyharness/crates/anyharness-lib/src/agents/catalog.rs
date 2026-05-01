use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::agents::model::{
    AgentKind, ModelCatalogStatus, ModelLaunchRemediationKind, ModelLaunchRemediationMetadata,
    ModelRegistryMetadata, ModelRegistryModelMetadata, SessionDefaultControlKey,
    SessionDefaultControlMetadata, SessionDefaultControlValueMetadata, SessionDefaultControlsState,
};

const DEFAULT_REMOTE_MODEL_CATALOG_URL: &str =
    "https://downloads.proliferate.com/anyharness/model-catalog/v1/catalog.json";
const MODEL_CATALOG_URL_ENV: &str = "ANYHARNESS_MODEL_CATALOG_URL";
const DISABLE_REMOTE_MODEL_CATALOG_ENV: &str = "ANYHARNESS_DISABLE_REMOTE_MODEL_CATALOG";
const ENABLE_CANDIDATE_MODELS_ENV: &str = "ANYHARNESS_MODEL_CATALOG_CANDIDATES";
const CACHE_MAX_AGE_HOURS: i64 = 24;
const LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS: usize = 160;

/// Returns the runtime-owned model registry catalog exposed by AnyHarness.
///
/// This is retained for tests and simple callers. Application code should use
/// [`ModelCatalogService`] so fresh remote/cached catalog rows can override the
/// bundled fallback.
pub fn model_registries() -> Vec<ModelRegistryMetadata> {
    effective_registries(bundled_model_registries(), false)
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
                .join("model-catalog")
                .join("catalog-cache.json"),
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
        effective_registries(bundled_model_registries(), self.allow_candidates)
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
        let catalog = client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json::<ModelCatalogDocument>()
            .await?;

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
    if env_flag_enabled(DISABLE_REMOTE_MODEL_CATALOG_ENV) {
        return None;
    }

    let configured = std::env::var(MODEL_CATALOG_URL_ENV)
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    match configured.as_deref() {
        Some("off") | Some("disabled") | Some("none") => None,
        Some(url) => Some(url.to_string()),
        None => Some(DEFAULT_REMOTE_MODEL_CATALOG_URL.to_string()),
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
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, serde_json::to_vec_pretty(cached)?)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(tmp_path, path)?;
    Ok(())
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
    vec![
        claude_registry(),
        codex_registry(),
        gemini_registry(),
        cursor_registry(),
        opencode_registry(),
        amp_registry(),
    ]
}

fn registry(
    kind: &str,
    display_name: &str,
    models: Vec<ModelRegistryModelMetadata>,
) -> ModelRegistryMetadata {
    let default_model_id = models
        .iter()
        .find(|model| model.is_default)
        .map(|model| model.id.clone());

    ModelRegistryMetadata {
        kind: kind.into(),
        display_name: display_name.into(),
        default_model_id,
        models,
    }
}

fn model(
    id: &str,
    name: &str,
    description: Option<&str>,
    is_default: bool,
) -> ModelRegistryModelMetadata {
    model_with_status(
        id,
        name,
        description,
        is_default,
        ModelCatalogStatus::Active,
        vec![],
        None,
    )
}

fn model_with_status(
    id: &str,
    name: &str,
    description: Option<&str>,
    is_default: bool,
    status: ModelCatalogStatus,
    aliases: Vec<&str>,
    min_runtime_version: Option<&str>,
) -> ModelRegistryModelMetadata {
    ModelRegistryModelMetadata {
        id: id.into(),
        display_name: name.into(),
        description: description.map(str::to_string),
        is_default,
        status,
        aliases: aliases.into_iter().map(str::to_string).collect(),
        min_runtime_version: min_runtime_version.map(str::to_string),
        launch_remediation: None,
        session_default_controls: vec![],
        session_default_controls_state: SessionDefaultControlsState::Empty,
    }
}

fn model_with_launch_remediation(
    id: &str,
    name: &str,
    description: Option<&str>,
    is_default: bool,
    remediation_kind: ModelLaunchRemediationKind,
    remediation_message: &str,
) -> ModelRegistryModelMetadata {
    ModelRegistryModelMetadata {
        id: id.into(),
        display_name: name.into(),
        description: description.map(str::to_string),
        is_default,
        status: ModelCatalogStatus::Active,
        aliases: vec![],
        min_runtime_version: None,
        launch_remediation: Some(ModelLaunchRemediationMetadata {
            kind: remediation_kind,
            message: remediation_message.into(),
        }),
        session_default_controls: vec![],
        session_default_controls_state: SessionDefaultControlsState::Empty,
    }
}

fn model_with_session_default_controls(
    mut model: ModelRegistryModelMetadata,
    controls: Vec<SessionDefaultControlMetadata>,
) -> ModelRegistryModelMetadata {
    validate_session_default_controls(&controls).expect("bundled session default controls");
    model.session_default_controls = controls;
    model.session_default_controls_state = if model.session_default_controls.is_empty() {
        SessionDefaultControlsState::Empty
    } else {
        SessionDefaultControlsState::Valid
    };
    model
}

fn session_default_control(
    key: SessionDefaultControlKey,
    label: &str,
    default_value: &str,
    values: Vec<SessionDefaultControlValueMetadata>,
) -> SessionDefaultControlMetadata {
    SessionDefaultControlMetadata {
        key,
        label: label.into(),
        values,
        default_value: Some(default_value.into()),
    }
}

fn session_default_value(
    value: &str,
    label: &str,
    is_default: bool,
) -> SessionDefaultControlValueMetadata {
    SessionDefaultControlValueMetadata {
        value: value.into(),
        label: label.into(),
        description: None,
        is_default,
    }
}

fn reasoning_default_control() -> SessionDefaultControlMetadata {
    session_default_control(
        SessionDefaultControlKey::Reasoning,
        "Reasoning",
        "off",
        vec![
            session_default_value("off", "Off", true),
            session_default_value("on", "On", false),
        ],
    )
}

fn effort_default_control(default_value: &str) -> SessionDefaultControlMetadata {
    session_default_control(
        SessionDefaultControlKey::Effort,
        "Reasoning effort",
        default_value,
        vec![
            session_default_value("low", "Low", default_value == "low"),
            session_default_value("medium", "Medium", default_value == "medium"),
            session_default_value("high", "High", default_value == "high"),
            session_default_value("max", "Max", default_value == "max"),
        ],
    )
}

fn fast_mode_default_control() -> SessionDefaultControlMetadata {
    session_default_control(
        SessionDefaultControlKey::FastMode,
        "Fast mode",
        "off",
        vec![
            session_default_value("off", "Slow", true),
            session_default_value("on", "Fast", false),
        ],
    )
}

fn claude_default_controls() -> Vec<SessionDefaultControlMetadata> {
    vec![
        reasoning_default_control(),
        effort_default_control("medium"),
    ]
}

fn codex_default_controls() -> Vec<SessionDefaultControlMetadata> {
    vec![
        effort_default_control("medium"),
        fast_mode_default_control(),
    ]
}

fn claude_registry() -> ModelRegistryMetadata {
    registry(
        "claude",
        "Claude",
        vec![
            model_with_session_default_controls(
                model_with_status(
                    "sonnet",
                    "Sonnet 4.6",
                    Some("Best for everyday tasks"),
                    true,
                    ModelCatalogStatus::Active,
                    vec!["claude-sonnet-4-5", "claude-sonnet-4-6"],
                    None,
                ),
                claude_default_controls(),
            ),
            model_with_session_default_controls(
                model_with_status(
                    "sonnet[1m]",
                    "Sonnet 4.6",
                    Some("1M context · Billed as extra usage · $3/$15 per Mtok"),
                    false,
                    ModelCatalogStatus::Active,
                    vec!["claude-sonnet-4-5-1m", "claude-sonnet-4-6-1m"],
                    None,
                ),
                claude_default_controls(),
            ),
            model_with_session_default_controls(
                model_with_status(
                    "opus[1m]",
                    "Opus 4.7",
                    Some("Most capable for complex work · 1M context"),
                    false,
                    ModelCatalogStatus::Active,
                    vec![
                        "claude-opus-4-5",
                        "claude-opus-4-5-1m",
                        "claude-opus-4-6-1m",
                        "claude-opus-4-7",
                        "claude-opus-4-7-1m",
                        "opus",
                    ],
                    None,
                ),
                claude_default_controls(),
            ),
            model_with_session_default_controls(
                model(
                    "claude-opus-4-6",
                    "Opus 4.6",
                    Some("Pinned previous Opus model"),
                    false,
                ),
                claude_default_controls(),
            ),
            model_with_session_default_controls(
                model(
                    "haiku",
                    "Haiku 4.5",
                    Some("Fastest for quick answers"),
                    false,
                ),
                claude_default_controls(),
            ),
        ],
    )
}

fn codex_registry() -> ModelRegistryMetadata {
    registry(
        "codex",
        "Codex",
        vec![
            model_with_session_default_controls(
                model_with_launch_remediation(
                    "gpt-5.5",
                    "GPT 5.5",
                    Some("Latest OpenAI coding model"),
                    false,
                    ModelLaunchRemediationKind::ManagedReinstall,
                    "Update Codex tools and retry.",
                ),
                codex_default_controls(),
            ),
            model_with_session_default_controls(
                model("gpt-5.4", "GPT 5.4", None, true),
                codex_default_controls(),
            ),
            model_with_session_default_controls(
                model("gpt-5.4-mini", "GPT 5.4 Mini", None, false),
                codex_default_controls(),
            ),
            model_with_session_default_controls(
                model("gpt-5.3-codex", "GPT 5.3 Codex", None, false),
                codex_default_controls(),
            ),
            model_with_session_default_controls(
                model("gpt-5.3-codex-spark", "GPT 5.3 Codex Spark", None, false),
                codex_default_controls(),
            ),
            model_with_session_default_controls(
                model("gpt-5.2-codex", "GPT 5.2 Codex", None, false),
                codex_default_controls(),
            ),
            model_with_session_default_controls(
                model("gpt-5.1-codex-max", "GPT 5.1 Codex Max", None, false),
                codex_default_controls(),
            ),
            model_with_session_default_controls(
                model("gpt-5.2", "GPT 5.2", None, false),
                codex_default_controls(),
            ),
            model_with_session_default_controls(
                model("gpt-5.1-codex-mini", "GPT 5.1 Codex Mini", None, false),
                codex_default_controls(),
            ),
        ],
    )
}

fn gemini_registry() -> ModelRegistryMetadata {
    registry(
        "gemini",
        "Gemini",
        vec![
            model("auto-gemini-2.5", "Auto (Gemini 2.5)", None, true),
            model("gemini-2.5-pro", "Gemini 2.5 Pro", None, false),
            model("gemini-2.5-flash", "Gemini 2.5 Flash", None, false),
            model(
                "gemini-2.5-flash-lite",
                "Gemini 2.5 Flash Lite",
                None,
                false,
            ),
            model("auto-gemini-3", "Auto (Gemini 3)", None, false),
            model("gemini-3-flash-preview", "Gemini 3 Flash", None, false),
            model("gemini-3.1-pro-preview", "Gemini 3.1 Pro", None, false),
        ],
    )
}

fn cursor_registry() -> ModelRegistryMetadata {
    registry(
        "cursor",
        "Cursor",
        vec![
            model("default[]", "Auto", None, true),
            model("composer-2[fast=true]", "Composer 2", None, false),
            model("composer-1.5[]", "Composer 1.5", None, false),
            model(
                "claude-opus-4-6[thinking=true,context=200k,effort=high,fast=false]",
                "Opus 4.6",
                None,
                false,
            ),
            model(
                "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]",
                "Sonnet 4.6",
                None,
                false,
            ),
            model_with_launch_remediation(
                "gpt-5.5[reasoning=medium,fast=false]",
                "GPT 5.5",
                None,
                false,
                ModelLaunchRemediationKind::ExternalUpdate,
                "Update Cursor tools from Agent Settings, then retry.",
            ),
            model(
                "gpt-5.4[reasoning=medium,context=272k,fast=false]",
                "GPT 5.4",
                None,
                false,
            ),
            model(
                "gpt-5.3-codex[reasoning=medium,fast=false]",
                "Codex 5.3",
                None,
                false,
            ),
            model("gemini-3.1-pro[]", "Gemini 3.1 Pro", None, false),
            model("claude-opus-4-5[thinking=true]", "Opus 4.5", None, false),
            model(
                "gpt-5.2[reasoning=medium,fast=false]",
                "GPT 5.2",
                None,
                false,
            ),
            model(
                "gpt-5.4-mini[reasoning=medium]",
                "GPT 5.4 Mini",
                None,
                false,
            ),
            model("claude-haiku-4-5[thinking=true]", "Haiku 4.5", None, false),
            model(
                "claude-sonnet-4-5[thinking=true,context=200k]",
                "Sonnet 4.5",
                None,
                false,
            ),
        ],
    )
}

fn opencode_registry() -> ModelRegistryMetadata {
    registry(
        "opencode",
        "OpenCode",
        vec![model("opencode/big-pickle", "Big Pickle", None, true)],
    )
}

fn amp_registry() -> ModelRegistryMetadata {
    registry(
        "amp",
        "Amp",
        vec![model("amp-default", "Amp Default", None, true)],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_cache_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "anyharness-model-catalog-test-{}.json",
            uuid::Uuid::new_v4()
        ))
    }

    fn service_for_cache(cache_path: PathBuf, allow_candidates: bool) -> ModelCatalogService {
        ModelCatalogService::with_options(cache_path, None, allow_candidates)
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

        assert_eq!(claude.default_model_id.as_deref(), Some("sonnet"));
        assert!(labels.contains(&("sonnet", "Sonnet 4.6", Some("Best for everyday tasks"))));
        assert!(labels.iter().any(|(id, name, description)| {
            *id == "opus[1m]"
                && *name == "Opus 4.7"
                && description.unwrap_or("").contains("1M context")
        }));
        let opus_47 = claude
            .models
            .iter()
            .find(|model| model.id == "opus[1m]")
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
            .any(|alias| alias == "claude-opus-4-7"));
        assert!(labels.iter().any(|(id, name, description)| {
            *id == "claude-opus-4-6"
                && *name == "Opus 4.6"
                && description.unwrap_or("").contains("Pinned previous Opus")
        }));
    }

    #[test]
    fn bundled_codex_gpt_5_5_is_active_with_remediation() {
        let codex = model_registries()
            .into_iter()
            .find(|config| config.kind == "codex")
            .expect("codex registry");

        assert_eq!(codex.default_model_id.as_deref(), Some("gpt-5.4"));
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
            .find(|model| model.id == "gpt-5.5[reasoning=medium,fast=false]")
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
        assert_eq!(gpt_55.display_name, "GPT 5.5");
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

        assert_eq!(codex.default_model_id.as_deref(), Some("gpt-5.4"));
        assert!(codex.models.iter().any(|model| model.id == "gpt-5.4"));
        let _ = fs::remove_file(cache_path);
    }

    #[test]
    fn invalid_cached_remote_catalog_falls_back_to_bundled_catalog() {
        let cache_path = temp_cache_path();
        fs::write(&cache_path, b"{").expect("write invalid cache");
        let service = service_for_cache(cache_path.clone(), false);

        let codex = service.registry("codex").expect("codex registry");

        assert_eq!(codex.default_model_id.as_deref(), Some("gpt-5.4"));
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
