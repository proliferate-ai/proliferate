//! The ACTIVE agent catalog: constructed ONCE at boot and held for the
//! lifetime of the process.
//!
//! TRANSPORT LAW (agent-distribution.md, "Convergence"): the runtime binary
//! is the primary catalog transport, and the compiled-in `catalog.json`
//! (`include_str!`'d, [`super::bundled`]) is always the FLOOR — a machine
//! that never fetches anything is fully correct. Since rung 5 (FR-1), a
//! second transport exists: a signed, versioned artifact fetched at BOOT
//! ONLY (`super::artifact`), gated behind `ANYHARNESS_CATALOG_ARTIFACT_BASE_URL`
//! being set at all. This consciously supersedes commit 796ff1f08's
//! conclusion that the binary is the ONLY transport, while deliberately
//! PRESERVING the invariant that conclusion protected: **the active catalog
//! is immutable for the lifetime of the runtime process.** The staged-vs-
//! bundled choice is made exactly ONCE, at construction, from data already on
//! disk or freshly fetched before `AppState::new` runs — never again after
//! that. There is still no live sync layer and no mid-lifetime push: the
//! historical heartbeat transport (worker-side `catalog_sync.rs`,
//! `PUT /v1/catalogs/agents`, `apply_fetched`, and the catalog-applied
//! reconcile poke) stays deleted. The runtime keeps the read-only
//! `GET /v1/catalogs/agents/version` observability route, now reporting
//! `source: "bundled" | "staged"`.

use std::path::Path;
use std::sync::Arc;

use super::artifact::{load_staged_from_disk, StagedArtifactPair};
use super::bundled::bundled_agent_catalog_document;
use super::schema::AgentCatalogDocument;
use crate::domains::agents::registry::bundled::bundled_agent_registry_document;
use crate::domains::agents::registry::schema::AgentRegistryDocument;

/// Where the active catalog came from. Reported on the read route so an
/// operator can see the answer explicitly rather than infer it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogSource {
    /// The compiled-in document — the floor, always correct on its own.
    Bundled,
    /// A signed, versioned artifact fetched at boot and staged to disk,
    /// activated because it validated and was strictly newer than the floor.
    Staged,
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

