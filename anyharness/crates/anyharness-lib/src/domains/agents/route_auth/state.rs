//! The declarative agent-auth state file contract (state.json v2, AUTH-ONLY).
//!
//! Both delivery surfaces (the cloud materialization worker and the desktop
//! dispatch worker) write the SAME file at `<anyharness home>/agent-auth/
//! state.json` (mode 0600); AnyHarness reads it fresh at every session launch
//! and renders per-harness launch profiles from it. There is no watch/refresh —
//! the render plane re-reads on demand.
//!
//! v2 shape (contract §3): a `harnesses[]` list, each entry carrying the
//! ENABLED `sources[]` for one harness (see the `SOURCE_KIND_*` consts). The
//! server validated legality before emitting the sources, so the render plane
//! just composes whatever list it is handed.
//!
//! Tolerance model:
//! - file absent          -> `None` (native behavior; local desktop works)
//! - file present, valid  -> `Some(AgentAuthState)`
//! - file present, broken -> typed [`RouteAuthError::MalformedStateFile`]
//!   (this includes a v1 / version-less file: no users exist, so there is no
//!   back-compat — an old-shape file is simply malformed to this render plane)

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::RouteAuthError;

/// Well-known relative path of the state file under the AnyHarness home.
pub const STATE_FILE_RELATIVE_PATH: &[&str] = &["agent-auth", "state.json"];

/// The only wire schema version this render plane understands.
pub const STATE_VERSION: i64 = 2;

/// Source discriminants on the wire (contract §3).
pub const SOURCE_KIND_GATEWAY: &str = "gateway";
pub const SOURCE_KIND_API_KEY: &str = "api_key";
/// A resolved typed provider-config source (Track D): `config_kind` names
/// which per-harness recipe to run, and `env` is ALREADY the harness's real
/// env-var map (Python resolved generic vault fields into harness-correct
/// names before the source ever reached Rust -- see agent-auth.md's wire
/// contract). Rust never renames a field here, only picks a render arm.
pub const SOURCE_KIND_PROVIDER_CONFIG: &str = "provider_config";
/// A seat (seats v1): a Max-subscription credential from the vault. Same
/// already-resolved `env` ruling as `provider_config` (for claude exactly
/// `{CLAUDE_CODE_OAUTH_TOKEN: <token>}`), plus `seat_id` — the vault entry id,
/// carried so the runtime can name the serving seat without echoing the token.
/// The producer expands a pool selection into one source per active seat, in
/// vault order; the launch path rotates over the pool (rotation.rs).
pub const SOURCE_KIND_SEAT: &str = "seat";

/// Resolve the absolute path of the agent-auth state file for a given
/// AnyHarness runtime home. Single source of truth for the layout so delivery
/// (worker/desktop) and the render plane agree.
pub fn state_file_path(runtime_home: &Path) -> PathBuf {
    let mut path = runtime_home.to_path_buf();
    for segment in STATE_FILE_RELATIVE_PATH {
        path.push(segment);
    }
    path
}

/// A single credential source for a harness (contract §3). `kind` is kept as a
/// raw string (not a serde-tagged enum) so an unrecognized kind surfaces a
/// typed error at resolve time rather than a blanket parse failure: unknown
/// `kind` → typed error, structurally-broken JSON → `MalformedStateFile`.
///
/// The per-kind fields are optional at the serde layer and validated when the
/// source is resolved:
/// - `gateway`: `base_url` + `key`
/// - `api_key`: `env_var_name` + `value`
/// - `provider_config`: `config_kind` + `env` (Track D). Deliberately its own
///   fields rather than reusing `env_var_name`/`value` (those are `api_key`'s
///   shape and reusing them would make the two kinds ambiguous to any
///   future shape check).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthSource {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_var_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// `provider_config` only: which per-harness recipe to run (e.g.
    /// `"aws_bedrock"`, `"azure_openai"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_kind: Option<String>,
    /// `provider_config` and `seat`: the ALREADY-resolved, harness-real
    /// env-var map (Python's job, not Rust's — see
    /// `SOURCE_KIND_PROVIDER_CONFIG`'s doc). `BTreeMap` for deterministic
    /// serialization.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<BTreeMap<String, String>>,
    /// `seat` only: the vault entry id of this seat (never key material).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<String>,
}

