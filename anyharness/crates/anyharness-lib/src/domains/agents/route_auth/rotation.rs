//! Seat rotation: the pure per-launch decision (agent_auth spec §4 cell 2,
//! "Rotation ownership") plus the read-path derivation the settings pane
//! consumes. The decision is deterministic and I/O-free — the seam in `mod.rs`
//! feeds it the document-order pool and the store's cooling/last-served facts,
//! and NOTHING here advances rotation state: only a successful spawn's
//! `confirm_served` does.

use std::collections::BTreeMap;
use std::path::Path;

use crate::domains::agents::auth_state::SeatRotationReadout;
use crate::domains::agents::seat_cooling::SeatCoolingStore;

use super::profile::{resolve_profile, AgentRuntimeAuthProfile, HarnessSources, ResolvedSource};
use super::{current_server_origin, load_effective_state};

/// What the next launch should do about seats.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RotationDecision {
    /// Serve this seat — ALONE: the launch render keeps exactly this seat
    /// source and drops every other source (seat or not), so the CLI sees one
    /// credential and a limit error cools the seat that actually served.
    Serve { seat_id: String },
    /// Every seat in the pool is cooling; `earliest_reset_epoch_s` is the
    /// earliest deadline among the pool's cooling records.
    AllCooling { earliest_reset_epoch_s: i64 },
    /// Rotation is off and the pinned candidate is cooling.
    PinnedCooling {
        seat_id: String,
        reset_at_epoch_s: i64,
    },
}

/// The seat pool a profile carries, in DOCUMENT order, with duplicate ids
/// collapsed to their first occurrence. Both the launch seam and the read-path
/// derivation build their pool here, so a document that repeats a seat id
/// (a server-side expansion bug, or a hand-edited state file) cannot stall
/// round-robin: `decide_rotation` locates `last_served` by first match, and a
/// repeated id would otherwise re-serve itself forever.
pub fn seat_pool(sources: &HarnessSources) -> Vec<String> {
    let mut pool: Vec<String> = Vec::new();
    for source in &sources.sources {
        if let ResolvedSource::Seat(seat) = source {
            if !pool.contains(&seat.seat_id) {
                pool.push(seat.seat_id.clone());
            }
        }
    }
    pool
}

/// The pure rotation decision. `pool` is the profile's seat ids in DOCUMENT
/// order (authoritative, deduplicated — see [`seat_pool`]), `cooling` is
/// seat_id → deadline, already filtered to still-cooling rows.
///
/// - `rotate == true`: true round-robin — start at the seat AFTER
///   `last_served` in cyclic document order (absent or not in the pool →
///   start at the first seat) and take the first non-cooling one.
/// - `rotate == false`: the candidate is `last_served` if still in the pool,
///   else the first seat; a cooling candidate refuses rather than advancing —
///   the pin means launches WAIT for that login.
///
/// Total on every input: an EMPTY pool (both callers guard it, but this is a
/// public function) reads as "no seat can serve" — `AllCooling` with no
/// deadline to name (`earliest_reset_epoch_s: 0`) — never a panic.
pub fn decide_rotation(
    pool: &[String],
    rotate: bool,
    last_served: Option<&str>,
    cooling: &BTreeMap<String, i64>,
) -> RotationDecision {
    if pool.is_empty() {
        return RotationDecision::AllCooling {
            earliest_reset_epoch_s: 0,
        };
    }
    if !rotate {
        let candidate = last_served
            .filter(|seat| pool.iter().any(|id| id == seat))
            .unwrap_or(pool[0].as_str());
        return match cooling.get(candidate) {
            Some(reset_at_epoch_s) => RotationDecision::PinnedCooling {
                seat_id: candidate.to_string(),
                reset_at_epoch_s: *reset_at_epoch_s,
            },
            None => RotationDecision::Serve {
                seat_id: candidate.to_string(),
            },
        };
    }
    let start = last_served
        .and_then(|seat| pool.iter().position(|id| id == seat))
        .map(|index| (index + 1) % pool.len())
        .unwrap_or(0);
    for offset in 0..pool.len() {
        let seat_id = &pool[(start + offset) % pool.len()];
        if !cooling.contains_key(seat_id) {
            return RotationDecision::Serve {
                seat_id: seat_id.clone(),
            };
        }
    }
    let earliest_reset_epoch_s = pool
        .iter()
        .filter_map(|seat_id| cooling.get(seat_id))
        .copied()
        .min()
        // Unreachable in practice: every pool seat is in `cooling` here.
        .unwrap_or(0);
    RotationDecision::AllCooling {
        earliest_reset_epoch_s,
    }
}

