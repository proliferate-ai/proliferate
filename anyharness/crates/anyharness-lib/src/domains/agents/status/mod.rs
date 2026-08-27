//! The per-harness status document (agent_auth spec §2, "Runtime persistent
//! state" · §4 cell 2, the `status/` tree): ONE machine truth per harness,
//! event-refreshed, never computed on read, served stale-marked while a
//! re-probe runs and never withdrawn. This module owns the document's
//! composition, its SQLite persistence, and its change stream; the local API
//! doors (`GET /v1/agent-auth/status`, `/status/stream`, `/methods`) serve it
//! verbatim, and the agents projection carries it as `authStatus`.
//!
//! Composition inputs, per refresh (spec §4 cell 2, "Method availability"):
//! 1. the applied document, through the SAME effective-state seam launches
//!    use (`route_auth::load_effective_state` + `resolve_profile`);
//! 2. the registry's declared auth vocabulary — a method row appears when the
//!    catalog declares the method AND its material is present in the applied
//!    document. **No org-policy input exists here by law**: policy gates
//!    writes and render on the server, never runtime availability;
//! 3. native detection (`detect_cli_auth_state`, read-only) — the `native`
//!    row with its `mint_seat` offer, never a launch method;
//! 4. the seat-rotation readout — serving (`applied.seat_id`), next-up, and
//!    the cooling banner;
//! 5. the settings rider `rotate` (parsed by `resolve_profile`);
//! 6. the probe evidence held beside the row (the serve-stale observation).
//!
//! Items 1–5 are the COMPOSED half ([`compose`]); item 6 is the probe block
//! ([`probe_block`]). They are decided in different places on purpose:
//!
//! - a composition refresh (`AuthApplied`, `LoginTerminal`, `SeatCooling`,
//!   `InstallCompleted`, `Startup`) re-derives items 1–5 and carries the probe
//!   block over verbatim;
//! - a probe event moves the probe block and NOTHING else. It does not
//!   recompose, so a probe completing can never publish an auth world that no
//!   composition refresh chose — which is what happened while probe writers
//!   composed: a verdict write carrying a state-file read from milliseconds
//!   earlier reverted the served `methods`/`applied` to the pre-apply world and
//!   silently lost an auth change.
//!
//! Refreshing a harness whose recomposed document is byte-identical to the
//! persisted one neither publishes nor rewrites — changing one harness's auth
//! leaves every other harness's document byte-stable.
//!
//! Never logs or persists token material: documents carry seat ids and
//! verdicts only.

mod compose;
#[cfg(test)]
mod concurrency_tests;
mod doc;
mod probe_block;
mod store;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::{DateTime, Utc};
use tokio::sync::broadcast;

use doc::{parse_doc, ComposedBody};
pub use doc::{
    AppliedMethod, MethodRow, ProbeStatus, ProbeVerdict, StatusDoc, METHOD_KIND_API_KEY,
    METHOD_KIND_GATEWAY, METHOD_KIND_NATIVE, METHOD_KIND_SEAT, OFFER_MINT_SEAT,
};
pub use probe_block::ProbeStaleGuard;
use probe_block::{probe_block, HarnessMark, ProbeIntent};
pub use store::AgentStatusStore;
use store::{Decided, DocumentWrite};

use crate::domains::agents::launch_probe::targets::ProbeTargets;
use crate::domains::agents::launch_probe::{LaunchProbeService, PokeReason};
use crate::domains::agents::registry;
use crate::domains::agents::seat_cooling::SeatCoolingStore;
use crate::persistence::Db;

/// Why a refresh fired — trace vocabulary only; every cause runs the same
/// recomposition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshCause {
    /// The startup pass (every persisted row re-served stale until re-verified).
    Startup,
    /// An applied document change (the PUT/DELETE changed set).
    AuthApplied,
    /// A login terminal for this harness closed.
    LoginTerminal,
    /// A live session observed a seat limit hit and marked the seat cooling.
    SeatCooling,
    /// An install finished. A harness installed after boot has no row yet, and
    /// nothing else composes one: the install poke is refused outright for a
    /// manual-refresh-only harness, and even for an auto-probeable one it is
    /// fire-and-forget, so the install response would serve `authStatus: null`.
    InstallCompleted,
}

impl RefreshCause {
    fn as_str(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::AuthApplied => "auth_applied",
            Self::LoginTerminal => "login_terminal",
            Self::SeatCooling => "seat_cooling",
            Self::InstallCompleted => "install_completed",
        }
    }
}