/// One harness's enabled sources (contract §3). Composition is just "a list of
/// sources": single-source harnesses carry at most one, OpenCode may carry a
/// gateway plus any number of api_key rows — the server already enforced which
/// combinations are legal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessAuth {
    pub harness_kind: String,
    #[serde(default)]
    pub sources: Vec<AuthSource>,
    /// Per-harness settings rider. Route-auth reads exactly ONE key: `rotate`
    /// (bool, default true) — the seat-rotation toggle, parsed by
    /// `resolve_profile`. Everything else rides through untouched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<serde_json::Map<String, serde_json::Value>>,
    /// Plain-words reason the server attaches when this entry is
    /// present-but-empty (a selection it could not satisfy). Read into the
    /// refusal copy; absent when the sources are servable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsatisfied_reason: Option<String>,
}

/// The whole declarative state file (contract §3, v2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentAuthState {
    /// Wire schema version. Must equal [`STATE_VERSION`]; any other value (or a
    /// version-less v1 file) is rejected as malformed on load.
    pub version: i64,
    /// Monotonic sequence, per surface. The server bumps it on ANY render whose
    /// content changed (selection/key mutations, virtual-key rotation — all of
    /// it); a no-op render changes nothing. Used for stale-push protection
    /// ([`apply_state_file`]) and sequence-keyed materialization dirs. Content
    /// identity is the `fingerprint`, a `GET /state` rider that never reaches
    /// this document.
    pub sequence: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// The origin (`scheme://host[:port]`) of the control-plane server that
    /// produced this document, stamped by the desktop write path at push time
    /// (`use-local-auth-state-sync.ts`). `None` for cloud-materialized state
    /// (no desktop server-switch concern there) and for files written before
    /// this field existed — [`Self::matches_server_origin`] treats an absent
    /// stamp as a match, so single-server users see no behavior change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuing_server_origin: Option<String>,
    #[serde(default)]
    pub harnesses: Vec<HarnessAuth>,
}

impl AgentAuthState {
    /// The enabled sources for a harness kind, distinguishing **absent** from
    /// **present-but-empty** — the whole point of the return type.
    ///
    /// agent-auth.md, "Absent means native; present-but-empty fails closed": a
    /// harness with no entry in the document runs on its own login, while a
    /// harness whose entry is present but whose selected sources could not be
    /// satisfied is a *selection the machine cannot honor* and a launch must be
    /// refused rather than quietly falling back to the user's personal
    /// credentials.
    ///
    /// - `None` — no entry for this harness. Native.
    /// - `Some([])` — an entry exists and every source in it was dropped as
    ///   unsatisfiable. Fail closed.
    /// - `Some([..])` — usable sources.
    ///
    /// The old signature returned `&[]` for both of the first two cases, which
    /// made the law unimplementable at this layer: the caller could not tell a
    /// user who never configured the harness from a user whose gateway budget
    /// just exhausted.
    pub fn sources_for(&self, harness_kind: &str) -> Option<&[AuthSource]> {
        self.harnesses
            .iter()
            .find(|entry| entry.harness_kind == harness_kind)
            .map(|entry| entry.sources.as_slice())
    }

    /// Guards against injecting a PREVIOUS server's gateway tokens after a
    /// desktop server switch: the worker may push a fresh document for the new
    /// server before the app re-enrolls, but a launch racing that window must
    /// not use the just-abandoned server's still-cached state.
    ///
    /// - both origins present and equal (case-insensitively, ignoring a
    ///   trailing slash) → match.
    /// - both present and different → mismatch (the caller treats the state
    ///   as absent, i.e. native/no-injection, until a fresh push lands).
    /// - either side absent (no stamp on the file, or no current-origin
    ///   signal from the caller, e.g. a cloud sandbox) → match. This is the
    ///   backward-compat path: it never regresses a single-server install.
    pub fn matches_server_origin(&self, current_server_origin: Option<&str>) -> bool {
        match (&self.issuing_server_origin, current_server_origin) {
            (Some(stamped), Some(current)) => {
                normalize_origin(stamped) == normalize_origin(current)
            }
            _ => true,
        }
    }
}

