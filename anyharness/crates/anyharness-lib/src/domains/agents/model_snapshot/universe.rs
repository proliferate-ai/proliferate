//! Projecting the machine document into the launch-validation universe.
//!
//! One rule, and it is the staleness gate's rule verbatim: a context contributes
//! its observed model ids only while its entry is FRESH. model-catalog.md,
//! "Failure modes" is explicit that a stale entry stops being trusted for launch
//! validation ("launch validation falls back to the shipped catalog for that
//! context until a fresh entry lands"), and that an in-flight probe never gates
//! anything — so this read never waits, never probes, and never consults the engine's
//! live state.
//!
//! Deliberately NOT reusing the reconciler's gate path: that one is `&self`, takes
//! slot locks, and short-circuits on the completed-attempt floor and the backoff
//! window — in-memory facts about the ENGINE, not about the entry. A launch asking
//! "is this observation trustworthy?" must get the same answer whether or not a probe
//! happens to be queued, so this reads the document, the manifest and the fingerprint
//! and calls the pure evaluator.

use chrono::Utc;

use super::document::{install_identity_of, read_document};
use super::{fingerprint, staleness, ModelSnapshotService};
use crate::domains::agents::catalog::universe::ObservedUniverse;
use crate::domains::agents::route_auth;

impl ModelSnapshotService {
    /// The observed universe for one harness: fresh entries only, keyed by auth
    /// context id.
    ///
    /// Available in read-only mode, like every other read: a runtime that does not
    /// own the probe engine still validates launches against whatever the owner
    /// observed.
    pub fn observed_universe(&self, harness_kind: &str) -> ObservedUniverse {
        let Some(document) = read_document(&self.runtime_home, harness_kind) else {
            return ObservedUniverse::empty();
        };
        let identity = install_identity_of(&self.runtime_home, harness_kind);
        let catalog_contexts = self.targets.catalog_contexts(harness_kind);
        let now = Utc::now();

        let observations = document.entries.into_iter().filter_map(|(context_id, entry)| {
            // An unresolvable context cannot produce a current fingerprint, so its
            // entry cannot be shown to be fresh. Declining is the conservative
            // answer: the shipped catalog fills in.
            let material = route_auth::probe_auth_material(
                &self.runtime_home,
                harness_kind,
                &context_id,
                &catalog_contexts,
            )
            .ok()?;
            let freshness = staleness::evaluate(
                Some(&entry),
                identity.as_ref(),
                &fingerprint::fingerprint(&material),
                now,
                staleness::ttl_for_entry_with(
                    harness_kind,
                    &context_id,
                    self.config.ttl_base,
                    self.config.ttl_jitter_span,
                ),
            );
            if freshness.is_stale() {
                return None;
            }
            let ids: Vec<String> = entry.models.into_iter().map(|model| model.id).collect();
            Some((context_id, ids))
        });

        ObservedUniverse::from_observations(observations.collect::<Vec<_>>())
    }
}

/// The seam launch validation reads the universe through.
///
/// A trait rather than a direct `Arc<ModelSnapshotService>` dependency for two
/// reasons, both structural. `SessionService` and `create_session` live in the
/// sessions domain and must not grow a handle to the agents domain's probe engine to
/// answer a pure question. And the engine's construction is heavyweight — it takes a
/// filesystem lock on the runtime home and sweeps scratch roots — so making it a
/// prerequisite of every catalog test would put an flock in the middle of pure
/// validation suites.
///
/// The default implementation is the pre-probe universe, which is exactly today's
/// behavior; that is what lets every existing call site and test keep working
/// unchanged while the wired paths get the real one.
pub trait ObservedUniverseSource: Send + Sync {
    fn observed_universe(&self, harness_kind: &str) -> ObservedUniverse;
}

impl ObservedUniverseSource for ModelSnapshotService {
    fn observed_universe(&self, harness_kind: &str) -> ObservedUniverse {
        ModelSnapshotService::observed_universe(self, harness_kind)
    }
}

/// The no-observation source: every harness validates against the shipped catalog
/// alone. Used by surfaces with no engine (tests, and any construction that
/// legitimately has no runtime home).
pub struct NoObservations;

impl ObservedUniverseSource for NoObservations {
    fn observed_universe(&self, _harness_kind: &str) -> ObservedUniverse {
        ObservedUniverse::empty()
    }
}
