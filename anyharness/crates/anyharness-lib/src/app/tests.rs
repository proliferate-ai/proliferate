use std::path::PathBuf;
use std::sync::Mutex;

use super::{proliferate_home_dir_name, test_support, AppState};
use crate::{agents::seed::AgentSeedStore, persistence::Db};

#[tokio::test(flavor = "current_thread")]
async fn app_state_allows_missing_bearer_token_when_not_required() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let state = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-no-token"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("expected app state");

    assert_eq!(state.bearer_token, None);
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_rejects_missing_bearer_token_when_required() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-required-token"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        true,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("expected missing bearer token error");

    assert_eq!(
        error.to_string(),
        "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
    );
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_rejects_blank_bearer_token_when_required() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(Some("   "));
    let _data_key_guard = test_support::set_data_key_env(None);

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-blank-token"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        true,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("expected blank bearer token error");

    assert_eq!(
        error.to_string(),
        "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
    );
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_rejects_invalid_data_key() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(Some("not-base64"));

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-invalid-data-key"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("expected invalid data key error");

    assert!(
        error
            .to_string()
            .starts_with("Invalid ANYHARNESS_DATA_KEY:"),
        "unexpected error: {error}"
    );
}

#[test]
fn proliferate_home_dir_name_uses_local_dir_for_debug_builds() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _dev_guard = test_support::set_proliferate_dev_env(None);

    assert_eq!(proliferate_home_dir_name(true), ".proliferate-local");
}

#[test]
fn proliferate_home_dir_name_uses_local_dir_when_env_is_set() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _dev_guard = test_support::set_proliferate_dev_env(Some("1"));

    assert_eq!(proliferate_home_dir_name(false), ".proliferate-local");
}

#[test]
fn proliferate_home_dir_name_uses_production_dir_for_release_without_env() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _dev_guard = test_support::set_proliferate_dev_env(None);

    assert_eq!(proliferate_home_dir_name(false), ".proliferate");
}
