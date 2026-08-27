//! The native-migration bridge suite (see `native_bridge.rs`), split out
//! to keep the module under the repo line cap.

use super::super::profile::AgentRuntimeAuthProfile;
use super::super::{
    render_profile, resolve_profile_bridged, AbsentHarnessPolicy, GatewayModelPlan,
    RouteAuthError,
};
use super::*;

const ALL_KINDS: &[&str] = &["claude", "codex", "cursor", "opencode", "grok"];

fn temp_home(prefix: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&path).expect("create temp home");
    path
}

fn document(present: &[(&str, bool)]) -> AgentAuthState {
    let harnesses: Vec<serde_json::Value> = present
        .iter()
        .map(|(kind, satisfiable)| {
            let sources = if *satisfiable {
                serde_json::json!([{ "kind": "gateway", "base_url": "https://llm.example", "key": "sk-vk" }])
            } else {
                serde_json::json!([])
            };
            serde_json::json!({ "harness_kind": kind, "sources": sources })
        })
        .collect();
    serde_json::from_value(serde_json::json!({
        "version": 2,
        "revision": 7,
        "harnesses": harnesses,
    }))
    .expect("document")
}

fn seed(
    home: &Path,
    applied: Option<&AgentAuthState>,
    native: &[&str],
) -> NativeBridgeSeedOutcome {
    let native: Vec<String> = native.iter().map(|kind| kind.to_string()).collect();
    let predicate = move |kind: &str| native.iter().any(|native| native == kind);
    let applied = applied.cloned();
    let load_applied = move || applied.clone();
    seed_native_bridge_once(home, &load_applied, ALL_KINDS, &predicate, "2026-08-27T00:00:00Z")
        .expect("seed")
}

fn granted(home: &Path) -> BTreeSet<String> {
    pending_native_bridge_harnesses(home).expect("pending")
}

#[test]
fn the_migration_grants_only_absent_natively_authenticated_harnesses() {
    let home = temp_home("native-bridge-seed");
    // claude is configured (present, satisfiable); grok is present but
    // empty (an explicit selection); codex and cursor are absent.
    let applied = document(&[("claude", true), ("grok", false)]);

    let outcome = seed(&home, Some(&applied), &["claude", "grok", "codex"]);

    let expected: BTreeSet<String> = ["codex".to_string()].into_iter().collect();
    assert_eq!(outcome, NativeBridgeSeedOutcome::Seeded { harnesses: expected.clone() });
    assert_eq!(granted(&home), expected);
    assert!(!launch_native_grant(&home, "claude"), "configured harness is never bridged");
    assert!(!launch_native_grant(&home, "grok"), "present-but-empty is a selection, not bridged");
    assert!(!launch_native_grant(&home, "cursor"), "absent but not logged in: nothing to keep");
    let _ = fs::remove_dir_all(home);
}

#[test]
fn the_migration_runs_once_per_runtime_home() {
    let home = temp_home("native-bridge-once");
    assert!(matches!(seed(&home, None, &["claude"]), NativeBridgeSeedOutcome::Seeded { .. }));

    // A later login must not be grandfathered: the second pass is inert.
    let second = seed(&home, None, &["claude", "codex"]);

    assert_eq!(second, NativeBridgeSeedOutcome::AlreadySeeded);
    assert_eq!(granted(&home), ["claude".to_string()].into_iter().collect());
    let _ = fs::remove_dir_all(home);
}

#[test]
fn no_state_file_means_every_native_login_is_bridged() {
    let home = temp_home("native-bridge-no-state");
    let outcome = seed(&home, None, &["claude", "opencode"]);
    let expected: BTreeSet<String> = ["claude", "opencode"].iter().map(|k| k.to_string()).collect();
    assert_eq!(outcome, NativeBridgeSeedOutcome::Seeded { harnesses: expected });
    let _ = fs::remove_dir_all(home);
}

/// The acceptance sentence, mechanically: under the final convention
/// (absent → refuse) a pre-cutover native user's harness resolves NATIVE
/// because the bridge holds its flag — the launch proceeds on the user's
/// own login and the pane's one-time prompt (fed by the same flag) is what
/// they see, never a refusal. Without the flag the same document refuses
/// with the plain-words unconfigured error.
#[test]
fn pre_cutover_native_user_first_launch_prompts_not_refuses() {
    let home = temp_home("native-bridge-first-launch");

    // BEFORE the machine's one-time migration has run (no marker file —
    // e.g. the first boot of the cutover build races the async seed pass),
    // the launch grant fails OPEN: a native user can never be refused by
    // an ordering accident.
    assert!(
        launch_native_grant(&home, "claude"),
        "an unmigrated machine grants native at launch"
    );

    seed(&home, None, &["claude"]);
    let granted = launch_native_grant(&home, "claude");
    assert!(granted);

    let bridged = resolve_profile_bridged(None, "claude", AbsentHarnessPolicy::Refuse, granted)
        .expect("bridged native user launches");
    assert_eq!(bridged, AgentRuntimeAuthProfile::Native);

    let refused = resolve_profile_bridged(None, "codex", AbsentHarnessPolicy::Refuse, false)
        .expect_err("unbridged absent harness refuses under the final convention");
    assert!(matches!(refused, RouteAuthError::NoConfiguredSource { ref harness_kind } if harness_kind == "codex"));
    assert!(refused.to_string().contains("isn't set up"), "refusal speaks plain words: {refused}");
    assert_eq!(refused.code(), "AGENT_ROUTE_SELECTION_MISSING");

    // Today's convention (the policy this build ships) is unchanged by the
    // bridge: absent is native with or without a flag.
    assert_eq!(
        resolve_profile_bridged(None, "codex", AbsentHarnessPolicy::Native, false).expect("native"),
        AgentRuntimeAuthProfile::Native
    );
    let _ = fs::remove_dir_all(home);
}

