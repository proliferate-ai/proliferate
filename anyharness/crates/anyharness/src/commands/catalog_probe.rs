use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use clap::Args;

use anyharness_lib::app::{default_runtime_home, ensure_runtime_home};
use anyharness_lib::domains::agents::model::AgentKind;
use anyharness_lib::live::sessions::probe::{probe_agent, ProbeOptions, ProbeSnapshot};

#[derive(Args)]
pub struct CatalogProbeArgs {
    /// Agent kind to probe (claude, codex, gemini, cursor, opencode)
    #[arg(long)]
    pub agent: String,

    /// Auth context to probe under (e.g. anthropic-api). Determines which
    /// credential env vars are required and injected.
    #[arg(long = "auth-context")]
    pub auth_context: String,

    #[arg(long)]
    pub runtime_home: Option<String>,

    /// Output directory for the probe snapshot JSON
    #[arg(long, default_value = "scripts/agent-catalog/generated")]
    pub out: String,

    /// Seconds to wait for a ConfigOptionUpdate after each model switch
    #[arg(long, default_value_t = 8)]
    pub model_switch_timeout_secs: u64,

    /// Cap the number of models switched through (safety valve)
    #[arg(long)]
    pub max_models: Option<usize>,

    /// Availability trial: model ids NOT on the advertised menu to test by
    /// seeding the harness config with them (repeatable). Accepted ids are
    /// available-but-not-default-visible; rejected ids are unavailable.
    #[arg(long = "trial-model")]
    pub trial_models: Vec<String>,
}

pub async fn run(args: CatalogProbeArgs) -> Result<()> {
    let agent_kind = AgentKind::parse(&args.agent)
        .ok_or_else(|| anyhow!("unknown agent kind `{}`", args.agent))?;
    let auth_env = auth_env_for_context(&agent_kind, &args.auth_context)?;

    let runtime_home = args
        .runtime_home
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_runtime_home);
    ensure_runtime_home(&runtime_home)?;

    let options = ProbeOptions {
        agent_kind: agent_kind.clone(),
        auth_context: args.auth_context.clone(),
        auth_env,
        runtime_home: runtime_home.clone(),
        model_switch_timeout: Duration::from_secs(args.model_switch_timeout_secs),
        max_models: args.max_models,
        send_test_prompt: false,
    };

    let local = tokio::task::LocalSet::new();
    let mut snapshot = local.run_until(probe_agent(options)).await?;

    // Availability trials: one fresh, isolated probe per candidate id with
    // the harness config seeded to select it. Accepted = the harness lists
    // or selects the id; the menu-read in `snapshot` is unaffected.
    for trial_id in &args.trial_models {
        if agent_kind != AgentKind::Claude {
            anyhow::bail!("--trial-model is currently supported for claude only");
        }
        let mut trial_env = auth_env_for_context(&agent_kind, &args.auth_context)?;
        let config_dir = trial_env
            .get("CLAUDE_CONFIG_DIR")
            .cloned()
            .ok_or_else(|| anyhow!("claude trial requires an isolated CLAUDE_CONFIG_DIR"))?;
        std::fs::write(
            std::path::Path::new(&config_dir).join("settings.json"),
            serde_json::json!({ "model": trial_id }).to_string(),
        )?;
        let trial_options = ProbeOptions {
            agent_kind: agent_kind.clone(),
            auth_context: format!("{}+trial:{trial_id}", args.auth_context),
            auth_env: trial_env,
            runtime_home: runtime_home.clone(),
            model_switch_timeout: Duration::from_secs(args.model_switch_timeout_secs),
            max_models: Some(0),
            // Menu listing is NOT acceptance — the harness lists whatever the
            // config names. Only a successful inference turn counts.
            send_test_prompt: true,
        };
        let (accepted, name, config_options) =
            match local.run_until(probe_agent(trial_options)).await {
                Ok(trial_snapshot) => {
                    let accepted = match &trial_snapshot.prompt_result {
                        Some(result) if result.ok => true,
                        Some(result) => {
                            println!("trial {trial_id}: prompt rejected ({})", result.detail);
                            false
                        }
                        None => false,
                    };
                    let name = trial_model_name(&trial_snapshot.baseline_config_options, trial_id);
                    let config_options =
                        accepted.then(|| trial_snapshot.baseline_config_options.clone());
                    (accepted, name, config_options)
                }
                Err(error) => {
                    println!("trial {trial_id}: probe failed ({error}) — recording as rejected");
                    (false, None, None)
                }
            };
        snapshot.trials.push(
            anyharness_lib::live::sessions::probe::ProbeTrialResult {
                model_id: trial_id.clone(),
                accepted,
                name,
                config_options,
            },
        );
    }

    let out_dir = PathBuf::from(&args.out);
    std::fs::create_dir_all(&out_dir)
        .with_context(|| format!("failed to create output dir {}", out_dir.display()))?;
    let out_path = out_dir.join(format!(
        "{}.{}.probe.json",
        args.agent.to_lowercase(),
        args.auth_context.to_lowercase()
    ));
    std::fs::write(&out_path, serde_json::to_vec_pretty(&snapshot)?)
        .with_context(|| format!("failed to write {}", out_path.display()))?;

    print_summary(&snapshot, &out_path);
    Ok(())
}

