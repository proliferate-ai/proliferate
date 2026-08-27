//! The native-migration bridge (agent_auth spec, delta row "Zero rows =
//! unconfigured, with a migration for today's native users").
//!
//! The final convention refuses a launch for a harness with zero enabled
//! selections ("unconfigured", plain words). Today's convention lets such a
//! harness launch on its own login. Flipping the convention would turn every
//! working native setup into a refusal — so this module carries those users
//! across:
//!
//! - **The legacy flag** is machine truth, held runtime-local in
//!   `<runtime_home>/agent-auth/native-bridge.json` (0600): the set of harness
//!   kinds whose launches keep native behavior until the user acts. It never
//!   rides the wire, so no document shape, courier rule, or older runtime is
//!   affected (an empty document is DELETEd by the courier and a revision-0
//!   surface is never pushed at all — the exact population this bridge
//!   protects would never receive a server-side flag).
//! - **The migration** is [`seed_native_bridge_once`]: a one-time pass at
//!   runtime startup that grants the flag to every harness ABSENT from the
//!   applied document AND natively authenticated on this machine at that
//!   moment. It runs once per runtime home (the file's presence is the
//!   marker) and never again, so a login made later is not grandfathered.
//! - **Acting on the one-time prompt clears the flag**: an applied document
//!   naming the harness (the user configured it — mint, key, gateway) drops
//!   the flag through [`clear_native_bridge_flags_for_document`]; the
//!   dismiss-to-configure action drops it through
//!   [`clear_native_bridge_flag`] (`DELETE /v1/agent-auth/native-bridge/
//!   {kind}`). Either way the next launch follows the real convention.
//! - **The seam** the refusal cutover consults is
//!   [`super::resolve_profile_bridged`]: absent + flagged → native; absent +
//!   unflagged → whatever [`super::ABSENT_HARNESS_POLICY`] says. The bridge
//!   never overrides an explicit selection: a harness PRESENT in the document
//!   with no satisfiable source still fails closed.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::state::AgentAuthState;
use super::RouteAuthError;

/// Relative path of the bridge file under the runtime home, beside
/// `agent-auth/state.json`.
pub const NATIVE_BRIDGE_FILE_RELATIVE_PATH: &[&str] = &["agent-auth", "native-bridge.json"];

const NATIVE_BRIDGE_VERSION: i64 = 1;

/// The persisted bridge: the one-time seed stamp plus the harnesses still
/// carrying the legacy flag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativeBridge {
    pub version: i64,
    /// RFC 3339 stamp of the seed pass. Presence of the file IS the "already
    /// migrated" marker; the stamp is for humans reading the file.
    pub seeded_at: String,
    /// Harness kinds whose launches keep native behavior until acted on.
    #[serde(default)]
    pub harnesses: BTreeSet<String>,
}

/// What the one-time seed pass did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeBridgeSeedOutcome {
    /// The file already existed: the migration ran before; nothing changed.
    AlreadySeeded,
    /// The file was written now, granting exactly these harnesses.
    Seeded { harnesses: BTreeSet<String> },
}

pub fn native_bridge_path(runtime_home: &Path) -> PathBuf {
    NATIVE_BRIDGE_FILE_RELATIVE_PATH
        .iter()
        .fold(runtime_home.to_path_buf(), |path, segment| path.join(segment))
}

/// Read the bridge. `Ok(None)` when the seed pass never ran here. A file that
/// cannot be parsed reads as `None` too (and is logged): the seed pass then
/// rewrites it, which is the only recovery a corrupted marker admits.
pub fn load_native_bridge(runtime_home: &Path) -> Result<Option<NativeBridge>, RouteAuthError> {
    let path = native_bridge_path(runtime_home);
    let contents = match fs::read(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(RouteAuthError::Materialize {
                detail: format!("failed to read {}: {error}", path.display()),
            })
        }
    };
    match serde_json::from_slice::<NativeBridge>(&contents) {
        Ok(bridge) if bridge.version == NATIVE_BRIDGE_VERSION => Ok(Some(bridge)),
        Ok(bridge) => {
            tracing::warn!(
                path = %path.display(),
                version = bridge.version,
                "native-bridge file has an unknown version; treating as unseeded"
            );
            Ok(None)
        }
        Err(error) => {
            tracing::warn!(
                path = %path.display(),
                %error,
                "native-bridge file is malformed; treating as unseeded"
            );
            Ok(None)
        }
    }
}

