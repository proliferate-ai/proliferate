//! Projecting the machine document into the launch-validation universe.
//!
//! One rule: **any observation serves — age never disqualifies** (model-catalog.md,
//! "The picker is the observation"). There is no staleness evaluation, no
//! fingerprint comparison, and no per-context filtering: the document either
//! exists (schema-matched) and its model ids are the universe, or it does not and
//! the universe is empty (the shipped catalog's seed fills in downstream).
//!
//! This read never waits, never probes, and never consults the engine's live
//! state: launching during a refresh window validates against the current
//! observation, so switching auth or updating a harness never locks the user out
//! of starting a session while the probe catches up.

use super::document::read_document;
use super::ModelSnapshotService;
use crate::domains::agents::catalog::universe::ObservedUniverse;

impl ModelSnapshotService {
    /// The observed universe for one harness: the composed observation's model
    /// ids, or empty when no document exists.
    ///
    /// Available in read-only mode, like every other read: a runtime that does not
    /// own the probe engine still validates launches against whatever the owner
    /// observed.
    pub fn observed_universe(&self, harness_kind: &str) -> ObservedUniverse {
        match read_document(&self.runtime_home, harness_kind) {
            Some(document) => {
                ObservedUniverse::from_observation(document.models.into_iter().map(|model| model.id))
            }
            None => ObservedUniverse::empty(),
        }
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
/// The default implementation is the pre-probe universe, which is exactly the
/// seed behavior; that is what lets every existing call site and test keep working
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