fn normalize_origin(origin: &str) -> String {
    origin.trim().trim_end_matches('/').to_ascii_lowercase()
}

/// Read + parse the state file on demand. Returns:
/// - `Ok(None)` when the file is absent (native behavior),
/// - `Ok(Some(state))` when present and a valid v2 document,
/// - `Err(RouteAuthError::MalformedStateFile)` when present but unparseable or
///   not v2 (a v1 / version-less file counts as malformed — no back-compat).
pub fn load_state_file(runtime_home: &Path) -> Result<Option<AgentAuthState>, RouteAuthError> {
    let path = state_file_path(runtime_home);
    load_state_from_path(&path)
}

/// The outcome of applying a state document: the per-harness diff against the
/// previously persisted document, so the apply site can target its pokes and
/// status refreshes at exactly the harnesses whose auth actually moved
/// (spec §4, "Probe targeting": `AuthApplied{changed}`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedStateOutcome {
    /// Harnesses whose entry's canonical serialization differs, appears, or
    /// disappears relative to the previous document — incoming-document order
    /// first, then disappeared entries in previous-document order. Empty for
    /// an identical re-push. A previously malformed file carries no
    /// trustworthy baseline, so every harness the incoming document names
    /// counts as changed.
    pub changed_harnesses: Vec<String>,
}

/// Persist a state document pushed by a delivery surface (the desktop local
/// writer, mirroring what the cloud materialization worker writes into
/// sandboxes). The write is atomic and 0600 via the shared route-auth private
/// file helper.
///
/// Stale-write protection: a payload whose sequence is BELOW the persisted
/// file's sequence is rejected (a delayed push must never roll live
/// selections back). An equal sequence is an idempotent re-push of the same
/// document — by governance the server bumps the sequence on ANY content
/// change, virtual-key rotation included, so equal sequence means identical
/// content. A malformed on-disk file carries no trustworthy sequence and is
/// healed by any valid push.
pub fn apply_state_file(
    runtime_home: &Path,
    state: &AgentAuthState,
) -> Result<AppliedStateOutcome, RouteAuthError> {
    let path = state_file_path(runtime_home);
    // Read, diff and write under the state file's own exclusive lock. Without
    // it two concurrent PUTs both diff against the SAME baseline, so the
    // second's changed set can omit a harness the first already moved — and a
    // missed harness is a harness that launches differently while its status
    // document and its probe are never refreshed for it. An advisory flock (not
    // an in-process mutex) because the desktop courier and a cloud
    // materialization worker are separate processes over one home.
    let _lock = StateFileLock::acquire(&path)?;
    let previous = match load_state_from_path(&path) {
        Ok(existing) => existing,
        // Malformed: no trustworthy baseline (and no trustworthy sequence) —
        // healed by any valid push, with every incoming harness changed.
        Err(RouteAuthError::MalformedStateFile { .. }) => None,
        Err(error) => return Err(error),
    };
    // Known open wedge (delivery slice-3 review, open question): this guard
    // compares sequences that may come from DIFFERENT counter lineages. A
    // server switch pushes a document from another origin's counter; a
    // same-origin DB rebuild restarts the counter lower. Either can wedge the
    // runtime behind a stale-but-higher persisted sequence until manual state
    // clear. A sound fix needs an ordering authority over lineages on the
    // wire (not a heuristic here) and is founder-gated — do not "fix" this
    // guard locally.
    if let Some(current) = previous.as_ref().map(|existing| existing.sequence) {
        if state.sequence < current {
            return Err(RouteAuthError::StaleStateSequence {
                incoming: state.sequence,
                current,
            });
        }
    }
    let parent = path.parent().expect("state file path has a parent");
    fs::create_dir_all(parent).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", parent.display()),
    })?;
    let mut serialized =
        serde_json::to_vec_pretty(state).map_err(|error| RouteAuthError::Materialize {
            detail: format!("failed to serialize agent-auth state: {error}"),
        })?;
    serialized.push(b'\n');
    super::materialize::write_private_file(&path, &serialized)?;
    Ok(AppliedStateOutcome {
        changed_harnesses: changed_harnesses(previous.as_ref(), state),
    })
}