/// Does `harness_kind` still carry the legacy flag on this machine? Any read
/// failure answers `false` (no grant) and is logged — the flag is a grant, and
/// a grant that cannot be read is not held.
pub fn legacy_native_granted(runtime_home: &Path, harness_kind: &str) -> bool {
    match load_native_bridge(runtime_home) {
        Ok(Some(bridge)) => bridge.harnesses.contains(harness_kind),
        Ok(None) => false,
        Err(error) => {
            tracing::warn!(harness_kind, %error, "native-bridge unreadable; no legacy grant");
            false
        }
    }
}

/// The harnesses still flagged, sorted; empty when the bridge was never seeded.
pub fn pending_native_bridge_harnesses(runtime_home: &Path) -> Result<BTreeSet<String>, RouteAuthError> {
    Ok(load_native_bridge(runtime_home)?
        .map(|bridge| bridge.harnesses)
        .unwrap_or_default())
}

/// The one-time migration. Grants the legacy flag to every kind in
/// `harness_kinds` that is ABSENT from `applied` (no entry at all — a
/// present-but-empty entry is an explicit selection, never bridged) and for
/// which `natively_authenticated(kind)` holds. Idempotent: a runtime home that
/// already carries the file is left untouched, whatever detection says now.
pub fn seed_native_bridge_once(
    runtime_home: &Path,
    applied: Option<&AgentAuthState>,
    harness_kinds: &[&str],
    natively_authenticated: &dyn Fn(&str) -> bool,
    seeded_at: &str,
) -> Result<NativeBridgeSeedOutcome, RouteAuthError> {
    if load_native_bridge(runtime_home)?.is_some() {
        return Ok(NativeBridgeSeedOutcome::AlreadySeeded);
    }
    let harnesses: BTreeSet<String> = harness_kinds
        .iter()
        .filter(|kind| applied.is_none_or(|state| state.sources_for(kind).is_none()))
        .filter(|kind| natively_authenticated(kind))
        .map(|kind| (*kind).to_string())
        .collect();
    let bridge = NativeBridge {
        version: NATIVE_BRIDGE_VERSION,
        seeded_at: seeded_at.to_string(),
        harnesses: harnesses.clone(),
    };
    write_native_bridge(runtime_home, &bridge)?;
    Ok(NativeBridgeSeedOutcome::Seeded { harnesses })
}

/// Drop one harness's flag (the dismiss-to-configure act). Returns whether a
/// flag was actually held. A never-seeded runtime home is a no-op `false`.
pub fn clear_native_bridge_flag(runtime_home: &Path, harness_kind: &str) -> Result<bool, RouteAuthError> {
    let Some(mut bridge) = load_native_bridge(runtime_home)? else {
        return Ok(false);
    };
    if !bridge.harnesses.remove(harness_kind) {
        return Ok(false);
    }
    write_native_bridge(runtime_home, &bridge)?;
    Ok(true)
}

/// Drop the flag of every harness `document` names: an applied document that
/// carries an entry for a harness means the user configured it (mint, key, or
/// gateway), which IS the act the prompt asked for. The clear happens whether
/// the entry's sources are satisfiable or not — from here on the document, not
/// the bridge, decides that harness's launches.
pub fn clear_native_bridge_flags_for_document(
    runtime_home: &Path,
    document: &AgentAuthState,
) -> Result<(), RouteAuthError> {
    let Some(mut bridge) = load_native_bridge(runtime_home)? else {
        return Ok(());
    };
    let before = bridge.harnesses.len();
    for harness in &document.harnesses {
        bridge.harnesses.remove(&harness.harness_kind);
    }
    if bridge.harnesses.len() != before {
        write_native_bridge(runtime_home, &bridge)?;
    }
    Ok(())
}

fn write_native_bridge(runtime_home: &Path, bridge: &NativeBridge) -> Result<(), RouteAuthError> {
    let path = native_bridge_path(runtime_home);
    let parent = path.parent().expect("native-bridge path has a parent");
    fs::create_dir_all(parent).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", parent.display()),
    })?;
    let mut serialized =
        serde_json::to_vec_pretty(bridge).map_err(|error| RouteAuthError::Materialize {
            detail: format!("failed to serialize native-bridge: {error}"),
        })?;
    serialized.push(b'\n');
    super::materialize::write_private_file(&path, &serialized)
}

