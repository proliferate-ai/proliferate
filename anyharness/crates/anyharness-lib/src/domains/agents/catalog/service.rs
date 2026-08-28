//! The single read surface over the active agent catalog.
//!
//! The catalog owns distribution pins, route/auth metadata, and presentation
//! prose. It does not own executable launch membership, validation, or defaults.

use std::collections::BTreeMap;
use std::sync::Arc;

use super::schema::{
    AgentCatalogAgent, AgentCatalogArtifactPin, AgentCatalogArtifactSource,
    AgentCatalogAuthContext, AgentCatalogDocument, AgentCatalogHarnessPins, AgentCatalogPinTarget,
};
use super::sync::CatalogSyncService;
use crate::domains::agents::installer::install_policy::{
    PinOverrides, ResolvedPinSource, ResolvedPinTarget,
};

/// Read surface over the active catalog held by [`CatalogSyncService`].
#[derive(Clone)]
pub struct AgentCatalogService {
    sync: Arc<CatalogSyncService>,
}

impl AgentCatalogService {
    pub fn new(sync: Arc<CatalogSyncService>) -> Self {
        Self { sync }
    }

    /// Catalog pin overrides for the installer (None when the kind is
    /// unknown to the active catalog). Carries both the version (drift) and
    /// the resolved, fenced install source (materialization) per role.
    pub fn pin_overrides(&self, kind: &str) -> Option<PinOverrides> {
        self.active_catalog().pin_overrides(kind)
    }

    pub fn active_catalog(&self) -> ActiveCatalog {
        ActiveCatalog::new(self.sync.active().document)
    }
}

/// Placeholder pins ("unknown" — e.g. cursor pre manifest-provenance) must
/// not drive drift: an unknowable pin is no pin.
fn usable_version(version: &str) -> Option<String> {
    (!version.is_empty() && version != "unknown").then(|| version.to_string())
}

/// The comparable install identity used for version-drift detection.
///
/// Git-sourced pins are materialized and recorded by their resolved commit
/// sha, not the catalog's human-readable `version` label — see
/// `installer::managed_npm::npm_package_version`'s non-registry-spec
/// handling (git/github/file/http(s) specs), which treats the text after `#`
/// as the installed artifact's recorded "version". Comparing that recorded
/// sha against a semver-looking label like `"0.44.0"` never converges: it
/// would force a reinstall on every startup reconcile pass forever. Use the
/// same git ref on the pinned side so the comparison can actually match once
/// installed. Non-git sources are unaffected: they already record the
/// declared label (Binary/Archive install it verbatim; registry Npm specs
/// read a matching version back from the installed package.json).
fn pin_identity(declared_version: &str, source: Option<&ResolvedPinSource>) -> Option<String> {
    match source {
        Some(ResolvedPinSource::Git { git_ref, .. }) => usable_version(git_ref),
        _ => usable_version(declared_version),
    }
}

/// Project a catalog artifact pin's resolved source (schema) into the
/// installer-domain `ResolvedPinSource`. `None` when the pin has no source
/// (legacy pre-lockfile pin) — the installer then uses the registry spec.
fn project_source(pin: &AgentCatalogArtifactPin) -> Option<ResolvedPinSource> {
    let targets = |targets: &BTreeMap<String, AgentCatalogPinTarget>| {
        targets
            .iter()
            .map(|(platform, target)| {
                (
                    platform.clone(),
                    ResolvedPinTarget {
                        url: target.url.clone(),
                        sha256: target.sha256.clone(),
                        download_size_bytes: target.download_size_bytes,
                        expected_binary: target.expected_binary.clone(),
                    },
                )
            })
            .collect()
    };
    Some(match pin.source.as_ref()? {
        AgentCatalogArtifactSource::Binary { targets: t } => ResolvedPinSource::Binary {
            targets: targets(t),
        },
        AgentCatalogArtifactSource::Archive { targets: t, args } => ResolvedPinSource::Archive {
            targets: targets(t),
            args: args.clone(),
        },
        AgentCatalogArtifactSource::Npm {
            package,
            sha256,
            args,
        } => ResolvedPinSource::Npm {
            package: package.clone(),
            sha256: sha256.clone(),
            args: args.clone(),
        },
        AgentCatalogArtifactSource::Git {
            repo,
            git_ref,
            package_subdir,
            executable_relpath,
        } => ResolvedPinSource::Git {
            repo: repo.clone(),
            git_ref: git_ref.clone(),
            package_subdir: package_subdir.clone(),
            executable_relpath: executable_relpath.clone(),
        },
    })
}