/// The status-document service: reads, the change stream, event-driven
/// refreshes, and the probe-evidence writers the probe engine calls at
/// admission and completion (no polling seam — the engine pushes).
pub struct AgentStatusService {
    runtime_home: PathBuf,
    store: AgentStatusStore,
    seat_cooling: SeatCoolingStore,
    targets: Arc<dyn ProbeTargets>,
    /// The harness universe status documents may exist for (the registry's
    /// kinds in production; overridable in tests).
    universe: Vec<String>,
    /// The home dir native detection reads (the user's `$HOME` in production;
    /// a temp dir in tests so a developer's real logins cannot leak in).
    /// `None` when the home dir cannot be resolved at all — that means NO
    /// native detection, never a scan of the filesystem root.
    detection_home: Option<PathBuf>,
    /// Per-harness write cells: the stale-mark bookkeeping AND the lock every
    /// status write for that harness is taken under. See [`HarnessMark`].
    marks: Mutex<HashMap<String, Arc<Mutex<HarnessMark>>>>,
    publisher: broadcast::Sender<StatusDoc>,
}

impl AgentStatusService {
    pub fn new(db: Db, runtime_home: PathBuf, targets: Arc<dyn ProbeTargets>) -> Self {
        let universe = registry::built_in_registry()
            .iter()
            .map(|descriptor| descriptor.kind.as_str().to_string())
            .collect();
        Self::with_detection_home(db, runtime_home, targets, universe, dirs::home_dir())
    }

    pub(crate) fn with_parts(
        db: Db,
        runtime_home: PathBuf,
        targets: Arc<dyn ProbeTargets>,
        universe: Vec<String>,
        detection_home: PathBuf,
    ) -> Self {
        Self::with_detection_home(db, runtime_home, targets, universe, Some(detection_home))
    }

    fn with_detection_home(
        db: Db,
        runtime_home: PathBuf,
        targets: Arc<dyn ProbeTargets>,
        universe: Vec<String>,
        detection_home: Option<PathBuf>,
    ) -> Self {
        let (publisher, _) = broadcast::channel(64);
        Self {
            runtime_home,
            store: AgentStatusStore::new(db.clone()),
            seat_cooling: SeatCoolingStore::new(db),
            targets,
            universe,
            detection_home,
            marks: Mutex::new(HashMap::new()),
            publisher,
        }
    }

    /// Is this a harness the service can hold a document for? The doors 404
    /// on anything else.
    pub fn is_known_harness(&self, harness_kind: &str) -> bool {
        self.universe.iter().any(|kind| kind == harness_kind)
    }

    /// Every persisted status document, in harness order. Served truth — no
    /// composition happens on read.
    pub fn read_all(&self) -> Vec<StatusDoc> {
        self.store
            .read_all()
            .into_iter()
            .filter_map(|(harness_kind, doc_json)| parse_doc(&harness_kind, &doc_json))
            .collect()
    }

    pub fn read(&self, harness_kind: &str) -> Option<StatusDoc> {
        self.store
            .read(harness_kind)
            .and_then(|row| parse_doc(harness_kind, &row.doc_json))
    }

    /// The change stream: every persisted refresh publishes the changed
    /// document — one event per status-document change, nothing for
    /// byte-stable recompositions.
    pub fn subscribe(&self) -> broadcast::Receiver<StatusDoc> {
        self.publisher.subscribe()
    }

    /// Recompose one harness's document from the live inputs, carrying the
    /// probe block over unchanged (probe evidence moves only through the
    /// probe writers below).
    pub fn refresh(&self, harness_kind: &str, cause: RefreshCause) {
        let cell = self.mark_cell(harness_kind);
        let mut mark = lock_mark(&cell);
        // Composition runs under the harness's own write cell, so two refreshes
        // for one harness — the startup pass racing an apply, which happens on
        // EVERY boot — cannot interleave their reads and writes and persist a
        // document built from the older read.
        let body = self.compose_body(harness_kind);
        self.write_locked(
            harness_kind,
            Some(body),
            ProbeIntent::Carry,
            cause.as_str(),
            &mut mark,
        );
    }

    pub fn refresh_harnesses(&self, harness_kinds: &[String], cause: RefreshCause) {
        for harness_kind in harness_kinds {
            self.refresh(harness_kind, cause);
        }
    }

    /// Refresh every known harness (the DELETE-with-unreadable-previous
    /// fallback: the widest honest targeting).
    pub fn refresh_all(&self, cause: RefreshCause) {
        for harness_kind in self.universe.clone() {
            self.refresh(&harness_kind, cause);
        }
    }