/// The startup glue: the one-time seed pass fed by this machine's truth — the
/// applied document (origin-guarded exactly as a launch reads it) and native
/// credential detection per registered harness (host-ambient env plus the
/// harness's own discovery, the same read `GET /v1/agents` performs).
pub fn seed_native_bridge_at_startup(runtime_home: &Path) {
    use crate::domains::agents::auth::credentials::detect_credentials;
    use crate::domains::agents::model::CredentialState;
    use crate::domains::agents::registry::built_in_registry;

    if matches!(load_native_bridge(runtime_home), Ok(Some(_))) {
        return;
    }
    let applied = match super::load_effective_state(runtime_home, super::current_server_origin().as_deref()) {
        Ok(state) => state,
        Err(error) => {
            // A document the launcher cannot read is native for the launcher
            // too; the seed pass sees the same absence.
            tracing::debug!(%error, "agent-auth state unreadable at bridge seed; treating as absent");
            None
        }
    };
    let descriptors = built_in_registry();
    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let natively_authenticated = |kind: &str| -> bool {
        descriptors
            .iter()
            .find(|descriptor| descriptor.kind.as_str() == kind)
            .is_some_and(|descriptor| {
                matches!(
                    detect_credentials(&descriptor.auth, &home_dir),
                    CredentialState::Ready | CredentialState::ReadyViaLocalAuth
                )
            })
    };
    let kinds: Vec<&str> = descriptors
        .iter()
        .map(|descriptor| descriptor.kind.as_str())
        .collect();
    let seeded_at = chrono::Utc::now().to_rfc3339();
    match seed_native_bridge_once(runtime_home, applied.as_ref(), &kinds, &natively_authenticated, &seeded_at) {
        Ok(NativeBridgeSeedOutcome::Seeded { harnesses }) => {
            tracing::info!(?harnesses, "native-migration bridge seeded");
        }
        Ok(NativeBridgeSeedOutcome::AlreadySeeded) => {}
        Err(error) => {
            tracing::warn!(%error, "native-migration bridge seed failed; launches follow the document");
        }
    }
}

#[cfg(test)]
mod tests {
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

    fn seed(home: &Path, applied: Option<&AgentAuthState>, native: &[&str]) -> NativeBridgeSeedOutcome {
        let native: Vec<String> = native.iter().map(|kind| kind.to_string()).collect();
        let predicate = move |kind: &str| native.iter().any(|native| native == kind);
        seed_native_bridge_once(home, applied, ALL_KINDS, &predicate, "2026-08-27T00:00:00Z")
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
        assert!(!legacy_native_granted(&home, "claude"), "configured harness is never bridged");
        assert!(!legacy_native_granted(&home, "grok"), "present-but-empty is a selection, not bridged");
        assert!(!legacy_native_granted(&home, "cursor"), "absent but not logged in: nothing to keep");
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
        seed(&home, None, &["claude"]);
        let granted = legacy_native_granted(&home, "claude");
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
        assert!(!legacy_native_granted(&home, "grok"));
        assert!(!clear_native_bridge_flag(&home, "grok").expect("clear again"), "second clear is inert");

        // Configuring (mint / key / gateway): an applied document naming the
        // harness — whether or not its sources are satisfiable right now.
        let applied = document(&[("claude", true), ("codex", false)]);
        clear_native_bridge_flags_for_document(&home, &applied).expect("clear for document");
        assert!(!legacy_native_granted(&home, "claude"));
        assert!(!legacy_native_granted(&home, "codex"));
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
        assert!(!legacy_native_granted(&home, "claude"));
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn a_malformed_bridge_file_grants_nothing_and_is_reseeded() {
        let home = temp_home("native-bridge-malformed");
        let path = native_bridge_path(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{not json").unwrap();

        assert!(!legacy_native_granted(&home, "claude"));
        assert!(granted(&home).is_empty());
        assert!(matches!(seed(&home, None, &["claude"]), NativeBridgeSeedOutcome::Seeded { .. }));
        assert!(legacy_native_granted(&home, "claude"));
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
}