/// A pinned catalog snapshot: readers borrow from it for as long as they
/// hold it, and keep a consistent document across concurrent sync swaps.
#[derive(Debug, Clone)]
pub struct ActiveCatalog {
    document: Arc<AgentCatalogDocument>,
}

impl ActiveCatalog {
    pub fn new(document: Arc<AgentCatalogDocument>) -> Self {
        Self { document }
    }

    pub fn agents(&self) -> &[AgentCatalogAgent] {
        &self.document.agents
    }

    pub fn catalog_version(&self) -> &str {
        &self.document.catalog_version
    }

    pub fn agent(&self, kind: &str) -> Option<&AgentCatalogAgent> {
        self.agents().iter().find(|agent| agent.kind == kind)
    }

    /// Harness version pins for the kind (installer + readiness drift).
    pub fn pins(&self, kind: &str) -> Option<&AgentCatalogHarnessPins> {
        self.agent(kind).map(|agent| &agent.harness)
    }

    pub(crate) fn pin_overrides(&self, kind: &str) -> Option<PinOverrides> {
        let pins = self.pins(kind)?;
        let agent_process_source = project_source(&pins.agent_process);
        let native_source = pins.native.as_ref().and_then(project_source);
        Some(PinOverrides {
            agent_process: pin_identity(&pins.agent_process.version, agent_process_source.as_ref()),
            native: pins
                .native
                .as_ref()
                .and_then(|pin| pin_identity(&pin.version, native_source.as_ref())),
            agent_process_source,
            native_source,
        })
    }

    /// The agent's ordered auth-context signatures (classifier input).
    pub fn auth_contexts(&self, kind: &str) -> Option<&[AgentCatalogAuthContext]> {
        self.agent(kind).map(|agent| agent.auth_contexts.as_slice())
    }

    /// Version-level goal support declared for the pinned harness. The live
    /// session capability stays ACP-advertised (initialize `_meta`); this is
    /// the catalog-declared flag for surfaces without a live handshake.
    ///
    /// MUST NOT gate a live goal mutation: that authority is solely the
    /// session's `_meta.anyharness.goals.supported` initialize advertisement
    /// (see `domains::goals::runtime` + `supports_goals_from_init_meta`). This
    /// flag can legitimately drift ahead
    /// of the pinned sidecar binary (declared before the fork ships the ext
    /// methods), so trusting it to drive a mutation would try to set goals on a
    /// sidecar that cannot service them. It exists only for pre-session
    /// surfaces (e.g. an agent picker) that have no live handshake to consult.
    pub fn supports_goals(&self, kind: &str) -> bool {
        self.agent(kind)
            .map(|agent| agent.session.supports_goals)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod pin_identity_tests {
    use super::*;

    fn git_source(git_ref: &str) -> ResolvedPinSource {
        ResolvedPinSource::Git {
            repo: "https://github.com/proliferate-ai/claude-agent-acp.git".into(),
            git_ref: git_ref.into(),
            package_subdir: None,
            executable_relpath: "node_modules/.bin/claude-agent-acp".into(),
        }
    }

    #[test]
    fn git_sourced_pin_identity_is_the_commit_sha_not_the_display_version() {
        // Regression for the claude agent_process reinstall loop: the catalog
        // pin's declared "version" is a display label ("0.44.0"), but a
        // git-sourced install records the resolved commit sha as its
        // installed version (see managed_npm::npm_package_version's
        // non-registry-spec handling). Comparing the label against the sha
        // never converges, forcing a reinstall on every startup reconcile.
        let sha = "3ff484e671de5fe9275d2e7596d683df06b99e14";
        let source = git_source(sha);
        assert_eq!(pin_identity("0.44.0", Some(&source)), Some(sha.to_string()));
    }

    #[test]
    fn non_git_sourced_pin_identity_keeps_the_declared_label() {
        let source = ResolvedPinSource::Binary {
            targets: Default::default(),
        };
        assert_eq!(
            pin_identity("2.1.181", Some(&source)),
            Some("2.1.181".to_string())
        );
    }

    #[test]
    fn no_source_falls_back_to_declared_label() {
        assert_eq!(pin_identity("1.0.0", None), Some("1.0.0".to_string()));
    }

    #[test]
    fn placeholder_versions_are_not_usable_pins() {
        let source = git_source("");
        assert_eq!(pin_identity("unknown", Some(&source)), None);
        assert_eq!(pin_identity("", None), None);
    }
}
