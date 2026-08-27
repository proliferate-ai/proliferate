//! Credential capture, scrubbing, and per-(agent, auth-context) env isolation
//! for `catalog_probe`. Split out of that module so the command's own line
//! count stays under the repo ceiling — this half has no dependency on
//! `ProbeOptions`/`probe_agent` at all, only on `AgentKind` and the process
//! env.

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{anyhow, bail, Context, Result};

use anyharness_lib::domains::agents::model::AgentKind;

/// Isolation roots created for this invocation; removed on drop (any exit
/// path) so credential copies never persist in temp dirs.
#[derive(Default)]
pub struct IsolationDirs(Vec<PathBuf>);

impl Drop for IsolationDirs {
    fn drop(&mut self) {
        for dir in &self.0 {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

pub fn auth_env_for_context(
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
            let mut env = isolation_env(
                auth_context,
                &[("CLAUDE_CONFIG_DIR", "claude-config")],
                isolation_dirs,
            )?;
            // Optional config preset: seed the isolated config dir with a
            // settings.json (experiments / future per-context config presets).
            if let Ok(settings_json) = std::env::var("PROBE_CLAUDE_SETTINGS_JSON") {
                let config_dir = env.get("CLAUDE_CONFIG_DIR").expect("claude isolation dir");
                std::fs::write(
                    std::path::Path::new(config_dir).join("settings.json"),
                    settings_json,
                )?;
            }
            env.insert(
                "ANTHROPIC_API_KEY".to_string(),
                secrets.require("ANTHROPIC_API_KEY")?,
            );
            Ok(env)
        }
        // Claude against AWS Bedrock: same binary, server side is Bedrock's
        // model namespace (us./global. inference profiles), so menus, defaults
        // and model ids are a distinct surface from anthropic-api. Auth is a
        // Bedrock API key (bearer token) — no SigV4 ceremony.
        (AgentKind::Claude, "bedrock") => {
            let mut env = isolation_env(
                auth_context,
                &[("CLAUDE_CONFIG_DIR", "claude-config")],
                isolation_dirs,
            )?;
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
            let mut env = isolation_env(
                auth_context,
                &[("CLAUDE_CONFIG_DIR", "claude-config")],
                isolation_dirs,
            )?;
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
        // OpenCode resolves credentials from env vars, XDG config/auth storage,
        // and provider SDK defaults below HOME (for example ~/.aws). Isolate all
        // of those roots so machine-local provider state cannot pollute auth
        // attribution.
        (AgentKind::OpenCode, "baseline") => opencode_isolation_env(auth_context, isolation_dirs),
        (AgentKind::OpenCode, "anthropic-api") => {
            let mut env = opencode_isolation_env(auth_context, isolation_dirs)?;
            env.insert(
                "ANTHROPIC_API_KEY".to_string(),
                secrets.require("ANTHROPIC_API_KEY")?,
            );
            Ok(env)
        }
        (AgentKind::OpenCode, "openai-api") => {
            let mut env = opencode_isolation_env(auth_context, isolation_dirs)?;
            env.insert(
                "OPENAI_API_KEY".to_string(),
                secrets.require("OPENAI_API_KEY")?,
            );
            Ok(env)
        }
        // OpenCode Zen: opencode's own subscription gateway (provider id
        // "opencode"), keyed by OPENCODE_API_KEY.
        (AgentKind::OpenCode, "opencode-zen") => {
            let mut env = opencode_isolation_env(auth_context, isolation_dirs)?;
            env.insert(
                "OPENCODE_API_KEY".to_string(),
                secrets.require("OPENCODE_API_KEY")?,
            );
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
            let mut env = isolation_env(
                auth_context,
                &[("CODEX_HOME", "codex-home")],
                isolation_dirs,
            )?;
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
            let env = isolation_env(
                auth_context,
                &[("CODEX_HOME", "codex-home")],
                isolation_dirs,
            )?;
            let codex_home = env.get("CODEX_HOME").expect("codex isolation dir");
            std::fs::copy(&source, std::path::Path::new(codex_home).join("auth.json"))
                .with_context(|| format!("failed to copy {source}"))?;
            Ok(env)
        }
        // Codex against AWS Bedrock. NOTE, corrected: codex DOES ship a built-in
        // `amazon-bedrock` upstream provider, so a Bedrock launch normally needs
        // only `model_provider = "amazon-bedrock"` and no
        // `[model_providers.*]` table at all — that is the shape Track D's typed
        // provider-config route renders.
        //
        // The custom provider below is a probe-specific choice, not a statement
        // about codex's capabilities: this probe enumerates what is reachable
        // over /v1/responses, and Bedrock's OpenAI-compatible "mantle" surface is
        // where the OpenAI models live. Mantle model ids are their own namespace
        // (openai.gpt-oss-120b — no Bedrock -1:0 suffix); its Anthropic models do
        // not support /v1/responses and are unreachable from codex.
        (AgentKind::Codex, "bedrock") => {
            let token = secrets.require("AWS_BEARER_TOKEN_BEDROCK")?;
            let mut env = isolation_env(
                auth_context,
                &[("CODEX_HOME", "codex-home")],
                isolation_dirs,
            )?;
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
        // cursor-agent DOES honor CURSOR_API_KEY for ACP sessions (disproven
        // live 2026-07-26). Inject it when supplied; else fall through to the
        // machine's real login (macOS Keychain "Cursor Safe Storage" — not
        // isolatable by HOME), same as before. No separate "cursor-api"
        // context exists in the catalog (grep-confirmed) — cursor-login
        // covers both paths.
        (AgentKind::Cursor, "cursor-login") => {
            let mut env = BTreeMap::new();
            if let Some(key) = secrets.get("CURSOR_API_KEY") {
                env.insert("CURSOR_API_KEY".to_string(), key);
            }
            Ok(env)
        }
        // Grok (xAI Grok Build) speaks ACP natively. Isolate HOME so
        // machine-local config cannot pollute observed values, then inject one
        // explicit API key or copy the selected logged-in auth file.
        (AgentKind::Grok, "xai-api") => {
            let mut env = isolation_env(auth_context, &[("HOME", "home")], isolation_dirs)?;
            if let Some(key) = secrets.get("XAI_API_KEY") {
                env.insert("XAI_API_KEY".to_string(), key);
            } else if let Some(key) = secrets.get("GROK_API_KEY") {
                env.insert("GROK_API_KEY".to_string(), key);
            } else {
                let source = std::env::var("PROBE_GROK_AUTH_JSON").unwrap_or_else(|_| {
                    format!(
                        "{}/.grok/auth.json",
                        std::env::var("HOME").unwrap_or_default()
                    )
                });
                if !std::path::Path::new(&source).is_file() {
                    bail!(
                        "xai-api requires XAI_API_KEY, GROK_API_KEY, or a logged-in Grok \
                         auth.json; not found at {source}"
                    );
                }
                let isolated_home =
                    std::path::Path::new(env.get("HOME").expect("grok isolation home"));
                let grok_dir = isolated_home.join(".grok");
                std::fs::create_dir_all(&grok_dir)?;
                std::fs::copy(&source, grok_dir.join("auth.json"))
                    .with_context(|| format!("failed to copy {source}"))?;
            }
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
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
];

/// Region for bedrock auth contexts; model availability is region-dependent
/// so the snapshot records it via the context env.
fn probe_aws_region() -> String {
    std::env::var("PROBE_AWS_REGION").unwrap_or_else(|_| "us-east-1".to_string())
}

pub struct ProbeSecrets {
    values: BTreeMap<String, String>,
}

impl ProbeSecrets {
    pub fn capture_and_scrub() -> Self {
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

    fn get(&self, key: &str) -> Option<String> {
        self.values.get(key).cloned()
    }
}

/// Extract the display name the harness assigned to a (seeded) model id from
/// the raw baseline config options: find the model select option and the
/// entry whose value matches.
pub fn trial_model_name(
    baseline_config_options: &serde_json::Value,
    model_id: &str,
) -> Option<String> {
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
            ("HOME", "home"),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_isolation_covers_home_and_all_xdg_roots() {
        let mut isolation_dirs = IsolationDirs::default();
        let env = opencode_isolation_env("baseline", &mut isolation_dirs).unwrap();
        let base = isolation_dirs.0[0].clone();

        for key in [
            "HOME",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            "XDG_STATE_HOME",
        ] {
            assert!(std::path::Path::new(&env[key]).is_dir(), "missing {key}");
        }

        drop(isolation_dirs);
        assert!(!base.exists(), "probe isolation must be removed on drop");
    }

    #[test]
    fn cursor_login_arm_injects_a_supplied_cursor_api_key() {
        let secrets = ProbeSecrets {
            values: BTreeMap::from([("CURSOR_API_KEY".to_string(), "sk-cursor-test".to_string())]),
        };
        let mut isolation_dirs = IsolationDirs::default();
        let env = auth_env_for_context(
            &secrets,
            &AgentKind::Cursor,
            "cursor-login",
            &mut isolation_dirs,
        )
        .unwrap();
        assert_eq!(
            env.get("CURSOR_API_KEY").map(String::as_str),
            Some("sk-cursor-test")
        );
    }

    #[test]
    fn cursor_login_arm_falls_through_to_machine_login_without_a_supplied_key() {
        let secrets = ProbeSecrets {
            values: BTreeMap::new(),
        };
        let mut isolation_dirs = IsolationDirs::default();
        let env = auth_env_for_context(
            &secrets,
            &AgentKind::Cursor,
            "cursor-login",
            &mut isolation_dirs,
        )
        .unwrap();
        assert!(
            env.is_empty(),
            "no key supplied: machine login stands, nothing to inject"
        );
    }

    #[test]
    fn grok_context_accepts_the_alternate_api_key_name() {
        let secrets = ProbeSecrets {
            values: BTreeMap::from([("GROK_API_KEY".to_string(), "test-key".to_string())]),
        };
        let mut isolation_dirs = IsolationDirs::default();

        let env = auth_env_for_context(&secrets, &AgentKind::Grok, "xai-api", &mut isolation_dirs)
            .unwrap();

        assert_eq!(
            env.get("GROK_API_KEY").map(String::as_str),
            Some("test-key")
        );
        assert!(!env.contains_key("XAI_API_KEY"));
    }
}