/// The read-path derivation behind the pane's serving-now / next-up tags and
/// the cooling banner (frozen semantics, work order K):
///
/// - `serving` — `last_served` if still in the applied pool, else the pool's
///   first seat; `None` when the applied document has no seats.
/// - `next` — the seat rotation would pick for the NEXT launch (rotate=false →
///   the pinned candidate); `None` when the pool has fewer than two seats, or
///   when no seat could serve.
/// - `cooling_until` — non-null ONLY when no seat can serve right now
///   (rotate=true: all pool seats cooling → the earliest reset; rotate=false:
///   the pinned candidate cooling → its reset), as RFC3339 UTC.
///
/// Read-only and tolerant: any unreadable/unresolvable state reads as "no
/// seats" — this is a display derivation, never a gate.
pub fn seat_rotation_readout(
    runtime_home: &Path,
    harness_kind: &str,
    store: &SeatCoolingStore,
    now_epoch_s: i64,
) -> SeatRotationReadout {
    let state = match load_effective_state(runtime_home, current_server_origin().as_deref()) {
        Ok(state) => state,
        Err(_) => return SeatRotationReadout::default(),
    };
    let Ok(AgentRuntimeAuthProfile::Sources(sources)) =
        resolve_profile(state.as_ref(), harness_kind)
    else {
        return SeatRotationReadout::default();
    };
    let pool = seat_pool(&sources);
    if pool.is_empty() {
        return SeatRotationReadout::default();
    }
    let last_served = store.last_served(harness_kind);
    let cooling = store.cooling_map(harness_kind, now_epoch_s);
    let serving = last_served
        .as_deref()
        .filter(|seat| pool.iter().any(|id| id == seat))
        .unwrap_or(pool[0].as_str())
        .to_string();
    let decision = decide_rotation(&pool, sources.rotate, last_served.as_deref(), &cooling);
    let (next, cooling_until) = match &decision {
        RotationDecision::Serve { seat_id } => (Some(seat_id.clone()), None),
        RotationDecision::PinnedCooling {
            seat_id,
            reset_at_epoch_s,
        } => (Some(seat_id.clone()), Some(*reset_at_epoch_s)),
        RotationDecision::AllCooling {
            earliest_reset_epoch_s,
        } => (None, Some(*earliest_reset_epoch_s)),
    };
    SeatRotationReadout {
        serving_seat_id: Some(serving),
        next_seat_id: next.filter(|_| pool.len() >= 2),
        cooling_until: cooling_until
            .and_then(|epoch| chrono::DateTime::from_timestamp(epoch, 0).map(|at| at.to_rfc3339())),
    }
}

