//! The credential ladder matrix.
//!
//! Two projection laws from agent-distribution.md, "Readiness projection":
//!
//!   (a) "An env credential counts only if the variable is set **and non-empty**;
//!       `ANTHROPIC_API_KEY=\"\"` is absent, not present."
//!   (b) "Credential detection reads only the workspace's composed env plus
//!       registry-declared variables — never the host process's ambient
//!       environment at large, so a global var on the machine cannot make every
//!       workspace look authenticated."
//!
//! Each slot's ladder has four rungs — declared env in scope, provider-specific
//! local discovery, login policy, missing — and the matrix below enumerates every
//! rung against every env-value shape and both scopes, rather than only the cells
//! that happen to have bitten us.
//!
//! Split from `credentials_tests.rs` to stay under the repo line-count ceiling;
//! nested inside it so the `make_temp_home`/`test_login_spec` helpers and the
//! module-under-test's items are both in scope.

// The parent test module's helpers (`make_temp_home`, `test_login_spec`).
use super::*;
// The module under test plus the model types its signatures use, which the
// parent reaches through its own `use super::*`.
use super::super::{
    detect_auth_slots_with_env, detect_credentials, detect_credentials_with_env,
    AuthReadinessPolicy, AuthSlotSpec, AuthSpec, CredentialDiscoveryKind, CredentialState,
};
use std::collections::BTreeMap;

/// Serializes the tests below. They set and clear process-global variables, and
/// the host-scope cases read whatever the process env holds, so an interleaving
/// with any other env-mutating suite is a false result. This is the crate-wide
/// lock every such test takes.
use crate::app::test_support::lock_env_blocking;

/// Set or remove a var for the test's lifetime and restore it on drop, so the
/// matrix below is deterministic on a developer machine that exports provider
/// keys.
struct AmbientVarGuard {
    name: &'static str,
    original: Option<std::ffi::OsString>,
}

impl AmbientVarGuard {
    fn set(name: &'static str, value: &str) -> Self {
        let original = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, original }
    }

    fn remove(name: &'static str) -> Self {
        let original = std::env::var_os(name);
        std::env::remove_var(name);
        Self { name, original }
    }
}

impl Drop for AmbientVarGuard {
    fn drop(&mut self) {
        match &self.original {
            Some(value) => std::env::set_var(self.name, value),
            None => std::env::remove_var(self.name),
        }
    }
}

const LADDER_VAR: &str = "ANYHARNESS_LADDER_TEST_KEY";

/// One env-declaring slot with no discovery and no login: the state it reports is
/// exactly "did the declared variable count", with no other rung to mask it.
fn env_only_auth() -> AuthSpec {
    AuthSpec {
        readiness_policy: AuthReadinessPolicy::AnyRequiredSlot,
        slots: vec![AuthSlotSpec {
            id: "env-only".into(),
            label: "Env only".into(),
            credential_provider_ids: vec!["test".into()],
            required_for_readiness: true,
            env_vars: vec![LADDER_VAR.into()],
            login: None,
            discovery: CredentialDiscoveryKind::None,
            materialization: Default::default(),
        }],
    }
}

fn workspace_env(value: &str) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    env.insert(LADDER_VAR.to_string(), value.to_string());
    env
}

/// Law (a), workspace scope: only a non-empty value is a credential. Empty and
/// whitespace-only are absent — `KEY=` in an env file parses to the empty string
/// and no provider accepts it.
#[test]
fn workspace_env_var_counts_only_when_non_empty() {
    let _env = lock_env_blocking();
    let home = make_temp_home();
    let _ambient = AmbientVarGuard::remove(LADDER_VAR);
    let auth = env_only_auth();

    for (value, expected) in [
        ("sk-real", CredentialState::Ready),
        ("", CredentialState::MissingEnv),
        ("   ", CredentialState::MissingEnv),
        ("\t\n", CredentialState::MissingEnv),
    ] {
        assert_eq!(
            detect_credentials_with_env(&auth, &home, &workspace_env(value)),
            expected,
            "workspace {LADDER_VAR}={value:?}"
        );
    }

    // An absent key is likewise missing, not inherited from anywhere.
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &BTreeMap::new()),
        CredentialState::MissingEnv
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// Law (a), host scope: the non-empty rule is a property of the ladder, not of
/// one caller, so the host-ambient read enforces it identically.
#[test]
fn host_ambient_env_var_counts_only_when_non_empty() {
    let _env = lock_env_blocking();
    let home = make_temp_home();
    let auth = env_only_auth();

    {
        let _ambient = AmbientVarGuard::set(LADDER_VAR, "sk-real");
        assert_eq!(detect_credentials(&auth, &home), CredentialState::Ready);
    }
    {
        let _ambient = AmbientVarGuard::set(LADDER_VAR, "");
        assert_eq!(
            detect_credentials(&auth, &home),
            CredentialState::MissingEnv,
            "an exported-but-empty var is absent"
        );
    }
    {
        let _ambient = AmbientVarGuard::set(LADDER_VAR, "  ");
        assert_eq!(
            detect_credentials(&auth, &home),
            CredentialState::MissingEnv
        );
    }
    {
        let _ambient = AmbientVarGuard::remove(LADDER_VAR);
        assert_eq!(
            detect_credentials(&auth, &home),
            CredentialState::MissingEnv
        );
    }

    let _ = std::fs::remove_dir_all(&home);
}