#[test]
fn the_bridge_never_overrides_an_explicit_selection() {
    // Present-but-empty is a selection the renderer could not satisfy; the
    // flag must not silently degrade it to the user's personal login
    // (agent-auth's silent-degradation rule).
    let applied = document(&[("claude", false)]);
    let error = resolve_profile_bridged(Some(&applied), "claude", AbsentHarnessPolicy::Refuse, true)
        .expect_err("present-but-empty fails closed even when flagged");
    assert!(matches!(error, RouteAuthError::SelectionMissing { .. }));

    // And a satisfiable entry resolves to its sources, flag or not.
    let applied = document(&[("claude", true)]);
    assert!(matches!(
        resolve_profile_bridged(Some(&applied), "claude", AbsentHarnessPolicy::Refuse, true).expect("sources"),
        AgentRuntimeAuthProfile::Sources(_)
    ));
}

#[test]
fn legacy_flag_launch_keeps_native_behavior() {
    // A bridged launch renders the empty delta: no env set, no env removed,
    // no files — the harness inherits the ambient world exactly as today.
    let home = temp_home("native-bridge-render");
    let profile = resolve_profile_bridged(None, "claude", AbsentHarnessPolicy::Refuse, true)
        .expect("bridged");
    let rendered = render_profile(&profile, "claude", &GatewayModelPlan::default(), &home)
        .expect("render");
    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
    assert!(rendered.files.is_empty());
    let _ = fs::remove_dir_all(home);
}

#[test]
fn acting_on_the_prompt_clears_the_flag() {
    let home = temp_home("native-bridge-act");
    seed(&home, None, &["claude", "codex", "grok"]);

    // Dismiss-to-configure: the explicit act.
    assert!(clear_native_bridge_flag(&home, "grok").expect("clear"));
    assert!(!launch_native_grant(&home, "grok"));
    assert!(!clear_native_bridge_flag(&home, "grok").expect("clear again"), "second clear is inert");

    // Configuring (mint / key / gateway): an applied document naming the
    // harness — whether or not its sources are satisfiable right now.
    let applied = document(&[("claude", true), ("codex", false)]);
    clear_native_bridge_flags_for_document(&home, &applied).expect("clear for document");
    assert!(!launch_native_grant(&home, "claude"));
    assert!(!launch_native_grant(&home, "codex"));
    assert!(granted(&home).is_empty());

    // The migration marker survives every clear: acting never re-opens
    // the one-time seed.
    assert!(matches!(load_native_bridge(&home), Ok(Some(_))));
    assert_eq!(seed(&home, None, &["claude"]), NativeBridgeSeedOutcome::AlreadySeeded);
    let _ = fs::remove_dir_all(home);
}

#[test]
fn clearing_on_an_unseeded_home_is_inert() {
    let home = temp_home("native-bridge-unseeded");
    assert!(!clear_native_bridge_flag(&home, "claude").expect("clear"));
    clear_native_bridge_flags_for_document(&home, &document(&[("claude", true)])).expect("clear doc");
    assert!(!native_bridge_path(&home).exists(), "clearing never creates the marker");
    // The pane lists nothing on an unmigrated machine…
    assert!(granted(&home).is_empty());
    // …while launches fail OPEN toward native until the seed runs.
    assert!(launch_native_grant(&home, "claude"));
    let _ = fs::remove_dir_all(home);
}

#[test]
fn a_malformed_bridge_file_fails_open_lists_nothing_and_is_reseeded() {
    let home = temp_home("native-bridge-malformed");
    let path = native_bridge_path(&home);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"{not json").unwrap();

    // Fail open at launch (never convert a working setup into a refusal
    // over a corrupted marker), list nothing in the pane, and let the
    // seed pass rewrite it — the documented recovery, which can re-prompt
    // a user who already acted.
    assert!(launch_native_grant(&home, "claude"));
    assert!(granted(&home).is_empty());
    assert!(matches!(seed(&home, None, &["claude"]), NativeBridgeSeedOutcome::Seeded { .. }));
    assert!(launch_native_grant(&home, "claude"));
    let _ = fs::remove_dir_all(home);
}

#[test]
fn an_unknown_version_bridge_is_never_overwritten_and_fails_open() {
    // A rollback scenario: a NEWER build wrote a version-2 file. This
    // build must not clobber it (the one-time migration already ran),
    // must not interpret it (lists nothing, dismiss is inert), and must
    // fail open at launch.
    let home = temp_home("native-bridge-newer");
    let path = native_bridge_path(&home);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let newer = br#"{"version": 2, "seeded_at": "2027-01-01T00:00:00Z", "harnesses": ["claude"]}"#;
    fs::write(&path, newer).unwrap();

    assert_eq!(seed(&home, None, &["codex"]), NativeBridgeSeedOutcome::AlreadySeeded);
    assert!(launch_native_grant(&home, "claude"));
    assert!(launch_native_grant(&home, "codex"), "unknown contents fail open for every kind");
    assert!(granted(&home).is_empty());
    assert!(!clear_native_bridge_flag(&home, "claude").expect("clear"), "dismiss is inert");
    assert_eq!(fs::read(&path).unwrap(), newer.to_vec(), "the newer file is byte-identical");
    let _ = fs::remove_dir_all(home);
}

#[test]
fn the_bridge_file_is_private_and_beside_the_state_file() {
    let home = temp_home("native-bridge-mode");
    seed(&home, None, &["claude"]);
    let path = native_bridge_path(&home);
    assert_eq!(path, home.join("agent-auth").join("native-bridge.json"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    let _ = fs::remove_dir_all(home);
}

