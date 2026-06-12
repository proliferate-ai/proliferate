//! Credential facts: the kind-preserving detection surface for auth-context
//! classification (migration §5.4 layer 1).
//!
//! Facts, never verdicts — detectors report what exists, the pure classifier
//! in `anyharness-lib` decides which auth contexts are active. Secrets rule:
//! `Env` facts are presence-only (values are never read into a fact); values
//! are readable only for `EnvFlag` facts, and the caller is responsible for
//! passing values only for registry-declared flag vars.
//!
//! This module never reads credential material from the process env: the
//! caller hands in env presence (`env_keys`) and flag values (`flag_values`)
//! from the composed launch env. Non-credential *path override* env vars
//! (`CODEX_HOME`, `GEMINI_CLI_HOME`, `XDG_DATA_HOME`,
//! `AWS_SHARED_CREDENTIALS_FILE`) are honored only when `home_dir` matches
//! the process home, mirroring the existing `LocalAuthState` detectors.
//!
//! Discovery kind vocabulary (the open id set; registry slot
//! `discoveryKinds` and catalog v2 `discovery` signals reference these):
//!
//! | kind | meaning |
//! | --- | --- |
//! | `claude-config-api-key` | `sk-ant-` API key in `~/.claude.json(.api)` |
//! | `claude-oauth-creds` | OAuth payload in `~/.claude/.credentials.json` (or legacy file) |
//! | `claude-keychain` | macOS keychain `Claude Code(-credentials)` OAuth entry |
//! | `claude-oauth-account` | `oauthAccount.accountUuid` marker in `~/.claude.json` |
//! | `codex-auth-json-api-key` | `OPENAI_API_KEY` in `~/.codex/auth.json` |
//! | `codex-auth-json-oauth` | `tokens.access_token` in `~/.codex/auth.json` |
//! | `codex-keychain` | macOS keychain `Codex Auth` entry with usable auth |
//! | `gemini-oauth-creds` | tokens in `~/.gemini/oauth_creds.json` |
//! | `gemini-keychain` | macOS keychain `gemini-cli-oauth` entry |
//! | `aws-credential-chain` | env pair, shared-credentials profile, or SSO cache (passive sources only — decisions ledger 12) |
//! | `opencode-auth-json/<provider>` | usable provider entry in opencode's `auth.json` |
//! | `cursor-keychain` | macOS keychain `Cursor Safe Storage` entry |
//!
//! Not emitted: `gemini-settings-api-key` — the existing gemini parser never
//! reads API keys from `settings.json`, so the kind is not distinguishable
//! from current detection and is deferred until a parser exists.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::{aws, claude, codex, cursor, gemini, opencode, DiscoveryError};

/// The exact discovery-kind strings detectors emit. Open vocabulary: new
/// detectors add new constants; consumers match on strings, never on a
/// closed enum.
pub mod fact_kinds {
    pub const CLAUDE_CONFIG_API_KEY: &str = "claude-config-api-key";
    pub const CLAUDE_OAUTH_CREDS: &str = "claude-oauth-creds";
    pub const CLAUDE_KEYCHAIN: &str = "claude-keychain";
    pub const CLAUDE_OAUTH_ACCOUNT: &str = "claude-oauth-account";
    pub const CODEX_AUTH_JSON_API_KEY: &str = "codex-auth-json-api-key";
    pub const CODEX_AUTH_JSON_OAUTH: &str = "codex-auth-json-oauth";
    pub const CODEX_KEYCHAIN: &str = "codex-keychain";
    pub const GEMINI_OAUTH_CREDS: &str = "gemini-oauth-creds";
    pub const GEMINI_KEYCHAIN: &str = "gemini-keychain";
    pub const AWS_CREDENTIAL_CHAIN: &str = "aws-credential-chain";
    /// Per-provider facts are `opencode-auth-json/<provider>`.
    pub const OPENCODE_AUTH_JSON_PREFIX: &str = "opencode-auth-json/";
    pub const CURSOR_KEYCHAIN: &str = "cursor-keychain";
}

/// One observed credential fact. Presence only for secrets: `Env` carries no
/// value, ever; `EnvFlag` values are readable because flag vars are
/// registry-declared non-secrets.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum CredentialFact {
    /// Env var present in the composed launch env (presence only).
    Env { var: String },
    /// Flag env var present with this value (flag vars only).
    EnvFlag { var: String, value: String },
    /// A named local-discovery observation, e.g. `"claude-oauth-creds"`.
    Discovery { kind: String },
}

