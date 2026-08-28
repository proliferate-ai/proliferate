//! Headless catalog probe: spawns a harness's ACP agent process with injected
//! credentials, enumerates models/modes/config options, switches models one by
//! one, and records the per-model option matrix. Never sends a prompt.
//!
//! Lives inside `live::sessions` so it can reuse the driver layer
//! (`spawn_agent_process`, `initialize_connection`, `start_new_session`)
//! without widening their visibility.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use agent_client_protocol::{self as acp};
use serde::Serialize;
use tokio::sync::{mpsc, oneshot};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::domains::agents::model::{AgentKind, ResolvedAgent};

use super::driver::process::spawn_agent_process;
use super::driver::session_lifecycle::{initialize_connection, start_new_session};

mod config_options;
use config_options::{
    current_model_from_config_options, model_entries_from_config_options,
    switch_model_and_capture_options,
};
mod model_setter;
use model_setter::{model_entries_from_model_state, set_init_meta_model_and_confirm};

const PROBE_SESSION_ID: &str = "catalog-probe";
const PROBE_WORKSPACE_ID: &str = "catalog-probe";

pub struct ProbeOptions {
    pub agent_kind: AgentKind,
    /// Artifact-path resolution for `agent_kind`, done by the caller before
    /// constructing this struct (`resolve_agent_unrouted`, unrouted: artifact
    /// paths only — a route supplies credentials, not binaries). `live/`
    /// never fetches from a domain service itself; its whole world arrives
    /// at birth.
    pub resolved: ResolvedAgent,
    pub auth_context: String,
    /// Credential env vars injected into the agent process (e.g.
    /// ANTHROPIC_API_KEY). Treated as protected: merged last, never recorded
    /// in the snapshot.
    pub auth_env: BTreeMap<String, String>,
    /// Env keys required ABSENT in the spawned process, mapped to
    /// `LaunchEnv.route_auth_remove` (which `merge_spawn_env` and spawn already
    /// honor).
    ///
    /// Without it the claude recipes' sanitization half is silently dropped: the
    /// renderer removes `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY`,
    /// `AWS_BEARER_TOKEN_BEDROCK` and any Anthropic selector the route did not
    /// itself set, on EVERY non-native claude route. A probe that only sets vars
    /// would observe Bedrock's model menu on a Bedrock-exporting machine and
    /// record it as the gateway's (or the BYOK key's) truth.
    pub auth_env_remove: Vec<String>,
    pub runtime_home: PathBuf,
    /// Parent for the throwaway spawn workspace. `None` keeps the historical
    /// `temp_dir()` behavior for the CLI; the runtime engine passes its own
    /// scratch so ONE guard cleans everything — including on a cancelled probe,
    /// whose own teardown never runs.
    pub workspace_root: Option<PathBuf>,
    /// How long to wait for a ConfigOptionUpdate notification after a model
    /// switch before recording the switch as unobserved.
    pub model_switch_timeout: Duration,
    /// Optional cap on how many models to switch through (safety valve for
    /// harnesses with very large dynamic model lists).
    pub max_models: Option<usize>,
    /// Capture the per-model `config_options` matrix by switching through every
    /// model. Runtime probes enable this only for bounded harnesses that expose
    /// an authoritative model config option.
    ///
    /// **It does not skip the enumeration loop.** The loop does two jobs at once:
    /// the per-model switch round-trip AND building the `models` vector the whole
    /// snapshot exists to capture. `false` keeps every `models.push`, and
    /// suppresses only the `config_options` capture (set to `None`) plus the
    /// un-switchable warning — not switching was the instruction, not a defect.
    /// Ids, names, descriptions, modes, observed defaults and the attestation are
    /// all still recorded.
    ///
    /// Vendor init-meta model alternatives have no config option, so each
    /// alternative is setter-confirmed before inclusion regardless of this flag.
    pub switch_models: bool,
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

/// Must be called from within a tokio `LocalSet` (the ACP connection uses
/// `spawn_local`).
pub async fn probe_agent(options: ProbeOptions) -> anyhow::Result<ProbeSnapshot> {
    let resolved = &options.resolved;
    if resolved.agent_process.path.is_none() {
        anyhow::bail!(
            "agent process for {} is not installed; run `anyharness install-agents --agent {}` first",
            options.agent_kind.as_str(),
            options.agent_kind.as_str()
        );
    }

    let workspace = probe_workspace_dir(&options.agent_kind, options.workspace_root.as_deref())?;
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
    // Credential env vars are merged into the session layer (after the
    // workspace layer); the probe passes no other layer that could shadow
    // them, so they reach the agent process unchanged.
    session_launch_env.extend(
        options
            .auth_env
            .iter()
            .map(|(key, value)| (key.clone(), value.clone())),
    );
    let launch_env = crate::live::sessions::model::LaunchEnv {
        session: session_launch_env,
        // Removals are applied last at spawn (`Command::env_remove`), so they win
        // even against ambient values the runtime process inherited.
        route_auth_remove: options.auth_env_remove.clone(),
        ..Default::default()
    };
    let spawned = spawn_agent_process(
        resolved,
        &workspace,
        &launch_env,
        PROBE_SESSION_ID,
        PROBE_WORKSPACE_ID,
        options.agent_kind.as_str(),
        &ready_tx,
    )?;
    let mut child = spawned.child;

    let (notification_tx, mut notification_rx) =
        mpsc::unbounded_channel::<acp::schema::SessionNotification>();

    let (cx_tx, cx_rx) = oneshot::channel::<acp::ConnectionTo<acp::Agent>>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let transport = acp::ByteStreams::new(spawned.stdin.compat_write(), spawned.stdout.compat());

    let connect_future = acp::Client
        .builder()
        .on_receive_notification(
            async move |notif: acp::schema::SessionNotification, _cx| {
                let _ = notification_tx.send(notif);
                Ok(())
            },
            acp::on_receive_notification!(),
        )
        .on_receive_request(
            async move |_req: acp::schema::RequestPermissionRequest,
                        responder: acp::Responder<acp::schema::RequestPermissionResponse>,
                        _cx| {
                responder
                    .respond_with_result(Err(acp::Error::internal_error()
                        .data("catalog probe does not grant permissions")))
            },
            acp::on_receive_request!(),
        )
        .connect_with(
            transport,
            move |cx: acp::ConnectionTo<acp::Agent>| async move {
                let _ = cx_tx.send(cx);
                let _ = shutdown_rx.await;
                Ok(())
            },
        );

    tokio::task::spawn_local(async move {
        if let Err(error) = connect_future.await {
            tracing::debug!(%error, "probe ACP IO task ended");
        }
    });
    let conn = cx_rx.await?;

    let result = run_enumeration(
        &conn,
        &resolved_kind(&options),
        resolved,
        &workspace,
        &options,
        &mut notification_rx,
        &ready_tx,
        &mut warnings,
    )
    .await;

    drop(shutdown_tx);
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
    conn: &acp::ConnectionTo<acp::Agent>,
    kind: &str,
    resolved: &crate::domains::agents::model::ResolvedAgent,
    workspace: &Path,
    options: &ProbeOptions,
    notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
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

    let new_session = start_new_session(
        conn,
        workspace,
        &[],
        None,
        &BTreeMap::new(),
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
    let mut current_model_id: Option<String> = None;
    let current_mode_id = new_session
        .modes
        .as_ref()
        .map(|modes| modes.current_mode_id.to_string());

    let mut available: Vec<(String, String, Option<String>)> = vec![];
    let mut model_source = "acpModels";
    let mut model_config_id: Option<String> = None;
    if available.is_empty() {
        // Some harnesses (e.g. OpenCode) expose the model list as a `model`
        // config option instead of the ACP models block.
        if let Some((config_id, entries)) = model_entries_from_config_options(
            &new_session.config_options.clone().unwrap_or_default(),
        ) {
            model_source = "modelConfigOption";
            current_model_id = current_model_from_config_options(
                &new_session.config_options.clone().unwrap_or_default(),
            );
            model_config_id = Some(config_id);
            available = entries;
        }
    }
    if available.is_empty() {
        // Some harnesses (e.g. Grok) advertise their model menu only via the
        // initialize response's vendor `_meta.modelState`, not the ACP models
        // block or a `model` config option.
        if let Some(model_state) = init.meta.as_ref().and_then(|meta| meta.get("modelState")) {
            if let Some(entries) = model_entries_from_model_state(model_state) {
                model_source = "initMetaModelState";
                current_model_id = model_state
                    .get("currentModelId")
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
                available = entries;
            }
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
        let config_options = if model_source == "initMetaModelState" {
            // Vendor init metadata is enumeration, not proof that the legacy
            // setter can establish this value. Keep the current value as a
            // no-op; every alternative must return an exact effective-model
            // readback before the probe advertises it.
            if current_model_id.as_deref() != Some(model_id.as_str()) {
                match set_init_meta_model_and_confirm(conn, &native_session_id, &model_id).await {
                    Ok(true) => {}
                    Ok(false) => {
                        warnings.push(format!(
                            "session/set_model({model_id}) returned no matching model readback"
                        ));
                        continue;
                    }
                    Err(error) => {
                        warnings.push(format!("session/set_model({model_id}) failed: {error}"));
                        continue;
                    }
                }
            }
            None
        } else if !options.switch_models {
            // The instruction was "do not switch", so there is no matrix and no
            // defect to warn about. The entry is still recorded in full.
            None
        } else if let Some(config_id) = &model_config_id {
            // Model exposed as a config option: switch through it; the
            // response carries the updated option set directly, including the
            // exact model read-back used to admit the capture.
            switch_model_and_capture_options(
                conn,
                &native_session_id,
                config_id,
                &model_id,
                options.model_switch_timeout,
                warnings,
            )
            .await?
        } else {
            // ACP 0.14 removed set_session_model; harnesses that expose models
            // via the ACP models block can no longer be switched for per-model
            // config enumeration.
            warnings.push(format!(
                "cannot switch to {model_id}: set_session_model removed in ACP 0.14 \
                 (model not exposed as a config option)"
            ));
            None
        };
        models.push(ProbeModelEntry {
            model_id,
            name,
            description,
            config_options,
        });
    }

    let prompt_result = if options.send_test_prompt {
        let request = acp::schema::PromptRequest::new(
            new_session.session_id.clone(),
            vec![acp::schema::ContentBlock::Text(
                acp::schema::TextContent::new("Reply with exactly: OK"),
            )],
        );
        Some(
            match tokio::time::timeout(
                Duration::from_secs(90),
                conn.send_request(request).block_task(),
            )
            .await
            {
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

fn drain_pending(notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>) {
    while notification_rx.try_recv().is_ok() {}
}

/// Best-effort identification of the native CLI the adapter will use. Claude
/// may use its provider-specific executable override; every other harness uses
/// only its own managed native artifact. Runs `--version` to record the actual
/// version string.
fn detect_native_cli(
    resolved: &crate::domains::agents::model::ResolvedAgent,
) -> Option<ProbeNativeCli> {
    let kind = &resolved.descriptor.kind;
    let claude_executable = (kind == &AgentKind::Claude)
        .then(|| std::env::var("CLAUDE_CODE_EXECUTABLE").ok())
        .flatten();
    let managed_native = resolved
        .native
        .as_ref()
        .and_then(|artifact| artifact.path.clone());
    let path = native_cli_path(kind, managed_native, claude_executable.as_deref())?;
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

fn native_cli_path(
    kind: &AgentKind,
    managed_native: Option<PathBuf>,
    claude_executable: Option<&str>,
) -> Option<PathBuf> {
    let claude_override = (kind == &AgentKind::Claude)
        .then_some(claude_executable)
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);
    claude_override.or(managed_native)
}

/// Where the throwaway spawn workspace lives. `workspace_root` lets the runtime
/// engine put it inside its own scratch guard, so a cancelled probe (whose
/// teardown `remove_dir_all` never runs) still leaves nothing behind.
fn probe_workspace_dir(kind: &AgentKind, workspace_root: Option<&Path>) -> anyhow::Result<PathBuf> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let name = format!(
        "anyharness-catalog-probe-{}-{}-{}",
        kind.as_str(),
        std::process::id(),
        nanos
    );
    let dir = match workspace_root {
        Some(root) => root.join(name),
        None => std::env::temp_dir().join(name),
    };
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// The env a probe's child would actually receive, for tests OUTSIDE this module
/// (the probe seam's) to assert the removal chain end to end.
///
/// It exists because `merge_spawn_env` and the driver layer are private to
/// `live::sessions` by design, and the property worth pinning — that
/// `auth_env_remove` beats a set value at spawn — lives in that private layer.
/// Building the `LaunchEnv` here rather than in the test is the point: a test that
/// assembled its own could pass while `probe_agent` forgot to pass the removals
/// through, which is exactly the regression C5 named.
#[cfg(test)]
pub(crate) fn spawn_env_for_options(
    options: &ProbeOptions,
    ambient: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut session = ambient.clone();
    session.extend(options.auth_env.clone());
    let launch_env = crate::live::sessions::model::LaunchEnv {
        session,
        route_auth_remove: options.auth_env_remove.clone(),
        ..Default::default()
    };
    super::driver::process::merge_spawn_env(&launch_env, None)
}

#[cfg(test)]
mod tests;