/// The per-harness diff between two documents. A harness is CHANGED when its
/// entry's canonical serialization differs, appears, or disappears — or when the
/// document-level `issuing_server_origin` moved, because that flips every
/// harness at once. The comparison runs over the parsed [`HarnessAuth`] values
/// via `serde_json::to_value`, which is deterministic here: this crate does not
/// enable serde_json's `preserve_order`, so `settings` maps are key-sorted.
fn changed_harnesses(previous: Option<&AgentAuthState>, incoming: &AgentAuthState) -> Vec<String> {
    // Every consumer of this document reads it through `load_effective_state`,
    // which DISCARDS a document stamped for a different server — so flipping the
    // stamp flips every harness between "gateway routed" and "native" for
    // composition, the launch render, and the launch-options basis alike, even
    // when every harness entry is byte-identical. A missed change is strictly
    // worse than a spurious poke: it means launches route differently while no
    // status document is ever recomposed for it.
    // Compared as normalized `Option`s, not through `matches_server_origin`:
    // that predicate deliberately treats an ABSENT stamp as a match (the
    // backward-compat path), but adding or removing a stamp still changes which
    // documents the origin guard honors, so it is a real move here.
    let stamp =
        |state: &AgentAuthState| state.issuing_server_origin.as_deref().map(normalize_origin);
    let origin_moved = previous.is_some_and(|previous| stamp(previous) != stamp(incoming));
    let entry_values = |state: &AgentAuthState| -> Vec<(String, Option<serde_json::Value>)> {
        state
            .harnesses
            .iter()
            .map(|entry| (entry.harness_kind.clone(), serde_json::to_value(entry).ok()))
            .collect()
    };
    let previous_entries = previous.map(entry_values).unwrap_or_default();
    let incoming_entries = entry_values(incoming);
    let mut changed = Vec::new();
    for (kind, value) in &incoming_entries {
        let previous_value = previous_entries
            .iter()
            .find(|(previous_kind, _)| previous_kind == kind)
            .map(|(_, previous_value)| previous_value);
        // An entry that would not serialize cannot be compared. A diff whose
        // failure mode must be "assume changed" therefore reports it changed —
        // two unserializable entries used to compare EQUAL (both `Null`), which
        // is the wrong direction.
        let entry_moved = match (previous_value, value) {
            (Some(Some(previous)), Some(value)) => previous != value,
            _ => true,
        };
        if entry_moved || origin_moved {
            changed.push(kind.clone());
        }
    }
    for (kind, _) in &previous_entries {
        if !incoming_entries
            .iter()
            .any(|(incoming_kind, _)| incoming_kind == kind)
        {
            changed.push(kind.clone());
        }
    }
    // A document that repeats a `harness_kind` must not poke it twice: the poke
    // and the status refresh are both keyed on the kind alone.
    let mut seen: Vec<String> = Vec::new();
    changed.retain(|kind| {
        if seen.iter().any(|previous| previous == kind) {
            return false;
        }
        seen.push(kind.clone());
        true
    });
    changed
}

/// The outcome of clearing the state file: what the previous document named,
/// so the clear site can target its pokes and status refreshes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClearedStateOutcome {
    /// Every harness the previous document named (the DELETE changed set), in
    /// document order. `None` when a file was present but malformed — its
    /// names are unknowable, and the caller should fall back to the widest
    /// targeting. An absent file clears nothing: `Some(vec![])`.
    pub previous_harnesses: Option<Vec<String>>,
}