/// Holds the ACTIVE catalog AND registry document, decided together
/// (all-or-nothing pairing) at wiring (`app/mod.rs`). All consumers read
/// through [`super::service::AgentCatalogService`]; the registry analog has
/// no equivalent service yet (registry consumers still read the bundled
/// floor directly — see rung 5's PR notes for the residual).
pub struct CatalogSyncService {
    active: AppliedCatalog,
    active_registry: Arc<AgentRegistryDocument>,
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
            active_registry: Arc::new(bundled_agent_registry_document().clone()),
        }
    }

    /// Boot-time constructor (FR-1): loads any previously staged artifact
    /// from disk, and — only when `base_url` is `Some` (the ADR gate; an
    /// absent env var means this function never looks at the network) —
    /// attempts one best-effort fetch of a fresh artifact, staging it before
    /// deciding. The activation decision runs ONCE here: staged wins over
    /// bundled iff a staged pair is available (freshly fetched or loaded
    /// from disk) AND its `generated_at` is strictly newer than the bundled
    /// floor's, comparing RFC3339 instants — never the dotted version string
    /// lexicographically (`.9` vs `.10` breaks under string ordering).
    /// Catalog and registry always activate as the SAME pair; there is no
    /// path that mixes a staged catalog with the bundled registry or vice
    /// versa.
    pub fn from_staged_or_bundled(
        runtime_home: &Path,
        base_url: Option<&str>,
        channel: &str,
        client: &dyn super::artifact::ArtifactFetchClient,
        pubkeys: &[minisign_verify::PublicKey],
    ) -> Self {
        let staged_dir = runtime_home.join("catalog").join("staged");

        if let Some(base_url) = base_url {
            match super::artifact::fetch_and_stage(base_url, channel, &staged_dir, client, pubkeys) {
                Ok(_) => {}
                Err(rejected) => {
                    tracing::info!(
                        reason = rejected.reason.as_str(),
                        "catalog artifact fetch did not produce a fresh staged pair; falling back to the existing staged pair or the bundled floor"
                    );
                }
            }
        }

        let staged = load_staged_from_disk(&staged_dir);
        Self::from_bundled_and_staged(staged)
    }

    /// Production entrypoint: the ONE call `app/mod.rs` makes at wiring
    /// time, reading the ADR-gate env var, the channel env var, and the
    /// baked signing pubkey(s) itself. Never touches the network when
    /// [`super::artifact::env_base_url`] is absent OR when no pubkey is
    /// provisioned yet — both degrade silently to the load-from-disk-or-
    /// bundled path, never a boot failure.
    pub fn from_bundled_and_staged_via_env(runtime_home: &Path) -> Self {
        let base_url = super::artifact::env_base_url();
        let channel = super::artifact::env_channel();
        let pubkeys: Vec<minisign_verify::PublicKey> = [
            super::artifact::baked_pubkey(),
            super::artifact::baked_pubkey_next(),
        ]
        .into_iter()
        .flatten()
        .collect();

        if base_url.is_some() && pubkeys.is_empty() {
            tracing::warn!(
                "ANYHARNESS_CATALOG_ARTIFACT_BASE_URL is set but no catalog signing pubkey is provisioned; the fetch step is skipped and the lane stays on the previously staged artifact (if any) or the bundled floor"
            );
        }
        let should_fetch = base_url.is_some() && !pubkeys.is_empty();
        let client = super::artifact::BoundedHttpFetchClient::new();
        Self::from_staged_or_bundled(
            runtime_home,
            should_fetch.then(|| base_url.as_deref()).flatten(),
            &channel,
            &client,
            &pubkeys,
        )
    }

    /// Pure decision function extracted for testability: given whatever
    /// staged pair (if any) is on disk, apply the ONE activation rule.
    fn from_bundled_and_staged(staged: Option<StagedArtifactPair>) -> Self {
        let bundled_document = bundled_agent_catalog_document().clone();
        let bundled_registry = bundled_agent_registry_document().clone();
        let bundled_generated_at =
            chrono::DateTime::parse_from_rfc3339(&bundled_document.generated_at)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::DateTime::<chrono::Utc>::MIN_UTC);

        match staged {
            Some(staged) if staged.generated_at > bundled_generated_at => {
                let version = staged.catalog.catalog_version.clone();
                Self {
                    active: AppliedCatalog {
                        document: Arc::new(staged.catalog),
                        version,
                        source: CatalogSource::Staged,
                    },
                    active_registry: Arc::new(staged.registry),
                }
            }
            _ => {
                let version = bundled_document.catalog_version.clone();
                Self {
                    active: AppliedCatalog {
                        document: Arc::new(bundled_document),
                        version,
                        source: CatalogSource::Bundled,
                    },
                    active_registry: Arc::new(bundled_registry),
                }
            }
        }
    }

    /// Cheap snapshot of the active catalog.
    pub fn active(&self) -> AppliedCatalog {
        self.active.clone()
    }

    /// The registry paired with the active catalog (same staged artifact, or
    /// both bundled — never mixed).
    pub fn active_registry(&self) -> Arc<AgentRegistryDocument> {
        self.active_registry.clone()
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

    fn staged_pair_at(generated_at: chrono::DateTime<chrono::Utc>) -> StagedArtifactPair {
        let mut catalog = bundled_agent_catalog_document().clone();
        catalog.catalog_version = "staged-test-version".to_string();
        catalog.generated_at = generated_at.to_rfc3339();
        StagedArtifactPair {
            catalog,
            registry: bundled_agent_registry_document().clone(),
            generated_at,
        }
    }

    #[test]
    fn staged_wins_when_strictly_newer_than_the_floor() {
        let future = chrono::Utc::now() + chrono::Duration::days(3650);
        let service = CatalogSyncService::from_bundled_and_staged(Some(staged_pair_at(future)));

        let active = service.active();
        assert_eq!(active.source, CatalogSource::Staged);
        assert_eq!(active.version, "staged-test-version");
    }

    #[test]
    fn floor_wins_when_staged_is_not_strictly_newer() {
        let epoch = chrono::DateTime::<chrono::Utc>::from_timestamp(0, 0).unwrap();
        let service = CatalogSyncService::from_bundled_and_staged(Some(staged_pair_at(epoch)));

        let active = service.active();
        assert_eq!(active.source, CatalogSource::Bundled);
    }

    #[test]
    fn floor_wins_when_no_staged_pair_exists() {
        let service = CatalogSyncService::from_bundled_and_staged(None);

        let active = service.active();
        assert_eq!(active.source, CatalogSource::Bundled);
    }

    #[test]
    fn activation_pairs_the_staged_catalog_with_the_staged_registry_never_the_bundled_one() {
        let future = chrono::Utc::now() + chrono::Duration::days(3650);
        let mut pair = staged_pair_at(future);
        pair.registry.registry_version = "staged-registry-version".to_string();
        let service = CatalogSyncService::from_bundled_and_staged(Some(pair));

        assert_eq!(
            service.active_registry().registry_version,
            "staged-registry-version"
        );
    }

    /// Second tripwire: even with a staged pair on disk, one snapshot equals
    /// the next — the decision is made once at construction, not re-evaluated
    /// per read.
    #[test]
    fn active_catalog_stays_immutable_even_when_a_staged_pair_exists() {
        let future = chrono::Utc::now() + chrono::Duration::days(3650);
        let service = CatalogSyncService::from_bundled_and_staged(Some(staged_pair_at(future)));

        let first = service.active();
        let second = service.active();
        assert!(Arc::ptr_eq(&first.document, &second.document));
        assert_eq!(first.source, second.source);
    }
}
