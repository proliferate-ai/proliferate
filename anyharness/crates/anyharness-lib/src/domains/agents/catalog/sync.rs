//! Catalog sync: validated, atomic replacement of the ACTIVE agent catalog.
//!
//! The runtime always holds *some* valid catalog: it boots from the bundled
//! document and every replacement is parsed, fully validated, and only then
//! swapped in — consumers never observe a partial update. A successful swap
//! fires the injected `on_catalog_applied` capability (wired in `app/` to
//! the reconcile engine) so installs converge on the new pins.
//!
//! CONVERGE-TO-SERVER semantics: a fetched document is applied whenever its
//! `catalogVersion` DIFFERS from the active one — older is fine. The server
//! is the source of truth in both directions; "apply on different, not
//! newer" is the rollback story (reverting the catalog PR rolls the fleet
//! back on the next heartbeat).
//!
//! TRANSPORT (decision for PR-5): the runtime holds no cloud base URL and no
//! cloud credentials — the WORKER owns the cloud client and the heartbeat
//! (`proliferate-worker/src/cloud_client`, `lifecycle/heartbeat.rs`). The
//! runtime therefore never fetches; convergence rides a push:
//!
//! 1. The heartbeat response carries `catalogVersion`; the worker compares
//!    it to the runtime's active version (`ingest_advertised_version` is the
//!    runtime-side comparator, surfaced for that wiring).
//! 2. On mismatch the worker fetches `GET /v1/catalogs/agents` from the
//!    cloud (ETag-aware) and pushes the raw document into the runtime via
//!    `PUT /v1/catalogs/agents` (`api/http/catalogs.rs`, existing transport
//!    bearer auth), which lands here in [`CatalogSyncService::apply_fetched`].
//!
//! Reconcile is idempotent, so arrival order (binary first vs document
//! first) never matters.

use std::sync::{Arc, RwLock};

use super::bundled::bundled_agent_catalog_document;
use super::loader::parse_agent_catalog_json;
use super::schema::AgentCatalogDocument;

/// Where the active catalog came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogSource {
    /// The compiled-in document (boot state; never rewritten at runtime).
    Bundled,
    /// A document pushed through [`CatalogSyncService::apply_fetched`].
    Fetched,
}

