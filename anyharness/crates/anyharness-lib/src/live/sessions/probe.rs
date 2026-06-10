//! Headless catalog probe: spawns a harness's ACP agent process with injected
//! credentials, enumerates models/modes/config options, switches models one by
//! one, and records the per-model option matrix. Never sends a prompt.
//!
//! Lives inside `live::sessions` so it can reuse the driver layer
//! (`spawn_agent_process`, `initialize_connection`, `start_new_session`)
//! without widening their visibility.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use agent_client_protocol::{self as acp, Agent};
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::domains::agents::model::AgentKind;
use crate::domains::agents::readiness::resolver::resolve_agent;
use crate::domains::agents::registry::built_in_registry;

use super::driver::process::spawn_agent_process;
use super::driver::start::{initialize_connection, start_new_session};
use super::driver::SessionMcpServer;

const PROBE_SESSION_ID: &str = "catalog-probe";
const PROBE_WORKSPACE_ID: &str = "catalog-probe";

pub struct ProbeOptions {
    pub agent_kind: AgentKind,
    pub auth_context: String,
    /// Credential env vars injected into the agent process (e.g.
    /// ANTHROPIC_API_KEY). Treated as protected: merged last, never recorded
    /// in the snapshot.
    pub auth_env: BTreeMap<String, String>,
    pub runtime_home: PathBuf,
    /// How long to wait for a ConfigOptionUpdate notification after a model
    /// switch before recording the switch as unobserved.
    pub model_switch_timeout: Duration,
    /// Optional cap on how many models to switch through (safety valve for
    /// harnesses with very large dynamic model lists).
    pub max_models: Option<usize>,
    /// Send one minimal prompt on the session's current model and record the
    /// outcome. This is the ONLY honest availability test for seeded model
    /// ids: harness menus list whatever the config names without validating
    /// it, so listing != launchable. Burns a small number of tokens.
    pub send_test_prompt: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeAttestation {
    pub name: String,
    pub version: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeNativeCli {
    pub path: String,
    pub version: Option<String>,
}

/// Result of an availability trial: a model id NOT on the advertised menu,
/// seeded via config preset, accepted iff a real inference turn succeeded.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeTrialResult {
    pub model_id: String,
    pub accepted: bool,
    /// Display name the harness used for the seeded model, when observable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Raw config options observed on the trial session (the seeded model was
    /// current) — the per-model matrix for this off-menu model.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_options: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbePromptResult {
    pub ok: bool,
    /// stop_reason on success, error string on failure.
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeModelEntry {
    pub model_id: String,
    pub name: String,
    pub description: Option<String>,
    /// Raw ACP config options observed after switching to this model, or null
    /// when no ConfigOptionUpdate arrived within the timeout.
    pub config_options: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSnapshot {
    pub probed_at: String,
    pub agent_kind: String,
    pub auth_context: String,
    pub attestation: Option<ProbeAttestation>,
    /// Where the model list came from: the ACP `models` block
    /// ("acpModels"), a `model` config option ("modelConfigOption" — e.g.
    /// OpenCode), or "none".
    pub model_source: String,
    /// The native coding-agent CLI the adapter was pointed at (path +
    /// `--version` output), when determinable. Session behavior depends on
    /// this as much as on the adapter version.
    pub native_cli: Option<ProbeNativeCli>,
    /// Availability trials run alongside this snapshot (off-menu model ids
    /// the harness accepted or rejected). Populated by the CLI command.
    #[serde(default)]
    pub trials: Vec<ProbeTrialResult>,
    /// Outcome of the minimal test prompt, when send_test_prompt was set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_result: Option<ProbePromptResult>,
    pub current_model_id: Option<String>,
    pub current_mode_id: Option<String>,
    /// Raw `modes` block from the new_session response.
    pub modes: serde_json::Value,
    /// Raw config options reported at session start (for the default model).
    pub baseline_config_options: serde_json::Value,
    pub models: Vec<ProbeModelEntry>,
    pub warnings: Vec<String>,
}

struct ProbeClient {
    notification_tx: mpsc::UnboundedSender<acp::SessionNotification>,
}

#[async_trait::async_trait(?Send)]
impl acp::Client for ProbeClient {
    async fn request_permission(
        &self,
        _args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        Err(acp::Error::internal_error().data("catalog probe does not grant permissions"))
    }

    async fn session_notification(
        &self,
        notification: acp::SessionNotification,
    ) -> acp::Result<(), acp::Error> {
        let _ = self.notification_tx.send(notification);
        Ok(())
    }

    async fn ext_method(&self, _args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        Err(acp::Error::method_not_found())
    }
}

/// Must be called from within a tokio `LocalSet` (the ACP connection uses
/// `spawn_local`).
pub async fn probe_agent(options: ProbeOptions) -> anyhow::Result<ProbeSnapshot> {
    let registry = built_in_registry();
    let descriptor = registry
        .iter()
        .find(|descriptor| descriptor.kind == options.agent_kind)
        .ok_or_else(|| {
            anyhow::anyhow!("agent kind {} not in registry", options.agent_kind.as_str())
        })?;
    let resolved = resolve_agent(descriptor, &options.runtime_home);
    if resolved.agent_process.path.is_none() {
        anyhow::bail!(
            "agent process for {} is not installed; run `anyharness install-agents --agent {}` first",
            options.agent_kind.as_str(),
            options.agent_kind.as_str()
        );
    }

    let workspace = probe_workspace_dir(&options.agent_kind)?;
    let mut warnings = Vec::new();

    // Mirror production launch env: point the adapter at the managed native
    // CLI when one is installed, otherwise let the adapter fall back to its
    // own resolution (and record that we did).
    let mut session_launch_env = BTreeMap::new();
    if options.agent_kind == AgentKind::Claude {
        match resolved
            .native
            .as_ref()
            .and_then(|artifact| artifact.path.as_ref())
        {
            Some(path) => {
                session_launch_env.insert(
                    "CLAUDE_CODE_EXECUTABLE".to_string(),
                    path.to_string_lossy().into_owned(),
                );
            }
            None => warnings.push(
                "native claude CLI not managed-installed; adapter will use its own CLI resolution"
                    .to_string(),
            ),
        }
    }

    let (ready_tx, _ready_rx) = std::sync::mpsc::channel::<anyhow::Result<String>>();
    let empty = BTreeMap::new();
    let spawned = spawn_agent_process(
        &resolved,
        &workspace,
        &empty,
        &session_launch_env,
        &empty,
        &options.auth_env,
        PROBE_SESSION_ID,
        PROBE_WORKSPACE_ID,
        options.agent_kind.as_str(),
        None,
        &ready_tx,
    )?;
    let mut child = spawned.child;

    let (notification_tx, mut notification_rx) =
        mpsc::unbounded_channel::<acp::SessionNotification>();
    let client = ProbeClient { notification_tx };
    let (conn, io_task) = acp::ClientSideConnection::new(
        client,
        spawned.stdin.compat_write(),
        spawned.stdout.compat(),
        |fut| {
            tokio::task::spawn_local(fut);
        },
    );
    tokio::task::spawn_local(async move {
        if let Err(error) = io_task.await {
            tracing::debug!(error = %error, "probe ACP IO task ended");
        }
    });

    let result = run_enumeration(
        &conn,
        &resolved_kind(&options),
        &resolved,
        &workspace,
        &options,
        &mut notification_rx,
        &ready_tx,
        &mut warnings,
    )
    .await;

    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
    let _ = std::fs::remove_dir_all(&workspace);

    result
}

fn resolved_kind(options: &ProbeOptions) -> String {
    options.agent_kind.as_str().to_string()
}

#[allow(clippy::too_many_arguments)]
async fn run_enumeration(
    conn: &acp::ClientSideConnection,
    kind: &str,
    resolved: &crate::domains::agents::model::ResolvedAgent,
    workspace: &PathBuf,
    options: &ProbeOptions,
    notification_rx: &mut mpsc::UnboundedReceiver<acp::SessionNotification>,
    ready_tx: &std::sync::mpsc::Sender<anyhow::Result<String>>,
    warnings: &mut Vec<String>,
) -> anyhow::Result<ProbeSnapshot> {
    let init = initialize_connection(
        conn,
        kind,
        resolved,
        PROBE_SESSION_ID,
        PROBE_WORKSPACE_ID,
        ready_tx,
    )
    .await?;

    let attestation = init.agent_info.as_ref().map(|info| ProbeAttestation {
        name: info.name.clone(),
        version: info.version.clone(),
        title: info.title.clone(),
    });
    if attestation.is_none() {
        warnings.push("agent did not report agent_info at initialize".to_string());
    }

    let mcp_servers: Vec<SessionMcpServer> = Vec::new();
    let new_session = start_new_session(
        conn,
        workspace,
        &mcp_servers,
        None,
        PROBE_SESSION_ID,
        PROBE_WORKSPACE_ID,
        "catalog_probe",
        "probe.new_session.ok",
        "probe.new_session.failed",
    )
    .await?;
    let native_session_id = new_session.session_id.to_string();

    let baseline_config_options = serde_json::to_value(&new_session.config_options)?;
    let modes = serde_json::to_value(&new_session.modes)?;
    let current_model_id = new_session
        .models
        .as_ref()
        .map(|models| models.current_model_id.to_string());
    let current_mode_id = new_session
        .modes
        .as_ref()
        .map(|modes| modes.current_mode_id.to_string());

    let mut available: Vec<(String, String, Option<String>)> = new_session
        .models
        .as_ref()
        .map(|models| {
            models
                .available_models
                .iter()
                .map(|model| {
                    (
                        model.model_id.to_string(),
                        model.name.clone(),
                        model.description.clone(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let mut model_source = "acpModels";
    let mut model_config_id: Option<String> = None;
    if available.is_empty() {
        // Some harnesses (e.g. OpenCode) expose the model list as a `model`
        // config option instead of the ACP models block.
        if let Some((config_id, entries)) =
            model_entries_from_config_options(&new_session.config_options.clone().unwrap_or_default())
        {
            model_source = "modelConfigOption";
            model_config_id = Some(config_id);
            available = entries;
        }
    }
    if available.is_empty() {
        model_source = "none";
        warnings.push("agent reported no available models at new_session".to_string());
    }
    if let Some(max) = options.max_models {
        if available.len() > max {
            warnings.push(format!(
                "model list truncated from {} to {} by --max-models",
                available.len(),
                max
            ));
            available.truncate(max);
        }
    }

    let mut models = Vec::with_capacity(available.len());
    for (model_id, name, description) in available {
        drain_pending(notification_rx);
        let config_options = if let Some(config_id) = &model_config_id {
            // Model exposed as a config option: switch through it; the
            // response carries the updated option set directly.
            match conn
                .set_session_config_option(acp::SetSessionConfigOptionRequest::new(
                    native_session_id.clone(),
                    config_id.clone(),
                    model_id.as_str(),
                ))
                .await
            {
                Ok(response) => Some(elided(serde_json::to_value(&response.config_options)?)),
                Err(error) => {
                    warnings.push(format!(
                        "set_session_config_option({config_id}={model_id}) failed: {error}"
                    ));
                    None
                }
            }
        } else {
            match conn
                .set_session_model(acp::SetSessionModelRequest::new(
                    native_session_id.clone(),
                    model_id.clone(),
                ))
                .await
            {
                Ok(_) => {
                    match await_config_option_update(notification_rx, options.model_switch_timeout)
                        .await
                    {
                        Some(config_options) => {
                            Some(elided(serde_json::to_value(&config_options)?))
                        }
                        None => {
                            warnings.push(format!(
                                "no ConfigOptionUpdate within {:?} after switching to {model_id}",
                                options.model_switch_timeout
                            ));
                            None
                        }
                    }
                }
                Err(error) => {
                    warnings.push(format!("set_session_model({model_id}) failed: {error}"));
                    None
                }
            }
        };
        models.push(ProbeModelEntry {
            model_id,
            name,
            description,
            config_options,
        });
    }

    let prompt_result = if options.send_test_prompt {
        let request = acp::PromptRequest::new(
            new_session.session_id.clone(),
            vec![acp::ContentBlock::Text(acp::TextContent::new(
                "Reply with exactly: OK".to_string(),
            ))],
        );
        Some(
            match tokio::time::timeout(Duration::from_secs(90), conn.prompt(request)).await {
                Ok(Ok(response)) => ProbePromptResult {
                    ok: true,
                    detail: format!("{:?}", response.stop_reason),
                },
                Ok(Err(error)) => ProbePromptResult {
                    ok: false,
                    detail: error.to_string(),
                },
                Err(_) => ProbePromptResult {
                    ok: false,
                    detail: "test prompt timed out after 90s".to_string(),
                },
            },
        )
    } else {
        None
    };

    Ok(ProbeSnapshot {
        probed_at: chrono::Utc::now().to_rfc3339(),
        agent_kind: kind.to_string(),
        auth_context: options.auth_context.clone(),
        attestation,
        model_source: model_source.to_string(),
        native_cli: detect_native_cli(resolved),
        trials: Vec::new(),
        prompt_result,
        current_model_id,
        current_mode_id,
        modes,
        baseline_config_options,
        models,
        warnings: std::mem::take(warnings),
    })
}

fn drain_pending(notification_rx: &mut mpsc::UnboundedReceiver<acp::SessionNotification>) {
    while notification_rx.try_recv().is_ok() {}
}

/// Per-model captures repeat the self-referential `model` select with the
/// FULL model list as values — quadratic snapshot bloat with zero
/// information (the baseline capture keeps the complete list). Elide those
/// values in per-model captures, keeping the option + currentValue for
/// switch verification.
fn elided(mut config_options: serde_json::Value) -> serde_json::Value {
    if let Some(options) = config_options.as_array_mut() {
        for option in options {
            let is_model = option.get("id").and_then(|v| v.as_str()) == Some("model")
                || option.get("category").and_then(|v| v.as_str()) == Some("model");
            if is_model {
                if let Some(object) = option.as_object_mut() {
                    object.insert("options".to_string(), serde_json::Value::Array(Vec::new()));
                    object.insert("valuesElided".to_string(), serde_json::Value::Bool(true));
                }
            }
        }
    }
    config_options
}

/// Extract (config_id, [(model_id, name, description)]) from a `model`
/// config option, when the harness reports models that way.
fn model_entries_from_config_options(
    config_options: &[acp::SessionConfigOption],
) -> Option<(String, Vec<(String, String, Option<String>)>)> {
    let option = config_options.iter().find(|option| {
        matches!(
            option.category,
            Some(acp::SessionConfigOptionCategory::Model)
        ) || option.id.to_string() == "model"
    })?;
    #[allow(unreachable_patterns)]
    let select = match &option.kind {
        acp::SessionConfigKind::Select(select) => select,
        _ => return None,
    };
    let entries: Vec<(String, String, Option<String>)> = match &select.options {
        acp::SessionConfigSelectOptions::Ungrouped(values) => values
            .iter()
            .map(|value| {
                (
                    value.value.to_string(),
                    value.name.clone(),
                    value.description.clone(),
                )
            })
            .collect(),
        acp::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|group| group.options.iter())
            .map(|value| {
                (
                    value.value.to_string(),
                    value.name.clone(),
                    value.description.clone(),
                )
            })
            .collect(),
        _ => return None,
    };
    Some((option.id.to_string(), entries))
}

async fn await_config_option_update(
    notification_rx: &mut mpsc::UnboundedReceiver<acp::SessionNotification>,
    timeout: Duration,
) -> Option<Vec<acp::SessionConfigOption>> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.checked_duration_since(tokio::time::Instant::now())?;
        match tokio::time::timeout(remaining, notification_rx.recv()).await {
            Ok(Some(notification)) => {
                if let acp::SessionUpdate::ConfigOptionUpdate(update) = notification.update {
                    return Some(update.config_options);
                }
            }
            Ok(None) | Err(_) => return None,
        }
    }
}

/// Best-effort identification of the native CLI the adapter will use:
/// the CLAUDE_CODE_EXECUTABLE-style env override, else the managed native
/// artifact. Runs `--version` to record the actual version string.
fn detect_native_cli(
    resolved: &crate::domains::agents::model::ResolvedAgent,
) -> Option<ProbeNativeCli> {
    let path = std::env::var("CLAUDE_CODE_EXECUTABLE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            resolved
                .native
                .as_ref()
                .and_then(|artifact| artifact.path.clone())
        })?;
    let version = std::process::Command::new(&path)
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string());
    Some(ProbeNativeCli {
        path: path.to_string_lossy().into_owned(),
        version,
    })
}

fn probe_workspace_dir(kind: &AgentKind) -> anyhow::Result<PathBuf> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let dir = std::env::temp_dir().join(format!(
        "anyharness-catalog-probe-{}-{}-{}",
        kind.as_str(),
        std::process::id(),
        nanos
    ));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
