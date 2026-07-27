//! The ACTIVE agent catalog: the bundled document, held for the lifetime of
//! the process.
//!
//! TRANSPORT LAW (agent-distribution.md, "Convergence"): the runtime binary is
//! the only catalog transport. `catalog.json` is `include_str!`'d into the
//! binary ([`super::bundled`]), so which pins a machine is on is answered by
//! one number — the runtime version — and a runtime binary update delivers new
//! pins by definition. There is no document push and no live sync layer, which
//! is what makes the central invariant hold: **the active catalog is immutable
//! for the lifetime of the runtime process.** Pins can never move under a
//! machine mid-work; harness installs mutate only across a restart.
//!
//! The service therefore only holds and hands out the bundled document. The
//! historical heartbeat transport (worker-side `catalog_sync.rs`,
//! `PUT /v1/catalogs/agents`, `apply_fetched`, and the catalog-applied
//! reconcile poke) is deleted; the runtime keeps only the read-only
//! `GET /v1/catalogs/agents/version` observability route.

use std::sync::Arc;

use super::bundled::bundled_agent_catalog_document;
use super::schema::AgentCatalogDocument;

/// Where the active catalog came from. Under the binary-only transport law
/// there is exactly one provenance, and it is reported on the read route so an
/// operator can see the answer explicitly rather than infer it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogSource {
    /// The compiled-in document — the only source there is.
    Bundled,
}

/// Snapshot of the active catalog: the document plus its provenance. The
/// document rides an `Arc` so snapshots are cheap and readers share one
/// allocation.
#[derive(Debug, Clone)]
pub struct AppliedCatalog {
    pub document: Arc<AgentCatalogDocument>,
    pub version: String,
    pub source: CatalogSource,
}

/// Holds the ACTIVE catalog document. Constructed at wiring (`app/mod.rs`)
/// from the bundled document; all consumers read through
/// [`super::service::AgentCatalogService`].
pub struct CatalogSyncService {
    active: AppliedCatalog,
}

impl CatalogSyncService {
    pub fn from_bundled() -> Self {
        let document = bundled_agent_catalog_document().clone();
        let version = document.catalog_version.clone();
        Self {
            active: AppliedCatalog {
                document: Arc::new(document),
                version,
                source: CatalogSource::Bundled,
            },
        }
    }

    /// Cheap snapshot of the active catalog.
    pub fn active(&self) -> AppliedCatalog {
        self.active.clone()
    }

    pub fn catalog_version(&self) -> String {
        self.active.version.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstraps_from_the_bundled_document() {
        let service = CatalogSyncService::from_bundled();

        let active = service.active();
        assert_eq!(active.source, CatalogSource::Bundled);
        assert_eq!(
            active.version,
            bundled_agent_catalog_document().catalog_version
        );
        assert_eq!(active.document.schema_version, 2);
        assert_eq!(service.catalog_version(), active.version);
    }

    /// The transport law as a test: repeated reads of the active catalog are
    /// the same document at the same version, with no seam that could replace
    /// it. A future push path would have to change this file to compile.
    #[test]
    fn active_catalog_is_immutable_for_the_process_lifetime() {
        let service = CatalogSyncService::from_bundled();

        let first = service.active();
        let second = service.active();

        assert_eq!(first.version, second.version);
        assert_eq!(first.source, second.source);
        assert!(
            Arc::ptr_eq(&first.document, &second.document),
            "every read must observe the one bundled document"
        );
        assert_eq!(
            service.catalog_version(),
            bundled_agent_catalog_document().catalog_version
        );
    }
}
