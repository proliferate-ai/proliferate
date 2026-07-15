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
    /// Agent kind to probe (claude, codex, cursor, opencode, grok)
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
    if !args.trial_models.is_empty() && agent_kind != AgentKind::Claude {
        anyhow::bail!("--trial-model is currently supported for claude only");
    }
    let secrets = ProbeSecrets::capture_and_scrub();
    let mut isolation_dirs = IsolationDirs::default();
    let auth_env =
        auth_env_for_context(&secrets, &agent_kind, &args.auth_context, &mut isolation_dirs)?;

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
        let trial_env =
            auth_env_for_context(&secrets, &agent_kind, &args.auth_context, &mut isolation_dirs)?;
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

/// Isolation roots created for this invocation; removed on drop (any exit
/// path) so credential copies never persist in temp dirs.
#[derive(Default)]
struct IsolationDirs(Vec<PathBuf>);

impl Drop for IsolationDirs {
    fn drop(&mut self) {
        for dir in &self.0 {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

fn auth_env_for_context(
    secrets: &ProbeSecrets,
    agent_kind: &AgentKind,
    auth_context: &str,
    isolation_dirs: &mut IsolationDirs,
) -> Result<BTreeMap<String, String>> {
    match (agent_kind, auth_context) {
        (AgentKind::Claude, "anthropic-api") => {
            // Isolate the Claude config dir so machine-local settings
            // (default model, effort preference) can't pollute observed
            // values; mirrors production's gateway CLAUDE_CONFIG_DIR usage.
            let mut env = isolation_env(auth_context, &[("CLAUDE_CONFIG_DIR", "claude-config")], isolation_dirs)?;
            // Optional config preset: seed the isolated config dir with a
            // settings.json (experiments / future per-context config presets).
            if let Ok(settings_json) = std::env::var("PROBE_CLAUDE_SETTINGS_JSON") {
                let config_dir = env.get("CLAUDE_CONFIG_DIR").expect("claude isolation dir");
                std::fs::write(
                    std::path::Path::new(config_dir).join("settings.json"),
                    settings_json,
                )?;
            }
            env.insert("ANTHROPIC_API_KEY".to_string(), secrets.require("ANTHROPIC_API_KEY")?);
            Ok(env)
        }
        // Claude against AWS Bedrock: same binary, server side is Bedrock's
        // model namespace (us./global. inference profiles), so menus, defaults
        // and model ids are a distinct surface from anthropic-api. Auth is a
        // Bedrock API key (bearer token) — no SigV4 ceremony.
        (AgentKind::Claude, "bedrock") => {
            let mut env = isolation_env(auth_context, &[("CLAUDE_CONFIG_DIR", "claude-config")], isolation_dirs)?;
            env.insert(
                "AWS_BEARER_TOKEN_BEDROCK".to_string(),
                secrets.require("AWS_BEARER_TOKEN_BEDROCK")?,
            );
            env.insert("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string());
            env.insert("AWS_REGION".to_string(), probe_aws_region());
            Ok(env)
        }
        // Claude under subscription OAuth: requires a credentials file
        // produced by `claude setup-token` (or copied from a logged-in
        // ~/.claude/.credentials.json). We copy it into an isolated config
        // dir so nothing else from the machine leaks in.
        (AgentKind::Claude, "anthropic-oauth") => {
            let mut env = isolation_env(auth_context, &[("CLAUDE_CONFIG_DIR", "claude-config")], isolation_dirs)?;
            if let Ok(token) = secrets.require("CLAUDE_CODE_OAUTH_TOKEN") {
                // Long-lived token from `claude setup-token`.
                env.insert("CLAUDE_CODE_OAUTH_TOKEN".to_string(), token);
            } else if let Ok(credentials_path) = std::env::var("PROBE_CLAUDE_OAUTH_CREDENTIALS") {
                let config_dir = env.get("CLAUDE_CONFIG_DIR").expect("claude isolation dir");
                std::fs::copy(
                    &credentials_path,
                    std::path::Path::new(config_dir).join(".credentials.json"),
                )
                .with_context(|| format!("failed to copy {credentials_path}"))?;
            } else {
                bail!(
                    "auth context anthropic-oauth requires CLAUDE_CODE_OAUTH_TOKEN \
                     (from `claude setup-token`) or PROBE_CLAUDE_OAUTH_CREDENTIALS=\
                     /path/to/.credentials.json"
                );
            }
            Ok(env)
        }
        // OpenCode resolves credentials from env vars AND its own config/auth
        // storage (XDG dirs), so every opencode context isolates those dirs —
        // otherwise machine-local opencode.jsonc / auth.json would pollute the
        // auth attribution.
        (AgentKind::OpenCode, "baseline") => opencode_isolation_env(auth_context, isolation_dirs),
        (AgentKind::OpenCode, "anthropic-api") => {
            let mut env = opencode_isolation_env(auth_context, isolation_dirs)?;
            env.insert("ANTHROPIC_API_KEY".to_string(), secrets.require("ANTHROPIC_API_KEY")?);
            Ok(env)
        }
        (AgentKind::OpenCode, "openai-api") => {
            let mut env = opencode_isolation_env(auth_context, isolation_dirs)?;
            env.insert("OPENAI_API_KEY".to_string(), secrets.require("OPENAI_API_KEY")?);
            Ok(env)
        }
        // OpenCode Zen: opencode's own subscription gateway (provider id
        // "opencode"), keyed by OPENCODE_API_KEY.
        (AgentKind::OpenCode, "opencode-zen") => {
            let mut env = opencode_isolation_env(auth_context, isolation_dirs)?;
            env.insert("OPENCODE_API_KEY".to_string(), secrets.require("OPENCODE_API_KEY")?);
            Ok(env)
        }
        (AgentKind::OpenCode, "gemini-api") => {
            let key = secrets.require("GEMINI_API_KEY")?;
            let mut env = opencode_isolation_env(auth_context, isolation_dirs)?;
            // opencode's google provider scans either var; set both.
            env.insert("GEMINI_API_KEY".to_string(), key.clone());
            env.insert("GOOGLE_GENERATIVE_AI_API_KEY".to_string(), key);
            Ok(env)
        }
        // Codex reads credentials from CODEX_HOME/auth.json; we materialize an
        // isolated CODEX_HOME the same way production launch_env does.
        (AgentKind::Codex, "openai-api") => {
            let key = secrets.require("OPENAI_API_KEY")?;
            let mut env = isolation_env(auth_context, &[("CODEX_HOME", "codex-home")], isolation_dirs)?;
            let codex_home = env.get("CODEX_HOME").expect("codex isolation dir");
            std::fs::write(
                std::path::Path::new(codex_home).join("auth.json"),
                serde_json::json!({ "OPENAI_API_KEY": key }).to_string(),
            )?;
            env.insert("OPENAI_API_KEY".to_string(), key);
            Ok(env)
        }
        // ChatGPT-subscription auth: copy a logged-in auth.json (from
        // `codex login`) into an isolated CODEX_HOME.
        (AgentKind::Codex, "openai-oauth") => {
            let source = std::env::var("PROBE_CODEX_OAUTH_AUTH_JSON").unwrap_or_else(|_| {
                format!(
                    "{}/.codex/auth.json",
                    std::env::var("HOME").unwrap_or_default()
                )
            });
            if !std::path::Path::new(&source).exists() {
                bail!("openai-oauth requires a logged-in codex auth.json (run `codex login`); not found at {source}");
            }
            let env = isolation_env(auth_context, &[("CODEX_HOME", "codex-home")], isolation_dirs)?;
            let codex_home = env.get("CODEX_HOME").expect("codex isolation dir");
            std::fs::copy(&source, std::path::Path::new(codex_home).join("auth.json"))
                .with_context(|| format!("failed to copy {source}"))?;
            Ok(env)
        }
        // Codex against AWS Bedrock: codex has no native Bedrock support and
        // only speaks the Responses API (wire_api "chat" was removed), so we
        // point a custom model_provider at Bedrock's OpenAI-compatible
        // "mantle" surface, which serves /v1/responses for OpenAI models.
        // Mantle model ids are their own namespace (openai.gpt-oss-120b — no
        // Bedrock -1:0 suffix); its Anthropic models do not support
        // /v1/responses and are unreachable from codex.
        (AgentKind::Codex, "bedrock") => {
            let token = secrets.require("AWS_BEARER_TOKEN_BEDROCK")?;
            let mut env = isolation_env(auth_context, &[("CODEX_HOME", "codex-home")], isolation_dirs)?;
            let codex_home = env.get("CODEX_HOME").expect("codex isolation dir");
            let config = format!(
                r#"model = "openai.gpt-oss-120b"
model_provider = "bedrock"

[model_providers.bedrock]
name = "Amazon Bedrock"
base_url = "https://bedrock-mantle.{region}.api.aws/v1"
env_key = "AWS_BEARER_TOKEN_BEDROCK"
wire_api = "responses"
"#,
                region = probe_aws_region(),
            );
            std::fs::write(std::path::Path::new(codex_home).join("config.toml"), config)?;
            env.insert("AWS_BEARER_TOKEN_BEDROCK".to_string(), token);
            Ok(env)
        }
        // cursor-agent's ACP session services ignore CURSOR_API_KEY and
        // require a machine login (auth in macOS Keychain "Cursor Safe
        // Storage" — not isolatable by HOME). Probe runs under the real
        // machine login; acceptable because cursor is single-provider so
        // there is no cross-provider auth attribution to pollute.
        (AgentKind::Cursor, "cursor-login") => Ok(BTreeMap::new()),
        (AgentKind::Cursor, "cursor-api") => bail!(
            "cursor-agent ignores CURSOR_API_KEY for ACP sessions; run `cursor-agent login` \
             on this machine and use --auth-context cursor-login instead"
        ),
        // Grok (xAI Grok Build) speaks ACP natively and authenticates from
        // XAI_API_KEY. Isolate HOME so machine-local ~/.grok config (default
        // model, cached login) cannot pollute observed values.
        (AgentKind::Grok, "xai-api") => {
            let key = secrets.require("XAI_API_KEY")?;
            let mut env = isolation_env(auth_context, &[("HOME", "home")], isolation_dirs)?;
            env.insert("XAI_API_KEY".to_string(), key);
            Ok(env)
        }
        _ => bail!(
            "unsupported (agent, auth-context) combination: ({}, {auth_context})",
            agent_kind.as_str()
        ),
    }
}

/// Credential env vars the probe knows about. Captured once at startup, then
/// REMOVED from the process environment so spawned agents can only ever see
/// the credentials their auth context explicitly injects — otherwise a shell
/// with several provider keys exported (e.g. `source secrets.env`) silently
/// enables every provider in every run and corrupts auth attribution.
const CREDENTIAL_ENV_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_API_KEY",
    "CURSOR_API_KEY",
    "OPENCODE_API_KEY",
    "XAI_API_KEY",
    "GROK_API_KEY",
    "AWS_BEARER_TOKEN_BEDROCK",
    // Ambient SigV4 credentials must not reach spawned agents either: some
    // harnesses (e.g. opencode's amazon-bedrock provider) auto-detect them
    // and would silently enable Bedrock in non-bedrock contexts.
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
];

/// Region for bedrock auth contexts; model availability is region-dependent
/// so the snapshot records it via the context env.
fn probe_aws_region() -> String {
    std::env::var("PROBE_AWS_REGION").unwrap_or_else(|_| "us-east-1".to_string())
}

struct ProbeSecrets {
    values: BTreeMap<String, String>,
}

impl ProbeSecrets {
    fn capture_and_scrub() -> Self {
        let mut values = BTreeMap::new();
        for key in CREDENTIAL_ENV_VARS {
            if let Ok(value) = std::env::var(key) {
                values.insert((*key).to_string(), value);
            }
            std::env::remove_var(key);
        }
        Self { values }
    }

    fn require(&self, key: &str) -> Result<String> {
        self.values
            .get(key)
            .cloned()
            .ok_or_else(|| anyhow!("this auth context requires {key} in the environment"))
    }
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
    let raw = model_option.get("options")?.as_array()?;
    // Entries are either select options ({value, name}) or groups
    // ({..., options: [...]}); flatten both shapes.
    let mut entries: Vec<&serde_json::Value> = Vec::new();
    for entry in raw {
        if entry.get("value").is_some() {
            entries.push(entry);
        } else if let Some(group) = entry.get("options").and_then(|v| v.as_array()) {
            entries.extend(group.iter());
        }
    }
    entries
        .iter()
        .find(|value| value.get("value").and_then(|v| v.as_str()) == Some(model_id))
        .and_then(|value| value.get("name").and_then(|v| v.as_str()))
        .map(str::to_string)
}

fn opencode_isolation_env(
    auth_context: &str,
    isolation_dirs: &mut IsolationDirs,
) -> Result<BTreeMap<String, String>> {
    isolation_env(
        auth_context,
        &[
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_DATA_HOME", "data"),
            ("XDG_CACHE_HOME", "cache"),
            ("XDG_STATE_HOME", "state"),
        ],
        isolation_dirs,
    )
}

fn isolation_env(
    auth_context: &str,
    vars: &[(&str, &str)],
    isolation_dirs: &mut IsolationDirs,
) -> Result<BTreeMap<String, String>> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let base = std::env::temp_dir().join(format!(
        "anyharness-probe-iso-{auth_context}-{}-{nanos}",
        std::process::id()
    ));
    isolation_dirs.0.push(base.clone());
    let mut env = BTreeMap::new();
    for (var, dir) in vars {
        let path = base.join(dir);
        std::fs::create_dir_all(&path)?;
        env.insert(var.to_string(), path.to_string_lossy().into_owned());
    }
    Ok(env)
}