fn print_summary(snapshot: &ProbeSnapshot, out_path: &std::path::Path) {
    if let Some(attestation) = &snapshot.attestation {
        println!(
            "agent: {} {} ({})",
            attestation.name,
            attestation.version,
            attestation.title.as_deref().unwrap_or("-")
        );
    }
    println!(
        "models: {} (current: {})",
        snapshot.models.len(),
        snapshot.current_model_id.as_deref().unwrap_or("-")
    );
    let observed = snapshot
        .models
        .iter()
        .filter(|model| model.config_options.is_some())
        .count();
    println!("per-model config options observed: {observed}/{}", snapshot.models.len());
    for warning in &snapshot.warnings {
        println!("warning: {warning}");
    }
    println!("wrote {}", out_path.display());
}

fn auth_env_for_context(
    agent_kind: &AgentKind,
    auth_context: &str,
) -> Result<BTreeMap<String, String>> {
    match (agent_kind, auth_context) {
        (AgentKind::Claude, "anthropic-api") => {
            // Isolate the Claude config dir so machine-local settings
            // (default model, effort preference) can't pollute observed
            // values; mirrors production's gateway CLAUDE_CONFIG_DIR usage.
            let mut env = isolation_env(auth_context, &[("CLAUDE_CONFIG_DIR", "claude-config")])?;
            // Optional config preset: seed the isolated config dir with a
            // settings.json (experiments / future per-context config presets).
            if let Ok(settings_json) = std::env::var("PROBE_CLAUDE_SETTINGS_JSON") {
                let config_dir = env.get("CLAUDE_CONFIG_DIR").expect("claude isolation dir");
                std::fs::write(
                    std::path::Path::new(config_dir).join("settings.json"),
                    settings_json,
                )?;
            }
            env.insert("ANTHROPIC_API_KEY".to_string(), require_env("ANTHROPIC_API_KEY")?);
            Ok(env)
        }
        // Claude under subscription OAuth: requires a credentials file
        // produced by `claude setup-token` (or copied from a logged-in
        // ~/.claude/.credentials.json). We copy it into an isolated config
        // dir so nothing else from the machine leaks in.
        (AgentKind::Claude, "anthropic-oauth") => {
            let credentials_path = std::env::var("PROBE_CLAUDE_OAUTH_CREDENTIALS").map_err(|_| {
                anyhow!(
                    "auth context anthropic-oauth requires PROBE_CLAUDE_OAUTH_CREDENTIALS=\
                     /path/to/.credentials.json (produce one with `claude setup-token`)"
                )
            })?;
            let env = isolation_env(auth_context, &[("CLAUDE_CONFIG_DIR", "claude-config")])?;
            let config_dir = env.get("CLAUDE_CONFIG_DIR").expect("claude isolation dir");
            std::fs::copy(
                &credentials_path,
                std::path::Path::new(config_dir).join(".credentials.json"),
            )
            .with_context(|| format!("failed to copy {credentials_path}"))?;
            Ok(env)
        }
        // OpenCode resolves credentials from env vars AND its own config/auth
        // storage (XDG dirs), so every opencode context isolates those dirs —
        // otherwise machine-local opencode.jsonc / auth.json would pollute the
        // auth attribution.
        (AgentKind::OpenCode, "baseline") => opencode_isolation_env(auth_context),
        (AgentKind::OpenCode, "anthropic-api") => {
            let mut env = opencode_isolation_env(auth_context)?;
            env.insert("ANTHROPIC_API_KEY".to_string(), require_env("ANTHROPIC_API_KEY")?);
            Ok(env)
        }
        (AgentKind::OpenCode, "openai-api") => {
            let mut env = opencode_isolation_env(auth_context)?;
            env.insert("OPENAI_API_KEY".to_string(), require_env("OPENAI_API_KEY")?);
            Ok(env)
        }
        // Codex reads credentials from CODEX_HOME/auth.json; we materialize an
        // isolated CODEX_HOME the same way production launch_env does.
        (AgentKind::Codex, "openai-api") => {
            let key = require_env("OPENAI_API_KEY")?;
            let mut env = isolation_env(auth_context, &[("CODEX_HOME", "codex-home")])?;
            let codex_home = env.get("CODEX_HOME").expect("codex isolation dir");
            std::fs::write(
                std::path::Path::new(codex_home).join("auth.json"),
                serde_json::json!({ "OPENAI_API_KEY": key }).to_string(),
            )?;
            env.insert("OPENAI_API_KEY".to_string(), key);
            Ok(env)
        }
        _ => bail!(
            "unsupported (agent, auth-context) combination: ({}, {auth_context})",
            agent_kind.as_str()
        ),
    }
}