/// Facade for the HTTP read path (AH-API-2: handlers call domain facades,
/// never stores): same derivation as [`seat_rotation_readout`], constructing
/// the seat-cooling store on the app's shared `Db` handle internally.
pub fn seat_rotation_readout_via_db(
    runtime_home: &Path,
    db: crate::persistence::Db,
    harness_kind: &str,
    now_epoch_s: i64,
) -> SeatRotationReadout {
    seat_rotation_readout(
        runtime_home,
        harness_kind,
        &SeatCoolingStore::new(db),
        now_epoch_s,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    fn cooling(entries: &[(&str, i64)]) -> BTreeMap<String, i64> {
        entries
            .iter()
            .map(|(id, until)| (id.to_string(), *until))
            .collect()
    }

    #[test]
    fn round_robin_starts_after_last_served_in_cyclic_document_order() {
        let pool = pool(&["a", "b", "c"]);
        let none = BTreeMap::new();
        assert_eq!(
            decide_rotation(&pool, true, None, &none),
            RotationDecision::Serve {
                seat_id: "a".into()
            }
        );
        assert_eq!(
            decide_rotation(&pool, true, Some("a"), &none),
            RotationDecision::Serve {
                seat_id: "b".into()
            }
        );
        // Cyclic: after the last seat comes the first.
        assert_eq!(
            decide_rotation(&pool, true, Some("c"), &none),
            RotationDecision::Serve {
                seat_id: "a".into()
            }
        );
        // A last-served seat no longer in the pool restarts at the first.
        assert_eq!(
            decide_rotation(&pool, true, Some("gone"), &none),
            RotationDecision::Serve {
                seat_id: "a".into()
            }
        );
    }

    #[test]
    fn round_robin_skips_cooling_seats() {
        let pool = pool(&["a", "b", "c"]);
        let cooling = cooling(&[("b", 100)]);
        assert_eq!(
            decide_rotation(&pool, true, Some("a"), &cooling),
            RotationDecision::Serve {
                seat_id: "c".into()
            }
        );
    }

    #[test]
    fn all_cooling_reports_the_earliest_reset_among_the_pool() {
        let pool = pool(&["a", "b"]);
        let cooling = cooling(&[("a", 300), ("b", 200)]);
        assert_eq!(
            decide_rotation(&pool, true, None, &cooling),
            RotationDecision::AllCooling {
                earliest_reset_epoch_s: 200
            }
        );
    }

    #[test]
    fn an_empty_pool_never_panics_in_either_mode() {
        let empty: Vec<String> = Vec::new();
        let none = BTreeMap::new();
        let expected = RotationDecision::AllCooling {
            earliest_reset_epoch_s: 0,
        };
        assert_eq!(decide_rotation(&empty, true, None, &none), expected);
        assert_eq!(decide_rotation(&empty, true, Some("a"), &none), expected);
        // rotate=false used to index pool[0] — a pinned decision over nothing.
        assert_eq!(decide_rotation(&empty, false, None, &none), expected);
        assert_eq!(decide_rotation(&empty, false, Some("a"), &none), expected);
    }

    #[test]
    fn seat_pool_keeps_document_order_and_drops_repeated_ids() {
        use super::super::profile::SeatProfile;
        let seat = |id: &str| {
            ResolvedSource::Seat(SeatProfile {
                seat_id: id.to_string(),
                env: BTreeMap::new(),
            })
        };
        let sources = HarnessSources {
            harness_kind: "claude".into(),
            revision: 1,
            sources: vec![seat("a"), seat("a"), seat("b"), seat("a")],
            rotate: true,
        };
        assert_eq!(seat_pool(&sources), pool(&["a", "b"]));
    }

    #[test]
    fn pinned_serves_last_served_and_never_advances_off_it() {
        let pool = pool(&["a", "b"]);
        let none = BTreeMap::new();
        // rotate=false: the applied seat keeps serving even though "b" exists.
        assert_eq!(
            decide_rotation(&pool, false, Some("a"), &none),
            RotationDecision::Serve {
                seat_id: "a".into()
            }
        );
        // Never served yet → the first seat is the pin.
        assert_eq!(
            decide_rotation(&pool, false, None, &none),
            RotationDecision::Serve {
                seat_id: "a".into()
            }
        );
        // A cooling pin refuses rather than rotating.
        let cooling = cooling(&[("a", 900)]);
        assert_eq!(
            decide_rotation(&pool, false, Some("a"), &cooling),
            RotationDecision::PinnedCooling {
                seat_id: "a".into(),
                reset_at_epoch_s: 900
            }
        );
    }
}