/// Law (b), the leak this closes: a variable exported on the host must NOT make
/// a workspace-scoped check read `Ready`. Before this, an empty composed env fell
/// back to the ambient process env, so one global export authenticated every
/// workspace on the machine.
#[test]
fn a_host_exported_var_never_authenticates_a_workspace() {
    let _env = lock_env_blocking();
    let home = make_temp_home();
    let _ambient = AmbientVarGuard::set(LADDER_VAR, "host-global-key");
    let auth = env_only_auth();

    // Empty composed env: the old code's ambient fallback fired exactly here.
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &BTreeMap::new()),
        CredentialState::MissingEnv
    );
    // Non-empty composed env that simply does not declare the var: same answer.
    let mut unrelated = BTreeMap::new();
    unrelated.insert("SOME_OTHER_VAR".to_string(), "value".to_string());
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &unrelated),
        CredentialState::MissingEnv
    );
    // And the workspace's own value is what counts when it HAS one — the host's
    // value is not consulted even as a tiebreak.
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &workspace_env("workspace-key")),
        CredentialState::Ready
    );
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &workspace_env("")),
        CredentialState::MissingEnv,
        "an empty workspace value must not fall through to the host's non-empty one"
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// The rungs below env, enumerated: with the declared var absent-or-empty in
/// scope, the answer comes from discovery, then login policy, then missing —
/// and an empty env value must not skip past discovery either.
#[test]
fn ladder_falls_through_env_to_discovery_then_login_then_missing() {
    let _env = lock_env_blocking();
    let _ambient = AmbientVarGuard::remove(LADDER_VAR);

    let with_discovery_and_login = AuthSpec {
        readiness_policy: AuthReadinessPolicy::AnyRequiredSlot,
        slots: vec![AuthSlotSpec {
            id: "claude".into(),
            label: "Claude".into(),
            credential_provider_ids: vec!["anthropic".into()],
            required_for_readiness: true,
            env_vars: vec![LADDER_VAR.into()],
            login: Some(test_login_spec()),
            discovery: CredentialDiscoveryKind::Claude,
            materialization: Default::default(),
        }],
    };

    // Rung 2: valid local auth on disk, env empty -> ready via local auth.
    let home = make_temp_home();
    std::fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    std::fs::write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"token","expiresAt":2840000000000}}"#,
    )
    .expect("write claude creds");
    let (aggregate, slots) =
        detect_auth_slots_with_env(&with_discovery_and_login, &home, &workspace_env(""));
    assert_eq!(aggregate, CredentialState::Ready);
    assert_eq!(
        slots[0].credential_state,
        CredentialState::ReadyViaLocalAuth,
        "an empty env value must fall THROUGH to discovery, not short-circuit Ready"
    );
    let _ = std::fs::remove_dir_all(&home);

    // Rung 2, expired: discovery answers LoginRequired even though a login exists.
    let home = make_temp_home();
    std::fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    std::fs::write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"token","expiresAt":1000}}"#,
    )
    .expect("write expired creds");
    assert_eq!(
        detect_credentials_with_env(&with_discovery_and_login, &home, &workspace_env("")),
        CredentialState::LoginRequired
    );
    let _ = std::fs::remove_dir_all(&home);

    // Rung 3: nothing on disk, but a login path exists -> LoginRequired.
    let home = make_temp_home();
    assert_eq!(
        detect_credentials_with_env(&with_discovery_and_login, &home, &workspace_env("")),
        CredentialState::LoginRequired
    );

    // Rung 4: no discovery, no login -> MissingEnv.
    assert_eq!(
        detect_credentials_with_env(&env_only_auth(), &home, &workspace_env("")),
        CredentialState::MissingEnv
    );

    // Rung 1 still wins over every rung below it when the value is real.
    assert_eq!(
        detect_credentials_with_env(&with_discovery_and_login, &home, &workspace_env("sk-real")),
        CredentialState::Ready
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// A slot declaring several variables is satisfied by ANY non-empty one, and by
/// none of them when they are all empty — the `.any()` must be over the non-empty
/// predicate, not over mere presence.
#[test]
fn multi_var_slot_needs_one_non_empty_value() {
    let _env = lock_env_blocking();
    let home = make_temp_home();
    let _first = AmbientVarGuard::remove("ANYHARNESS_LADDER_A");
    let _second = AmbientVarGuard::remove("ANYHARNESS_LADDER_B");
    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::AnyRequiredSlot,
        slots: vec![AuthSlotSpec {
            id: "multi".into(),
            label: "Multi".into(),
            credential_provider_ids: vec!["test".into()],
            required_for_readiness: true,
            env_vars: vec!["ANYHARNESS_LADDER_A".into(), "ANYHARNESS_LADDER_B".into()],
            login: None,
            discovery: CredentialDiscoveryKind::None,
            materialization: Default::default(),
        }],
    };

    let mut both_empty = BTreeMap::new();
    both_empty.insert("ANYHARNESS_LADDER_A".to_string(), String::new());
    both_empty.insert("ANYHARNESS_LADDER_B".to_string(), "   ".to_string());
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &both_empty),
        CredentialState::MissingEnv
    );

    let mut second_only = both_empty.clone();
    second_only.insert("ANYHARNESS_LADDER_B".to_string(), "sk-real".to_string());
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &second_only),
        CredentialState::Ready
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// `AllRequiredSlots` must not be satisfiable by an empty value in one slot:
/// the per-slot non-empty rule has to hold before aggregation sees it.
#[test]
fn all_required_slots_rejects_an_empty_value_in_any_slot() {
    let _env = lock_env_blocking();
    let home = make_temp_home();
    let _first = AmbientVarGuard::remove("ANYHARNESS_LADDER_A");
    let _second = AmbientVarGuard::remove("ANYHARNESS_LADDER_B");
    let slot = |id: &str, var: &str| AuthSlotSpec {
        id: id.into(),
        label: id.into(),
        credential_provider_ids: vec!["test".into()],
        required_for_readiness: true,
        env_vars: vec![var.into()],
        login: None,
        discovery: CredentialDiscoveryKind::None,
        materialization: Default::default(),
    };
    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::AllRequiredSlots,
        slots: vec![
            slot("a", "ANYHARNESS_LADDER_A"),
            slot("b", "ANYHARNESS_LADDER_B"),
        ],
    };

    let mut env = BTreeMap::new();
    env.insert("ANYHARNESS_LADDER_A".to_string(), "sk-real".to_string());
    env.insert("ANYHARNESS_LADDER_B".to_string(), String::new());
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &env),
        CredentialState::MissingEnv
    );

    env.insert(
        "ANYHARNESS_LADDER_B".to_string(),
        "sk-also-real".to_string(),
    );
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &env),
        CredentialState::Ready
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// `None`'s structural Ready stays structurally always-Ready: the ladder
/// tightening must not turn a harness with no local auth requirement at all
/// into a credential gap.
#[test]
fn none_policy_stays_ready_under_the_tightened_ladder() {
    let _env = lock_env_blocking();
    let home = make_temp_home();
    let _ambient = AmbientVarGuard::remove(LADDER_VAR);

    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::None,
        slots: vec![AuthSlotSpec {
            id: "slot".into(),
            label: "Slot".into(),
            credential_provider_ids: vec!["test".into()],
            required_for_readiness: false,
            env_vars: vec![LADDER_VAR.into()],
            login: None,
            discovery: CredentialDiscoveryKind::OpenCode,
            materialization: Default::default(),
        }],
    };
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &workspace_env("")),
        CredentialState::Ready,
        "None is structurally Ready"
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// A9 fix: `ProviderManaged` is NO LONGER structurally always-Ready like
/// `None` — it reads its slots' actual ladder state (opencode's selection
/// set is its real auth truth, agent-auth.md "Readiness interplay"). With no
/// credential anywhere in scope, it reads the same missing-credential state
/// any other policy would.
#[test]
fn provider_managed_follows_its_slot_ladder_under_the_tightened_ladder() {
    let _env = lock_env_blocking();
    let home = make_temp_home();
    let _ambient = AmbientVarGuard::remove(LADDER_VAR);

    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::ProviderManaged,
        slots: vec![AuthSlotSpec {
            id: "slot".into(),
            label: "Slot".into(),
            credential_provider_ids: vec!["test".into()],
            required_for_readiness: false,
            env_vars: vec![LADDER_VAR.into()],
            login: None,
            discovery: CredentialDiscoveryKind::OpenCode,
            materialization: Default::default(),
        }],
    };

    assert_eq!(
        detect_credentials_with_env(&auth, &home, &workspace_env("")),
        CredentialState::MissingEnv,
        "no credential anywhere in scope: ProviderManaged reads the slot's real state"
    );
    assert_eq!(
        detect_credentials_with_env(&auth, &home, &workspace_env("sk-real")),
        CredentialState::Ready,
        "a selected credential in scope: ProviderManaged reads Ready"
    );

    let _ = std::fs::remove_dir_all(&home);
}
