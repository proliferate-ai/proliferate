//! The probe block's decision table and the RAII guard over its stale mark.
//!
//! Two separate jobs, both about the same three fields (`verdict`, `at`,
//! `stale`), which is why they live together:
//!
//! 1. [`ProbeIntent`] + [`probe_block`] — what a writer wants done to the probe
//!    block, resolved as a PURE function of the STORED observation. That purity
//!    is the whole atomicity argument: the resolution runs inside the store's
//!    write transaction, against the very row the write replaces, so the
//!    document's probe block and the `probe_verdict`/`probe_at` columns are
//!    always written from one read and can never diverge.
//! 2. [`ProbeStaleGuard`] — the counterpart `notify_probe_admitted` never had.

use std::sync::Arc;

use chrono::{DateTime, Utc};

use super::doc::{parse_doc, ProbeStatus, ProbeVerdict, OBSERVED_FAILED, OBSERVED_VERIFIED};
use super::store::StatusRow;
use super::AgentStatusService;

/// What a writer wants done to the probe block.
#[derive(Debug, Clone, Copy)]
pub(super) enum ProbeIntent {
    /// Carry the stored observation forward with the staleness the persisted
    /// document already shows (every composition refresh).
    Carry,
    /// Carry it forward, stale-marked: an attempt has been admitted (queued
    /// counts). The observation stays visible — dimmed, never withdrawn.
    MarkStale,
    /// Carry it forward with `stale` forced back to `restore`: every admitted
    /// attempt let go, so nothing is in flight and the mark must come off.
    ReleaseStale { restore: bool },
    /// A probe succeeded.
    Verified { at: DateTime<Utc> },
    /// A probe failed. With a prior verified observation the document serves
    /// that observation stale-marked and the observation store is untouched;
    /// with none it serves an honest `failed` at the attempt time.
    Failed { at: DateTime<Utc> },
}

impl ProbeIntent {
    /// Is this a COMPLETED attempt's write? Only a completion decides what an
    /// eventual stale-mark release restores.
    pub(super) fn is_completion(self) -> bool {
        matches!(self, Self::Verified { .. } | Self::Failed { .. })
    }
}

/// A fresh observation to record in the row's columns alongside the document.
pub(super) type Observation = (String, String);

/// Resolve the probe block, and the observation to record with it, against the
/// row the write is about to replace.
///
/// Called INSIDE the store's write transaction. Every arm derives `verdict`/`at`
/// from the same read it writes, so `doc.probe.at == row.probe_at` holds by
/// construction on every path — including the `Keep` paths, which is exactly
/// where the non-transactional read-modify-write used to tear.
pub(super) fn probe_block(
    intent: ProbeIntent,
    harness_kind: &str,
    row: Option<&StatusRow>,
) -> (ProbeStatus, Option<Observation>) {
    let (verdict, at) = stored_observation(row);
    match intent {
        ProbeIntent::Carry => (
            ProbeStatus {
                verdict,
                at,
                stale: stored_stale(harness_kind, row),
            },
            None,
        ),
        ProbeIntent::MarkStale => (
            ProbeStatus {
                verdict,
                at,
                stale: true,
            },
            None,
        ),
        ProbeIntent::ReleaseStale { restore } => (
            ProbeStatus {
                verdict,
                at,
                stale: restore,
            },
            None,
        ),
        ProbeIntent::Verified { at: fresh } => {
            // Evidence never gets older. Completions are serialized per harness
            // by the engine's single-flight gate, so an out-of-order pair is not
            // reachable today — pinning it here makes the "probe.at never moves
            // backwards" invariant a property of the write rather than of a
            // lock held somewhere else.
            let fresh = fresh.to_rfc3339();
            let observed = match (verdict, at.as_deref()) {
                (ProbeVerdict::Verified, Some(stored)) if is_newer(stored, &fresh) => {
                    stored.to_string()
                }
                _ => fresh,
            };
            (
                ProbeStatus {
                    verdict: ProbeVerdict::Verified,
                    at: Some(observed.clone()),
                    stale: false,
                },
                Some((OBSERVED_VERIFIED.to_string(), observed)),
            )
        }
        ProbeIntent::Failed { at: fresh } => match (verdict, at) {
            // The light dims, it never turns off (spec §3 flow 4).
            (ProbeVerdict::Verified, Some(prior)) => (
                ProbeStatus {
                    verdict: ProbeVerdict::Verified,
                    at: Some(prior),
                    stale: true,
                },
                None,
            ),
            _ => {
                let fresh = fresh.to_rfc3339();
                (
                    ProbeStatus {
                        verdict: ProbeVerdict::Failed,
                        at: Some(fresh.clone()),
                        stale: false,
                    },
                    Some((OBSERVED_FAILED.to_string(), fresh)),
                )
            }
        },
    }
}

