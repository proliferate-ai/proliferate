//! AWS credential-chain detection: passive sources only (decisions ledger
//! 12) — the env pair, the bedrock bearer token env var, a
//! shared-credentials profile, or an SSO token cache.
//! The exotic tail of the real AWS chain (IMDS, process credentials,
//! container credentials) is deliberately NOT detected here: it is proven by
//! launch/trial, never by detection — "menus lie, inference proves."
//! No network access, ever.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::facts::fact_kinds;
use crate::util::resolve_process_override_path;

const AWS_ACCESS_KEY_ID: &str = "AWS_ACCESS_KEY_ID";
const AWS_SECRET_ACCESS_KEY: &str = "AWS_SECRET_ACCESS_KEY";
const AWS_BEARER_TOKEN_BEDROCK: &str = "AWS_BEARER_TOKEN_BEDROCK";
const AWS_SHARED_CREDENTIALS_FILE: &str = "AWS_SHARED_CREDENTIALS_FILE";

/// Emits `aws-credential-chain` iff any passive chain source is present.
/// `env_keys` is the caller-provided composed-launch-env presence set (this
/// crate never reads credential env vars from the process env).
pub(crate) fn discovery_fact_kinds(
    home_dir: &Path,
    env_keys: &BTreeSet<String>,
) -> Vec<&'static str> {
    let paths = AwsChainPaths::resolve(home_dir);
    if chain_present(env_keys, &paths) {
        vec![fact_kinds::AWS_CREDENTIAL_CHAIN]
    } else {
        Vec::new()
    }
}

/// The filesystem sources of the passive chain. Separated from resolution so
/// tests can inject temp paths directly.
pub(crate) struct AwsChainPaths {
    pub(crate) credentials_file: PathBuf,
    pub(crate) sso_cache_dir: PathBuf,
}

impl AwsChainPaths {
    /// `AWS_SHARED_CREDENTIALS_FILE` is a path override (not a credential),
    /// honored only when `home_dir` is the process home — mirroring how the
    /// `LocalAuthState` detectors treat `CODEX_HOME`/`GEMINI_CLI_HOME`.
    pub(crate) fn resolve(home_dir: &Path) -> Self {
        let default_credentials_file = home_dir.join(".aws").join("credentials");
        Self {
            credentials_file: resolve_process_override_path(
                AWS_SHARED_CREDENTIALS_FILE,
                home_dir,
                default_credentials_file,
            ),
            sso_cache_dir: home_dir.join(".aws").join("sso").join("cache"),
        }
    }
}

pub(crate) fn chain_present(env_keys: &BTreeSet<String>, paths: &AwsChainPaths) -> bool {
    env_pair_present(env_keys)
        || env_keys.contains(AWS_BEARER_TOKEN_BEDROCK)
        || credentials_file_has_profile(&paths.credentials_file)
        || sso_cache_has_json(&paths.sso_cache_dir)
}

fn env_pair_present(env_keys: &BTreeSet<String>) -> bool {
    env_keys.contains(AWS_ACCESS_KEY_ID) && env_keys.contains(AWS_SECRET_ACCESS_KEY)
}

/// At least one `[profile]` section header. Read failures (missing file,
/// permissions) are facts of absence, never errors.
fn credentials_file_has_profile(path: &Path) -> bool {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return false;
    };
    contents.lines().any(|line| {
        let line = line.trim();
        line.len() > 2 && line.starts_with('[') && line.ends_with(']')
    })
}

fn sso_cache_has_json(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry
            .path()
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn make_temp_home() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-aws-credential-discovery-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("create temp home");
        path
    }

    fn env_keys(keys: &[&str]) -> BTreeSet<String> {
        keys.iter().map(|key| (*key).to_string()).collect()
    }

    #[test]
    fn detects_env_pair_but_not_partial_pair() {
        let home = make_temp_home();
        let paths = AwsChainPaths::resolve(&home);

        assert!(chain_present(
            &env_keys(&["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]),
            &paths
        ));
        assert!(!chain_present(&env_keys(&["AWS_ACCESS_KEY_ID"]), &paths));
        assert!(!chain_present(
            &env_keys(&["AWS_SECRET_ACCESS_KEY"]),
            &paths
        ));

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn detects_bedrock_bearer_token_env() {
        let home = make_temp_home();
        let paths = AwsChainPaths::resolve(&home);

        assert!(chain_present(
            &env_keys(&["AWS_BEARER_TOKEN_BEDROCK"]),
            &paths
        ));

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn detects_shared_credentials_file_with_profile_section() {
        let home = make_temp_home();
        fs::create_dir_all(home.join(".aws")).expect("create aws dir");
        fs::write(
            home.join(".aws/credentials"),
            "[default]\naws_access_key_id = AKIA\naws_secret_access_key = secret\n",
        )
        .expect("write credentials");

        assert_eq!(
            discovery_fact_kinds(&home, &BTreeSet::new()),
            vec![fact_kinds::AWS_CREDENTIAL_CHAIN]
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn ignores_credentials_file_without_profile_sections() {
        let home = make_temp_home();
        fs::create_dir_all(home.join(".aws")).expect("create aws dir");
        fs::write(home.join(".aws/credentials"), "# empty\n\n").expect("write credentials");

        assert!(discovery_fact_kinds(&home, &BTreeSet::new()).is_empty());

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn honors_injected_credentials_file_path() {
        let home = make_temp_home();
        let injected = home.join("custom-credentials");
        fs::write(&injected, "[work]\naws_access_key_id = AKIA\n").expect("write credentials");

        let paths = AwsChainPaths {
            credentials_file: injected,
            sso_cache_dir: home.join(".aws/sso/cache"),
        };
        assert!(chain_present(&BTreeSet::new(), &paths));

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn detects_sso_cache_json_only() {
        let home = make_temp_home();
        let cache_dir = home.join(".aws/sso/cache");
        fs::create_dir_all(&cache_dir).expect("create sso cache dir");
        fs::write(cache_dir.join("notes.txt"), "not a token").expect("write non-json");

        assert!(discovery_fact_kinds(&home, &BTreeSet::new()).is_empty());

        fs::write(cache_dir.join("abc123.json"), r#"{"accessToken":"t"}"#)
            .expect("write sso token");
        assert_eq!(
            discovery_fact_kinds(&home, &BTreeSet::new()),
            vec![fact_kinds::AWS_CREDENTIAL_CHAIN]
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn absent_when_no_passive_source_exists() {
        let home = make_temp_home();
        assert!(discovery_fact_kinds(&home, &BTreeSet::new()).is_empty());
        let _ = fs::remove_dir_all(home);
    }
}