fn require_env(key: &str) -> Result<String> {
    std::env::var(key).map_err(|_| anyhow!("this auth context requires {key} in the environment"))
}

/// Extract the display name the harness assigned to a (seeded) model id from
/// the raw baseline config options: find the model select option and the
/// entry whose value matches.
fn trial_model_name(baseline_config_options: &serde_json::Value, model_id: &str) -> Option<String> {
    let options = baseline_config_options.as_array()?;
    let model_option = options.iter().find(|option| {
        option.get("id").and_then(|v| v.as_str()) == Some("model")
            || option.get("category").and_then(|v| v.as_str()) == Some("model")
    })?;
    let values = model_option.get("options")?.as_array()?;
    values
        .iter()
        .find(|value| value.get("value").and_then(|v| v.as_str()) == Some(model_id))
        .and_then(|value| value.get("name").and_then(|v| v.as_str()))
        .map(str::to_string)
}

fn opencode_isolation_env(auth_context: &str) -> Result<BTreeMap<String, String>> {
    isolation_env(
        auth_context,
        &[
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_DATA_HOME", "data"),
            ("XDG_CACHE_HOME", "cache"),
            ("XDG_STATE_HOME", "state"),
        ],
    )
}

fn isolation_env(auth_context: &str, vars: &[(&str, &str)]) -> Result<BTreeMap<String, String>> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let base = std::env::temp_dir().join(format!(
        "anyharness-probe-iso-{auth_context}-{}-{nanos}",
        std::process::id()
    ));
    let mut env = BTreeMap::new();
    for (var, dir) in vars {
        let path = base.join(dir);
        std::fs::create_dir_all(&path)?;
        env.insert(var.to_string(), path.to_string_lossy().into_owned());
    }
    Ok(env)
}