    /// Admit a probe attempt against the document, RAII-style: the document
    /// goes stale now — queued counts — and the mark comes back off when the
    /// LAST admitted attempt lets go without a completion of its own. See
    /// [`ProbeStaleGuard`], which is why this returns a value that must be held.
    #[must_use = "the stale mark is released when the guard drops"]
    pub fn admit_probe(self: &Arc<Self>, harness_kind: &str) -> ProbeStaleGuard {
        let cell = self.mark_cell(harness_kind);
        {
            let mut mark = lock_mark(&cell);
            if mark.admitted == 0 {
                // Nothing is in flight, so what the document shows right now is
                // what a release must put back.
                mark.restore = self
                    .store
                    .read(harness_kind)
                    .and_then(|row| parse_doc(harness_kind, &row.doc_json))
                    .is_some_and(|doc| doc.probe.stale);
            }
            mark.admitted = mark.admitted.saturating_add(1);
            self.probe_write(
                harness_kind,
                ProbeIntent::MarkStale,
                "probe_admitted",
                &mut mark,
            );
        }
        ProbeStaleGuard::new(self.clone(), harness_kind.to_string())
    }

    /// A probe attempt was admitted (queued or running): the document goes
    /// stale, verdict and evidence unchanged — the last observation stays
    /// visible while the re-probe runs.
    ///
    /// The bare mark, with no release. Production admits through
    /// [`Self::admit_probe`]; this is the primitive it writes with, kept public
    /// so tests can drive the serve-stale ladder one step at a time.
    pub fn probe_admitted(&self, harness_kind: &str) {
        let cell = self.mark_cell(harness_kind);
        let mut mark = lock_mark(&cell);
        self.probe_write(
            harness_kind,
            ProbeIntent::MarkStale,
            "probe_admitted",
            &mut mark,
        );
    }

    /// A probe succeeded: fresh evidence, and the observation store moves.
    pub fn probe_verified(&self, harness_kind: &str, at: DateTime<Utc>) {
        let cell = self.mark_cell(harness_kind);
        let mut mark = lock_mark(&cell);
        self.probe_write(
            harness_kind,
            ProbeIntent::Verified { at },
            "probe_verified",
            &mut mark,
        );
    }

    /// A probe failed — the light dims, it never turns off (spec §3 flow 4):
    /// with a prior verified observation the document serves that observation
    /// stale-marked (the observation store is untouched); with none it serves
    /// an honest `failed` verdict at the attempt time — failed, not dark, not
    /// fabricated.
    pub fn probe_failed(&self, harness_kind: &str, at: DateTime<Utc>) {
        let cell = self.mark_cell(harness_kind);
        let mut mark = lock_mark(&cell);
        self.probe_write(
            harness_kind,
            ProbeIntent::Failed { at },
            "probe_failed",
            &mut mark,
        );
    }

    /// One admitted attempt let go. The mark comes off only when the last one
    /// does, and it goes back to what the chain's own last completion chose —
    /// so a coalesce loser dropping cannot clear a mark the running winner
    /// needs, and a dimming failure stays dimmed.
    pub(super) fn release_probe(&self, harness_kind: &str) {
        let cell = self.mark_cell(harness_kind);
        let mut mark = lock_mark(&cell);
        mark.admitted = mark.admitted.saturating_sub(1);
        if mark.admitted > 0 {
            return;
        }
        let restore = mark.restore;
        self.probe_write(
            harness_kind,
            ProbeIntent::ReleaseStale { restore },
            "probe_released",
            &mut mark,
        );
    }

    /// The startup pass: every persisted row is re-served STALE until the
    /// startup probes re-verify it (a restart invalidates live evidence, not
    /// the observation), every installed harness gets a row, and any
    /// installed, auto-probeable harness with NO persisted row — a harness
    /// that appeared without an install event — raises `FirstDetected`.
    pub fn startup_pass(&self, poke_engine: &Option<Arc<LaunchProbeService>>) {
        let persisted: Vec<String> = self
            .store
            .read_all()
            .into_iter()
            .map(|(harness_kind, _)| harness_kind)
            .collect();
        for harness_kind in &persisted {
            let cell = self.mark_cell(harness_kind);
            let mut mark = lock_mark(&cell);
            let body = self.compose_body(harness_kind);
            self.probe_write_with_body(
                harness_kind,
                Some(body),
                ProbeIntent::MarkStale,
                "startup",
                &mut mark,
            );
        }
        let installed: Vec<String> = self
            .universe
            .iter()
            .filter(|kind| self.targets.is_installed(kind))
            .cloned()
            .collect();
        for harness_kind in &installed {
            if !persisted.iter().any(|kind| kind == harness_kind) {
                self.refresh(harness_kind, RefreshCause::Startup);
                if self.targets.allows_automatic_probe(harness_kind) {
                    LaunchProbeService::poke_optional(
                        poke_engine,
                        harness_kind,
                        PokeReason::FirstDetected,
                    );
                }
            }
        }
    }