/// Collect every credential fact observable for `home_dir` plus the
/// caller-provided composed-launch-env view.
///
/// - `env_keys`: names of env vars present in the composed launch env
///   (workspace env + auth overlay) — values are never passed for secrets.
/// - `flag_values`: values of registry-declared *flag* vars only
///   (e.g. `CLAUDE_CODE_USE_BEDROCK=1`). A var listed here emits an
///   `EnvFlag` fact (not a duplicate `Env` fact).
///
/// Detector failures are tolerated per provider (logged, facts skipped):
/// a broken credential file must never poison unrelated providers' facts.
pub fn collect_facts(
    home_dir: &Path,
    env_keys: &BTreeSet<String>,
    flag_values: &BTreeMap<String, String>,
) -> Vec<CredentialFact> {
    let mut facts = Vec::new();

    for var in env_keys {
        if flag_values.contains_key(var) {
            continue;
        }
        facts.push(CredentialFact::Env { var: var.clone() });
    }
    for (var, value) in flag_values {
        facts.push(CredentialFact::EnvFlag {
            var: var.clone(),
            value: value.clone(),
        });
    }
    for kind in discovery_fact_kinds(home_dir, env_keys) {
        facts.push(CredentialFact::Discovery { kind });
    }

    facts
}

fn discovery_fact_kinds(home_dir: &Path, env_keys: &BTreeSet<String>) -> Vec<String> {
    let mut kinds: Vec<String> = Vec::new();
    extend_tolerating(&mut kinds, "claude", claude::discovery_fact_kinds(home_dir));
    extend_tolerating(&mut kinds, "codex", codex::discovery_fact_kinds(home_dir));
    extend_tolerating(&mut kinds, "gemini", gemini::discovery_fact_kinds(home_dir));
    kinds.extend(
        aws::discovery_fact_kinds(home_dir, env_keys)
            .into_iter()
            .map(str::to_string),
    );
    kinds.extend(opencode::discovery_fact_kinds(home_dir));
    kinds.extend(
        cursor::discovery_fact_kinds(home_dir)
            .into_iter()
            .map(str::to_string),
    );
    kinds
}

fn extend_tolerating(
    kinds: &mut Vec<String>,
    provider: &str,
    result: Result<Vec<&'static str>, DiscoveryError>,
) {
    match result {
        Ok(provider_kinds) => kinds.extend(provider_kinds.into_iter().map(str::to_string)),
        Err(err) => {
            tracing::warn!(provider, error = %err, "Credential fact detection failed; skipping provider facts");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn make_temp_home() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-credential-facts-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("create temp home");
        path
    }

    #[test]
    fn collects_env_presence_and_flag_values() {
        let home = make_temp_home();
        let env_keys: BTreeSet<String> = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK"]
            .into_iter()
            .map(str::to_string)
            .collect();
        let flag_values: BTreeMap<String, String> =
            [("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string())]
                .into_iter()
                .collect();

        let facts = collect_facts(&home, &env_keys, &flag_values);

        assert_eq!(
            facts,
            vec![
                CredentialFact::Env {
                    var: "ANTHROPIC_API_KEY".to_string()
                },
                CredentialFact::EnvFlag {
                    var: "CLAUDE_CODE_USE_BEDROCK".to_string(),
                    value: "1".to_string()
                },
            ]
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn collects_kind_preserving_discovery_facts() {
        let home = make_temp_home();
        fs::create_dir_all(home.join(".claude")).expect("create claude dir");
        fs::write(
            home.join(".claude/.credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"token"}}"#,
        )
        .expect("write oauth creds");
        fs::write(
            home.join(".claude.json"),
            r#"{"primaryApiKey":"sk-ant-123"}"#,
        )
        .expect("write claude config");

        let facts = collect_facts(&home, &BTreeSet::new(), &BTreeMap::new());

        assert_eq!(
            facts,
            vec![
                CredentialFact::Discovery {
                    kind: fact_kinds::CLAUDE_CONFIG_API_KEY.to_string()
                },
                CredentialFact::Discovery {
                    kind: fact_kinds::CLAUDE_OAUTH_CREDS.to_string()
                },
            ]
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn aws_env_pair_surfaces_as_discovery_fact() {
        let home = make_temp_home();
        let env_keys: BTreeSet<String> = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
            .into_iter()
            .map(str::to_string)
            .collect();

        let facts = collect_facts(&home, &env_keys, &BTreeMap::new());

        assert!(facts.contains(&CredentialFact::Discovery {
            kind: fact_kinds::AWS_CREDENTIAL_CHAIN.to_string()
        }));

        let _ = fs::remove_dir_all(home);
    }
}