/// The row's last OBSERVATION. The document's probe verdict and timestamp are
/// read from HERE rather than from `doc_json`, so the two can only ever agree.
fn stored_observation(row: Option<&StatusRow>) -> (ProbeVerdict, Option<String>) {
    match row {
        Some(row) => match row.probe_verdict.as_deref() {
            Some(OBSERVED_VERIFIED) => (ProbeVerdict::Verified, row.probe_at.clone()),
            Some(OBSERVED_FAILED) => (ProbeVerdict::Failed, row.probe_at.clone()),
            // No completed attempt has ever written here: honestly unverified,
            // never fabricated.
            _ => (ProbeVerdict::Unverified, None),
        },
        None => (ProbeVerdict::Unverified, None),
    }
}

/// The persisted document's own `stale` bit — the one probe field the
/// observation columns cannot express (a failure over a prior verified
/// observation dims WITHOUT moving the observation).
fn stored_stale(harness_kind: &str, row: Option<&StatusRow>) -> bool {
    row.and_then(|row| parse_doc(harness_kind, &row.doc_json))
        .is_some_and(|doc| doc.probe.stale)
}

fn is_newer(candidate: &str, than: &str) -> bool {
    match (
        DateTime::parse_from_rfc3339(candidate),
        DateTime::parse_from_rfc3339(than),
    ) {
        (Ok(candidate), Ok(than)) => candidate > than,
        // An unparseable stored timestamp is not evidence of anything; let the
        // fresh one win.
        _ => false,
    }
}

/// One harness's admitted-attempt bookkeeping for the STATUS DOCUMENT's stale
/// mark — the document-side twin of `launch_probe::live_state`'s
/// `HarnessRuntimeState`, and it exists for the same reason.
///
/// It doubles as the per-harness write lock: every status write for a harness
/// happens while holding this cell, so composition and the compare-and-write
/// cannot interleave with another writer's, and the bookkeeping below can never
/// disagree with what is actually persisted. Per-harness rather than global
/// because one harness's auth has nothing to do with another's — a status write
/// for grok must not queue behind a codex composition.
#[derive(Debug, Default)]
pub(super) struct HarnessMark {
    /// How many admitted attempts hold the mark. Admission happens BEFORE the
    /// single-flight gate, so a coalesce loser holds one too, and the mark may
    /// only come off when the LAST of them lets go — exactly `LiveStateGuard`'s
    /// reasoning for the slot's live phase, and for the same failure: a loser
    /// releasing early would clear a mark the running winner still needs.
    pub(super) admitted: u32,
    /// What `stale` goes back to when the last holder lets go: the staleness
    /// the document showed before the first admission, or — once some attempt
    /// in the chain completed — the staleness that completion chose, so a
    /// failure over a prior verified observation stays dimmed.
    pub(super) restore: bool,
}

/// RAII guard over the status document's stale mark (spec §2: "served
/// stale-marked while a re-probe runs, **never withdrawn**").
///
/// `notify_probe_admitted` wrote `stale = true` and had NO counterpart. The slot
/// already had one (`LiveStateGuard`, F-036); the document did not, so every
/// abnormal exit out of an admitted attempt left the document claiming a
/// re-probe that was not running:
///
/// - `refresh_now` is awaited directly in an axum handler, so a client
///   disconnecting mid-refresh makes axum DROP the future;
/// - the single-flight coalesce returns without probing;
/// - the backoff refusal returns without probing;
/// - `run_attempt` can fail before it reaches any verdict write at all (an
///   unwired launch-options store, a `begin_probe` sqlite failure).
///
/// On every one of those the document sat at `stale = true` with no probe in
/// flight, no failure recorded, and therefore no `BackoffExpired` recovery
/// armed — a badge dimmed forever, which is the one thing flow 4 forbids.
/// `Drop` covers all four the same way, plus panics and future-drops.
pub struct ProbeStaleGuard {
    service: Arc<AgentStatusService>,
    harness_kind: String,
}

impl ProbeStaleGuard {
    pub(super) fn new(service: Arc<AgentStatusService>, harness_kind: String) -> Self {
        Self {
            service,
            harness_kind,
        }
    }
}

impl Drop for ProbeStaleGuard {
    fn drop(&mut self) {
        self.service.release_probe(&self.harness_kind);
    }
}