/// Snapshot of the applied catalog: the document plus its sync provenance.
/// The document rides an `Arc` so snapshots are cheap and readers keep a
/// consistent document across a swap.
#[derive(Debug, Clone)]
pub struct AppliedCatalog {
    pub document: Arc<AgentCatalogDocument>,
    pub version: String,
    pub etag: Option<String>,
    pub source: CatalogSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncOutcome {
    Applied {
        from_version: String,
        to_version: String,
    },
    AlreadyCurrent,
}

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("agent catalog payload is not valid UTF-8: {0}")]
    InvalidUtf8(#[from] std::str::Utf8Error),
    #[error("agent catalog payload rejected: {0:#}")]
    InvalidCatalog(#[source] anyhow::Error),
}

/// Holds the ACTIVE catalog document and owns its replacement. Constructed
/// at wiring (`app/mod.rs`) from the bundled document; all consumers read
/// through [`super::service::AgentCatalogService`].
pub struct CatalogSyncService {
    active: RwLock<AppliedCatalog>,
    /// Capability, not a service dependency: fired after a successful swap;
    /// `app/` wires it to the reconcile engine.
    on_catalog_applied: std::sync::RwLock<Option<Arc<dyn Fn() + Send + Sync>>>,
}

impl CatalogSyncService {
    pub fn from_bundled() -> Self {
        let document = bundled_agent_catalog_document().clone();
        let version = document.catalog_version.clone();
        Self {
            active: RwLock::new(AppliedCatalog {
                document: Arc::new(document),
                version,
                etag: None,
                source: CatalogSource::Bundled,
            }),
            on_catalog_applied: std::sync::RwLock::new(None),
        }
    }

    /// Late-bind the reconcile poke (breaks the wiring cycle: the runtime
    /// holds the catalog service, and the poke holds the runtime).
    pub fn set_catalog_applied_poke(&self, on_catalog_applied: Arc<dyn Fn() + Send + Sync>) {
        *self.on_catalog_applied.write().expect("poke lock") = Some(on_catalog_applied);
    }

    /// Cheap snapshot of the active catalog.
    pub fn active(&self) -> AppliedCatalog {
        self.active
            .read()
            .expect("agent catalog lock poisoned")
            .clone()
    }

    pub fn catalog_version(&self) -> String {
        self.active
            .read()
            .expect("agent catalog lock poisoned")
            .version
            .clone()
    }

    /// Compare an externally-learned version (heartbeat-carried, delivered
    /// by the worker) to the active one. Returns whether a fetch is needed:
    /// any DIFFERENT version warrants convergence (older included).
    pub fn ingest_advertised_version(&self, version: &str) -> bool {
        version != self.catalog_version()
    }

    /// Parse -> validate (full; any error leaves the active catalog
    /// untouched) -> atomic swap when the version differs.
    #[tracing::instrument(skip(self, bytes), fields(payload_bytes = bytes.len()))]
    pub fn apply_fetched(
        &self,
        bytes: &[u8],
        etag: Option<String>,
    ) -> Result<SyncOutcome, SyncError> {
        let json = std::str::from_utf8(bytes)?;
        let document = parse_agent_catalog_json(json).map_err(SyncError::InvalidCatalog)?;
        let to_version = document.catalog_version.clone();

        let outcome = {
            let mut active = self.active.write().expect("agent catalog lock poisoned");
            if active.version == to_version {
                return Ok(SyncOutcome::AlreadyCurrent);
            }
            let from_version = active.version.clone();
            *active = AppliedCatalog {
                document: Arc::new(document),
                version: to_version.clone(),
                etag,
                source: CatalogSource::Fetched,
            };
            SyncOutcome::Applied {
                from_version,
                to_version,
            }
        };

        if let SyncOutcome::Applied {
            from_version,
            to_version,
        } = &outcome
        {
            tracing::info!(%from_version, %to_version, "agent catalog applied");
            if let Some(poke) = self.on_catalog_applied.read().expect("poke lock").clone() {
                poke();
            }
        }
        Ok(outcome)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    fn service_with_counter() -> (CatalogSyncService, Arc<AtomicUsize>) {
        let counter = Arc::new(AtomicUsize::new(0));
        let poke_counter = counter.clone();
        let service = CatalogSyncService::from_bundled();
        service.set_catalog_applied_poke(Arc::new(move || {
            poke_counter.fetch_add(1, Ordering::SeqCst);
        }));
        (service, counter)
    }

    fn bundled_json() -> String {
        serde_json::to_string(bundled_agent_catalog_document()).expect("serialize bundled")
    }

    fn bundled_with_version(version: &str) -> String {
        let mut raw: serde_json::Value =
            serde_json::from_str(&bundled_json()).expect("bundled must parse");
        raw["catalogVersion"] = serde_json::Value::String(version.to_string());
        serde_json::to_string(&raw).expect("serialize bundled")
    }

    #[test]
    fn bootstraps_from_the_bundled_document() {
        let (service, counter) = service_with_counter();

        let active = service.active();
        assert_eq!(active.source, CatalogSource::Bundled);
        assert_eq!(
            active.version,
            bundled_agent_catalog_document().catalog_version
        );
        assert_eq!(active.etag, None);
        assert_eq!(active.document.schema_version, 2);
        assert_eq!(service.catalog_version(), active.version);
        assert_eq!(counter.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn apply_same_version_is_already_current_with_no_swap() {
        let (service, counter) = service_with_counter();

        let outcome = service
            .apply_fetched(bundled_json().as_bytes(), Some("\"etag-1\"".into()))
            .expect("same-version apply must succeed");

        assert_eq!(outcome, SyncOutcome::AlreadyCurrent);
        let active = service.active();
        assert_eq!(active.source, CatalogSource::Bundled);
        assert_eq!(active.etag, None);
        assert_eq!(counter.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn apply_different_version_swaps_and_pokes_reconcile() {
        let (service, counter) = service_with_counter();
        let from_version = service.catalog_version();

        let outcome = service
            .apply_fetched(
                bundled_with_version("2099-01-01.1").as_bytes(),
                Some("\"etag-2\"".into()),
            )
            .expect("apply must succeed");

        assert_eq!(
            outcome,
            SyncOutcome::Applied {
                from_version,
                to_version: "2099-01-01.1".into(),
            }
        );
        let active = service.active();
        assert_eq!(active.source, CatalogSource::Fetched);
        assert_eq!(active.version, "2099-01-01.1");
        assert_eq!(active.etag, Some("\"etag-2\"".into()));
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn apply_older_version_swaps_too_the_rollback_story() {
        let (service, counter) = service_with_counter();
        service
            .apply_fetched(bundled_with_version("2099-01-01.1").as_bytes(), None)
            .expect("newer apply must succeed");

        let outcome = service
            .apply_fetched(bundled_with_version("2020-01-01.1").as_bytes(), None)
            .expect("older apply must succeed (rollback)");

        assert_eq!(
            outcome,
            SyncOutcome::Applied {
                from_version: "2099-01-01.1".into(),
                to_version: "2020-01-01.1".into(),
            }
        );
        assert_eq!(service.catalog_version(), "2020-01-01.1");
        assert_eq!(counter.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn invalid_payloads_are_rejected_with_active_unchanged() {
        let (service, counter) = service_with_counter();
        let before = service.active();

        let not_utf8 = service.apply_fetched(&[0xff, 0xfe, 0x00], None);
        assert!(matches!(not_utf8, Err(SyncError::InvalidUtf8(_))));

        let not_json = service.apply_fetched(b"{ not json", None);
        assert!(matches!(not_json, Err(SyncError::InvalidCatalog(_))));

        let fails_validation = service.apply_fetched(bundled_with_version(" ").as_bytes(), None);
        assert!(matches!(
            fails_validation,
            Err(SyncError::InvalidCatalog(_))
        ));

        let active = service.active();
        assert_eq!(active.version, before.version);
        assert_eq!(active.source, CatalogSource::Bundled);
        assert_eq!(counter.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn ingest_advertised_version_requests_fetch_only_on_difference() {
        let (service, _) = service_with_counter();
        let active_version = service.catalog_version();

        assert!(!service.ingest_advertised_version(&active_version));
        assert!(service.ingest_advertised_version("2020-01-01.1"));
    }
}