    /// One harness's write cell, created on first use and never removed (the
    /// universe is bounded by the registry).
    fn mark_cell(&self, harness_kind: &str) -> Arc<Mutex<HarnessMark>> {
        self.marks
            .lock()
            .expect("agent-auth status marks poisoned")
            .entry(harness_kind.to_string())
            .or_default()
            .clone()
    }

    /// A probe-block-only write. Probe evidence never recomposes — EXCEPT for a
    /// harness with no row at all, where there is no body to patch and an
    /// honest composition is the only way to hold the evidence.
    fn probe_write(
        &self,
        harness_kind: &str,
        intent: ProbeIntent,
        why: &str,
        mark: &mut HarnessMark,
    ) {
        let body = self
            .store
            .read(harness_kind)
            .is_none()
            .then(|| self.compose_body(harness_kind));
        self.probe_write_with_body(harness_kind, body, intent, why, mark);
    }

    fn probe_write_with_body(
        &self,
        harness_kind: &str,
        body: Option<ComposedBody>,
        intent: ProbeIntent,
        why: &str,
        mark: &mut HarnessMark,
    ) {
        self.write_locked(harness_kind, body, intent, why, mark);
    }

    /// Persist + publish, byte-stability gated. Must be called with the
    /// harness's write cell held.
    ///
    /// The atomicity argument, in one place: `body` was composed OUTSIDE the
    /// transaction (file reads, detection, the rotation readout) and is pure
    /// data by the time it gets here; the probe block is resolved INSIDE the
    /// transaction against the very row the write replaces, and the byte-
    /// stability comparison happens against that same read. So the document and
    /// the observation columns are always written from one read of one row, and
    /// no interleaving writer can leave them disagreeing.
    fn write_locked(
        &self,
        harness_kind: &str,
        body: Option<ComposedBody>,
        intent: ProbeIntent,
        why: &str,
        mark: &mut HarnessMark,
    ) {
        let decided = self
            .store
            .write_document(harness_kind, Utc::now().timestamp(), |row| {
                let (probe, observation) = probe_block(intent, harness_kind, row);
                let doc = match body.as_ref() {
                    Some(body) => body.into_doc(harness_kind, probe),
                    // A probe write patches the persisted document's own body.
                    // No row means nothing to patch and nothing to say.
                    None => {
                        let mut doc = parse_doc(harness_kind, &row?.doc_json)?;
                        doc.probe = probe;
                        doc
                    }
                };
                let doc_json = match serde_json::to_string(&doc) {
                    Ok(doc_json) => doc_json,
                    Err(error) => {
                        tracing::warn!(harness_kind, %error, "failed to serialize agent-auth status document");
                        return None;
                    }
                };
                // Byte-stable AND carrying no new observation: neither rewrite
                // the row nor publish.
                if observation.is_none() && row.is_some_and(|row| row.doc_json == doc_json) {
                    return Some(Decided {
                        payload: doc,
                        write: None,
                    });
                }
                Some(Decided {
                    payload: doc,
                    write: Some(DocumentWrite {
                        doc_json,
                        observation,
                    }),
                })
            });
        let Some((doc, wrote)) = decided else {
            return;
        };
        if intent.is_completion() {
            // Whatever staleness this completion chose is what an eventual
            // release restores: a failure over a prior verified observation
            // leaves the badge dimmed, and a release must not un-dim it.
            mark.restore = doc.probe.stale;
        }
        if !wrote {
            return;
        }
        tracing::debug!(
            harness_kind = %doc.harness_kind,
            cause = why,
            "agent-auth status document refreshed"
        );
        let _ = self.publisher.send(doc);
    }
}

fn lock_mark(cell: &Arc<Mutex<HarnessMark>>) -> MutexGuard<'_, HarnessMark> {
    cell.lock().expect("agent-auth status mark poisoned")
}

/// The absolute path arm of the doc — kept for parity with the other stores'
/// constructors that take the shared app `Db`.
impl AgentStatusService {
    pub fn runtime_home(&self) -> &Path {
        &self.runtime_home
    }
}
