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
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::state::AgentAuthState;
use super::RouteAuthError;

/// One process-wide lock over every bridge-file MUTATION (seed and the two
/// clears). The file is a load-modify-write document with no revision column;
/// without the lock, the startup seed racing a `PUT /v1/agent-auth/state` (or
/// a dismiss) can resurrect a flag the user just cleared, or flag a harness a
/// concurrent document just configured. Reads stay lock-free — a torn read is
/// impossible (writes are atomic temp+rename) and staleness only delays a
/// banner refresh.
static BRIDGE_MUTATION_LOCK: Mutex<()> = Mutex::new(());

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

/// The four states the on-disk bridge file can be in. Every public read maps
/// this to its own fail direction; keeping the classification in one place is
/// what keeps those directions consistent.
enum BridgeFile {
    /// No file: the one-time migration never ran on this runtime home.
    Absent,
    /// A file this build wrote (version 1).
    Current(NativeBridge),
    /// A parseable file with a version this build does not know — written by
    /// a NEWER build. Never overwritten, never interpreted: the seed treats it
    /// as already-migrated (a rollback must not clobber a newer build's data
    /// and re-run a one-time migration), the launch grant fails open toward
    /// native, and the pane lists nothing.
    UnknownVersion,
    /// Unreadable/unparseable. The seed rewrites it (the only recovery a
    /// corrupted marker admits — this can re-prompt a user who already acted,
    /// a documented trade-off); the launch grant fails open toward native.
    Malformed,
}

fn read_bridge_file(runtime_home: &Path) -> Result<BridgeFile, RouteAuthError> {
    let path = native_bridge_path(runtime_home);
    let contents = match fs::read(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BridgeFile::Absent)
        }
        Err(error) => {
            return Err(RouteAuthError::Materialize {
                detail: format!("failed to read {}: {error}", path.display()),
            })
        }
    };
    match serde_json::from_slice::<NativeBridge>(&contents) {
        Ok(bridge) if bridge.version == NATIVE_BRIDGE_VERSION => Ok(BridgeFile::Current(bridge)),
        Ok(bridge) => {
            tracing::warn!(
                path = %path.display(),
                version = bridge.version,
                "native-bridge file has an unknown (newer) version; leaving it untouched"
            );
            Ok(BridgeFile::UnknownVersion)
        }
        Err(error) => {
            tracing::warn!(
                path = %path.display(),
                %error,
                "native-bridge file is malformed; the seed pass will rewrite it"
            );
            Ok(BridgeFile::Malformed)
        }
    }
}

/// Read the bridge as this build understands it. `Ok(None)` when no
/// version-1 document exists (absent, malformed, or a newer version).
pub fn load_native_bridge(runtime_home: &Path) -> Result<Option<NativeBridge>, RouteAuthError> {
    Ok(match read_bridge_file(runtime_home)? {
        BridgeFile::Current(bridge) => Some(bridge),
        BridgeFile::Absent | BridgeFile::UnknownVersion | BridgeFile::Malformed => None,
    })
}

/// The LAUNCH-side grant: may `harness_kind` keep native behavior when it is
/// absent from the applied document and the absent-harness policy says refuse?
///
/// Fails OPEN toward native everywhere the machine's migration state is not
/// positively known — the bridge exists so a working native setup is never
/// converted into a refusal, and refusing is only ever correct on a machine
/// whose one-time seed pass has run and recorded that this harness holds no
/// flag:
///
/// - no marker file → `true`: the migration has not run here yet (first boot
///   of a bridge-aware build races the async seed pass; an upgrade straight
///   past the bridge build lands here too);
/// - malformed / unknown-version marker → `true` (and logged);
/// - a current marker → set membership, the one place `false` can come from.
pub fn launch_native_grant(runtime_home: &Path, harness_kind: &str) -> bool {
    match read_bridge_file(runtime_home) {
        Ok(BridgeFile::Current(bridge)) => bridge.harnesses.contains(harness_kind),
        Ok(BridgeFile::Absent) => true,
        Ok(BridgeFile::UnknownVersion) | Ok(BridgeFile::Malformed) => true,
        Err(error) => {
            tracing::warn!(
                harness_kind,
                %error,
                "native-bridge unreadable; failing open toward native"
            );
            true
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
/// `harness_kinds` that is ABSENT from the applied document (no entry at all —
/// a present-but-empty entry is an explicit selection, never bridged) and for
/// which `natively_authenticated(kind)` holds. Idempotent: a runtime home that
/// already carries the file (including one written by a newer build) is left
/// untouched, whatever detection says now.
///
/// `load_applied` is a CLOSURE, called under the bridge mutation lock, so the
/// document consulted is the one persisted at write time — a `PUT
/// /v1/agent-auth/state` landing while the seed runs either persists before
/// this reads (its harnesses are never flagged) or its flag-clear serializes
/// after this write (the flag is dropped again). No interleaving can flag a
/// just-configured harness.
pub fn seed_native_bridge_once(
    runtime_home: &Path,
    load_applied: &dyn Fn() -> Option<AgentAuthState>,
    harness_kinds: &[&str],
    natively_authenticated: &dyn Fn(&str) -> bool,
    seeded_at: &str,
) -> Result<NativeBridgeSeedOutcome, RouteAuthError> {
    let _guard = BRIDGE_MUTATION_LOCK.lock().expect("bridge lock poisoned");
    match read_bridge_file(runtime_home)? {
        BridgeFile::Current(_) | BridgeFile::UnknownVersion => {
            return Ok(NativeBridgeSeedOutcome::AlreadySeeded)
        }
        BridgeFile::Absent | BridgeFile::Malformed => {}
    }
    let applied = load_applied();
    let harnesses: BTreeSet<String> = harness_kinds
        .iter()
        .filter(|kind| {
            applied
                .as_ref()
                .is_none_or(|state| state.sources_for(kind).is_none())
        })
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
/// flag was actually held. A never-seeded (or newer-versioned) runtime home is
/// a no-op `false` — clearing never creates or rewrites a marker.
pub fn clear_native_bridge_flag(
    runtime_home: &Path,
    harness_kind: &str,
) -> Result<bool, RouteAuthError> {
    let _guard = BRIDGE_MUTATION_LOCK.lock().expect("bridge lock poisoned");
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
    let _guard = BRIDGE_MUTATION_LOCK.lock().expect("bridge lock poisoned");
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
    // Loaded lazily INSIDE the seed's lock (see `seed_native_bridge_once`), so
    // the document consulted is the one persisted at decision time.
    let load_applied = || {
        match super::load_effective_state(runtime_home, super::current_server_origin().as_deref())
        {
            Ok(state) => state,
            Err(error) => {
                // A document the launcher cannot read is native for the
                // launcher too; the seed pass sees the same absence.
                tracing::debug!(%error, "agent-auth state unreadable at bridge seed; treating as absent");
                None
            }
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
    match seed_native_bridge_once(
        runtime_home,
        &load_applied,
        &kinds,
        &natively_authenticated,
        &seeded_at,
    ) {
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
#[path = "native_bridge_tests.rs"]
mod tests;