/// Clear the delivered route state and return the runtime to native auth.
///
/// Clearing is a separate operation from sequence-guarded replacement because
/// native auth is represented by the absence of route state at the runtime.
/// Making the reset explicit avoids weakening stale-write protection for
/// ordinary state documents.
pub fn clear_state_file(runtime_home: &Path) -> Result<ClearedStateOutcome, RouteAuthError> {
    let path = state_file_path(runtime_home);
    // Same lock as [`apply_state_file`]: a clear racing an apply must not report
    // a previous document that the apply already replaced.
    let _lock = StateFileLock::acquire(&path)?;
    let previous_harnesses = match load_state_from_path(&path) {
        Ok(previous) => Some(
            previous
                .map(|state| {
                    state
                        .harnesses
                        .iter()
                        .map(|entry| entry.harness_kind.clone())
                        .collect()
                })
                .unwrap_or_default(),
        ),
        Err(RouteAuthError::MalformedStateFile { .. }) => None,
        Err(error) => return Err(error),
    };
    match fs::remove_file(&path) {
        Ok(()) => Ok(ClearedStateOutcome { previous_harnesses }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(ClearedStateOutcome { previous_harnesses })
        }
        Err(error) => Err(RouteAuthError::Materialize {
            detail: format!("failed to remove {}: {error}", path.display()),
        }),
    }
}

/// Well-known name of the state file's mutation lock, beside the file itself.
const STATE_LOCK_FILE_NAME: &str = ".state.lock";

/// An exclusive advisory lock over the state file's read-diff-write window.
///
/// BLOCKING, unlike `launch_probe::lock::ProbeEngineLock`, and for the opposite
/// reason: probing is convergence, so waiting for that lock would be a bug,
/// whereas an apply is a mutation whose diff is only correct if it is the sole
/// writer. Waiting is bounded by one small file write.
///
/// A crash releases it via the OS, which is why this is an flock and not a
/// pid file. An unopenable lock path degrades to "no lock" rather than failing
/// the apply: a read-only or exotic home is a real deployment, and applying
/// without the lock is exactly the pre-existing behavior.
struct StateFileLock(Option<fs::File>);

impl StateFileLock {
    fn acquire(state_path: &Path) -> Result<Self, RouteAuthError> {
        let parent = state_path.parent().expect("state file path has a parent");
        fs::create_dir_all(parent).map_err(|error| RouteAuthError::Materialize {
            detail: format!("failed to create {}: {error}", parent.display()),
        })?;
        let path = parent.join(STATE_LOCK_FILE_NAME);
        let file = match fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) => {
                tracing::warn!(
                    path = %path.display(),
                    %error,
                    "could not open the agent-auth state lock; applying unlocked"
                );
                return Ok(Self(None));
            }
        };
        if let Err(error) = fs2::FileExt::lock_exclusive(&file) {
            tracing::warn!(
                path = %path.display(),
                %error,
                "could not lock the agent-auth state file; applying unlocked"
            );
            return Ok(Self(None));
        }
        Ok(Self(Some(file)))
    }
}

impl Drop for StateFileLock {
    fn drop(&mut self) {
        if let Some(file) = self.0.as_ref() {
            let _ = fs2::FileExt::unlock(file);
        }
    }
}

pub(super) fn load_state_from_path(path: &Path) -> Result<Option<AgentAuthState>, RouteAuthError> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(RouteAuthError::MalformedStateFile {
                path: path.to_path_buf(),
                detail: format!("failed to read state file: {error}"),
            })
        }
    };
    let state: AgentAuthState =
        serde_json::from_slice(&contents).map_err(|error| RouteAuthError::MalformedStateFile {
            path: path.to_path_buf(),
            detail: format!("failed to parse state file JSON: {error}"),
        })?;
    if state.version != STATE_VERSION {
        return Err(RouteAuthError::MalformedStateFile {
            path: path.to_path_buf(),
            detail: format!(
                "unsupported agent-auth state version {} (expected {STATE_VERSION})",
                state.version
            ),
        });
    }
    Ok(Some(state))
}

#[cfg(test)]
#[path = "state_apply_concurrency_tests.rs"]
mod state_apply_concurrency_tests;
#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
