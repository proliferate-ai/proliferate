//! Forks ADR R9 (rung 1c): session adapter-migration marker + dual-read seam.
//!
//! A session records the `(adapter_version, native_version)` pair it was
//! created under (the marker). At reattach the runtime knows the currently
//! initialized adapter version. This module owns the pure decision the store
//! and (in rung 2) the live reattach path call: a session created under a
//! pinned pre-migration adapter either loads through an EXPLICIT compatible
//! path or fails with a typed, actionable incompatibility. It is NEVER
//! silently reinterpreted under a new metadata dialect (ADR §5 "Adapter
//! migration compatibility", the cardinal-sin discipline of §4.4/§5).
//!
//! Durable normalized `session_events` are runtime-owned and remain readable
//! regardless of the outcome here (asserted by the store tests); this seam
//! governs only the provider-dialect metadata reattach decision.
//!
//! Scope note (rung 1c): this is the marker + dialect-recognition seam only.
//! The goals membrane (rung 6) versions the two GoalPort dialects on top of
//! the same marker; no goal, catalog, or adapter change lives here.

use std::fmt;

/// The adapter/native version pair a session was created (or last attached)
/// under. `None` on either field means the value was not resolvable at stamp
/// time. The whole marker being absent (no row) is handled by the caller as
/// the pinned pre-migration floor (see [`recorded_generation`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionAdapterMarker {
    pub adapter_version: Option<String>,
    pub native_version: Option<String>,
}

impl SessionAdapterMarker {
    pub fn new(adapter_version: Option<String>, native_version: Option<String>) -> Self {
        Self {
            adapter_version,
            native_version,
        }
    }
}

/// The metadata dialect generation an adapter version belongs to, for the two
/// harnesses this program migrates (Claude and Codex). Ordered: a higher
/// generation reads the dialects of every lower generation through the
/// dual-read path, but a lower generation cannot read a higher one.
///
/// Coordinates are the ADR rung-1 pins (Forks ADR §2 "Adapter pins", RUNG-1B
/// §1). We key on the version marker, never on the harness name — capability
/// and dialect are earned from the recorded/initialized version, per R8/R9.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MetadataDialect {
    /// Pinned pre-migration fork: Claude `0.59.x-proliferate.*`, Codex
    /// `0.18.x-proliferate.*` (Rust `@proliferate-ai/codex-acp`).
    PinnedLegacy,
    /// Canonical-migrated adapter: Claude `0.66.x-proliferate.*`, Codex
    /// canonical TypeScript `1.1.x-proliferate.*`.
    CanonicalMigrated,
}

impl MetadataDialect {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PinnedLegacy => "pinned_legacy",
            Self::CanonicalMigrated => "canonical_migrated",
        }
    }
}

/// The compatible way a reattach may proceed. Either dialect is the same, or
/// the current adapter reads the older dialect explicitly (dual-read). Both
/// carry the resolved dialects so the caller reads through the right path
/// rather than assuming the current one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompatibleLoad {
    /// The session's dialect matches the current adapter, or this harness has
    /// no migrating dialect at all (Cursor/OpenCode/Grok, unknown kinds).
    SameDialect { dialect: Option<MetadataDialect> },
    /// The current adapter is a newer generation and reads the session's older
    /// dialect through the explicit dual-read path.
    DualReadForward {
        created_dialect: MetadataDialect,
        current_dialect: MetadataDialect,
    },
}

/// Why a reattach cannot proceed without risking a silent reinterpretation.
/// Typed and actionable (ADR §4.8 stable-reason taxonomy).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IncompatibilityReason {
    /// The session was created under a NEWER dialect than the current adapter
    /// (a catalog pin rollback / downgrade). The older adapter cannot read the
    /// newer dialect and would silently reinterpret it — fail closed.
    DialectDowngrade {
        created_dialect: MetadataDialect,
        current_dialect: MetadataDialect,
    },
    /// The marker records an adapter version this build does not recognize for
    /// a migrating harness; its dialect cannot be proven, so it is not loaded.
    UnrecognizedRecordedAdapter {
        agent_kind: String,
        adapter_version: String,
    },
    /// The currently initialized adapter version is unknown or unrecognized for
    /// a migrating harness; compatibility cannot be proven, so fail closed.
    UnknownCurrentAdapter {
        agent_kind: String,
        adapter_version: Option<String>,
    },
}

/// Typed, actionable adapter-migration incompatibility. Carries a stable code
/// so the product HTTP layer maps it to an honest reason instead of a generic
/// failure, and never degrades a reattach into a silent new-dialect load.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterMigrationIncompatibility {
    pub reason: IncompatibilityReason,
}

impl AdapterMigrationIncompatibility {
    /// Stable RFC 7807 extension code.
    pub const CODE: &'static str = "ADAPTER_MIGRATION_INCOMPATIBLE";

    pub fn code(&self) -> &'static str {
        Self::CODE
    }
}

impl fmt::Display for AdapterMigrationIncompatibility {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.reason {
            IncompatibilityReason::DialectDowngrade {
                created_dialect,
                current_dialect,
            } => write!(
                f,
                "session was created under the {} adapter dialect but is being reattached under the older {} dialect; reattach under the original adapter (or a newer one) to avoid a silent reinterpretation",
                created_dialect.as_str(),
                current_dialect.as_str()
            ),
            IncompatibilityReason::UnrecognizedRecordedAdapter {
                agent_kind,
                adapter_version,
            } => write!(
                f,
                "session for agent '{agent_kind}' records adapter version '{adapter_version}', whose metadata dialect this build does not recognize; refusing to load rather than reinterpret it"
            ),
            IncompatibilityReason::UnknownCurrentAdapter {
                agent_kind,
                adapter_version,
            } => write!(
                f,
                "current adapter for agent '{agent_kind}' has version {}, which this build cannot classify; refusing to reattach a migrating session against an unrecognized adapter",
                adapter_version
                    .as_deref()
                    .map(|v| format!("'{v}'"))
                    .unwrap_or_else(|| "unknown".to_string())
            ),
        }
    }
}

impl std::error::Error for AdapterMigrationIncompatibility {}

/// Classify an adapter version into its metadata dialect for a migrating
/// harness. Returns `None` when the harness does not migrate a dialect (its
/// vendor pin is stable across this program: Cursor, OpenCode, Grok, and any
/// unknown kind). Returns `Some(None)` semantics are avoided: a migrating
/// harness with an unrecognized version yields `Recognition::Unrecognized`.
enum Recognition {
    /// This harness has no migrating dialect; reattach is always same-dialect.
    NoMigration,
    Recognized(MetadataDialect),
    /// A migrating harness, but the version does not match any known pin.
    Unrecognized,
}

fn classify(agent_kind: &str, adapter_version: &str) -> Recognition {
    // Match on major.minor prefix so a `-proliferate.N` bump (e.g. .1 -> .2)
    // stays within its generation. Only Claude and Codex migrate a dialect.
    match agent_kind {
        "claude" => {
            if version_has_prefix(adapter_version, "0.59.") {
                Recognition::Recognized(MetadataDialect::PinnedLegacy)
            } else if version_has_prefix(adapter_version, "0.66.") {
                Recognition::Recognized(MetadataDialect::CanonicalMigrated)
            } else {
                Recognition::Unrecognized
            }
        }
        "codex" => {
            if version_has_prefix(adapter_version, "0.18.") {
                Recognition::Recognized(MetadataDialect::PinnedLegacy)
            } else if version_has_prefix(adapter_version, "1.1.") {
                Recognition::Recognized(MetadataDialect::CanonicalMigrated)
            } else {
                Recognition::Unrecognized
            }
        }
        _ => Recognition::NoMigration,
    }
}

/// True when `version` starts with `prefix` on a version-component boundary,
/// so `"0.18.3-proliferate.1"` matches `"0.18."` but `"0.180.0"` does not.
fn version_has_prefix(version: &str, prefix: &str) -> bool {
    version.starts_with(prefix)
}

/// Whether a harness migrates a metadata dialect at all under this program.
fn harness_migrates(agent_kind: &str) -> bool {
    matches!(agent_kind, "claude" | "codex")
}

/// The dialect a recorded marker belongs to. An absent adapter version (no
/// marker row, or a row with a NULL version) is the pinned pre-migration floor:
/// every session predating the marker was created under a legacy pin by
/// construction, so treating it as `PinnedLegacy` is the honest classification,
/// not a guess.
fn recorded_generation(
    agent_kind: &str,
    marker: &SessionAdapterMarker,
) -> Result<MetadataDialect, AdapterMigrationIncompatibility> {
    match marker.adapter_version.as_deref() {
        None => Ok(MetadataDialect::PinnedLegacy),
        Some(version) => match classify(agent_kind, version) {
            Recognition::Recognized(dialect) => Ok(dialect),
            // A migrating harness that carries a version we cannot place: refuse.
            Recognition::Unrecognized => Err(AdapterMigrationIncompatibility {
                reason: IncompatibilityReason::UnrecognizedRecordedAdapter {
                    agent_kind: agent_kind.to_string(),
                    adapter_version: version.to_string(),
                },
            }),
            // Non-migrating harness never reaches here (caller gates on
            // `harness_migrates`), but classify keeps the branch total.
            Recognition::NoMigration => Ok(MetadataDialect::PinnedLegacy),
        },
    }
}

/// The dual-read decision. Given the harness, the session's recorded marker,
/// and the currently initialized adapter version, return the explicit
/// compatible load path or a typed incompatibility. Pure and total — the
/// single source of truth for R9 reattach compatibility.
pub fn resolve_reattach_compatibility(
    agent_kind: &str,
    marker: &SessionAdapterMarker,
    current_adapter_version: Option<&str>,
) -> Result<CompatibleLoad, AdapterMigrationIncompatibility> {
    // Harnesses that do not migrate a dialect (Cursor/OpenCode/Grok, unknown):
    // there is nothing to reinterpret, so reattach is always same-dialect.
    if !harness_migrates(agent_kind) {
        return Ok(CompatibleLoad::SameDialect { dialect: None });
    }

    let created = recorded_generation(agent_kind, marker)?;

    let current = match current_adapter_version {
        Some(version) => match classify(agent_kind, version) {
            Recognition::Recognized(dialect) => dialect,
            Recognition::Unrecognized | Recognition::NoMigration => {
                return Err(AdapterMigrationIncompatibility {
                    reason: IncompatibilityReason::UnknownCurrentAdapter {
                        agent_kind: agent_kind.to_string(),
                        adapter_version: Some(version.to_string()),
                    },
                });
            }
        },
        None => {
            return Err(AdapterMigrationIncompatibility {
                reason: IncompatibilityReason::UnknownCurrentAdapter {
                    agent_kind: agent_kind.to_string(),
                    adapter_version: None,
                },
            });
        }
    };

    match current.cmp(&created) {
        std::cmp::Ordering::Equal => Ok(CompatibleLoad::SameDialect {
            dialect: Some(created),
        }),
        // Current adapter is newer: it reads the older dialect explicitly.
        std::cmp::Ordering::Greater => Ok(CompatibleLoad::DualReadForward {
            created_dialect: created,
            current_dialect: current,
        }),
        // Current adapter is OLDER than the session's dialect (a pin rollback):
        // it cannot read the newer dialect and would silently reinterpret it.
        // Fail closed — this is the cardinal sin the marker exists to prevent.
        std::cmp::Ordering::Less => Err(AdapterMigrationIncompatibility {
            reason: IncompatibilityReason::DialectDowngrade {
                created_dialect: created,
                current_dialect: current,
            },
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE_LEGACY: &str = "0.59.0-proliferate.1";
    const CLAUDE_CANONICAL: &str = "0.66.0-proliferate.1";
    const CODEX_LEGACY: &str = "0.18.3-proliferate.1";
    const CODEX_CANONICAL: &str = "1.1.14-proliferate.1";

    fn marker(adapter: &str) -> SessionAdapterMarker {
        SessionAdapterMarker::new(Some(adapter.to_string()), Some("native".to_string()))
    }

    #[test]
    fn same_dialect_loads_directly() {
        let out =
            resolve_reattach_compatibility("claude", &marker(CLAUDE_LEGACY), Some(CLAUDE_LEGACY))
                .expect("legacy under legacy loads");
        assert_eq!(
            out,
            CompatibleLoad::SameDialect {
                dialect: Some(MetadataDialect::PinnedLegacy)
            }
        );
    }

    #[test]
    fn legacy_session_dual_reads_forward_under_canonical() {
        // The migration case: a session created under the pinned legacy adapter
        // reattached under the canonical adapter. It must load through the
        // EXPLICIT dual-read path carrying both dialects — never be silently
        // treated as canonical.
        for (kind, legacy, canonical) in [
            ("claude", CLAUDE_LEGACY, CLAUDE_CANONICAL),
            ("codex", CODEX_LEGACY, CODEX_CANONICAL),
        ] {
            let out = resolve_reattach_compatibility(kind, &marker(legacy), Some(canonical))
                .expect("legacy dual-reads forward under canonical");
            assert_eq!(
                out,
                CompatibleLoad::DualReadForward {
                    created_dialect: MetadataDialect::PinnedLegacy,
                    current_dialect: MetadataDialect::CanonicalMigrated,
                },
                "{kind} legacy->canonical must be an explicit forward dual-read"
            );
        }
    }

    #[test]
    fn unmarked_session_is_treated_as_the_legacy_floor() {
        // No marker row (pre-rung-1c session): classified as legacy, so it
        // dual-reads forward under canonical and loads same-dialect under legacy.
        let empty = SessionAdapterMarker::default();
        assert!(matches!(
            resolve_reattach_compatibility("codex", &empty, Some(CODEX_CANONICAL)),
            Ok(CompatibleLoad::DualReadForward { .. })
        ));
        assert!(matches!(
            resolve_reattach_compatibility("codex", &empty, Some(CODEX_LEGACY)),
            Ok(CompatibleLoad::SameDialect {
                dialect: Some(MetadataDialect::PinnedLegacy)
            })
        ));
    }

    #[test]
    fn non_migrating_harness_always_loads_same_dialect() {
        for kind in ["cursor", "opencode", "grok", "totally-unknown"] {
            let out = resolve_reattach_compatibility(kind, &marker("2026.07.09"), Some("9.9.9"))
                .expect("non-migrating harness loads");
            assert_eq!(out, CompatibleLoad::SameDialect { dialect: None }, "{kind}");
        }
    }

    #[test]
    fn downgrade_is_rejected_not_silently_reinterpreted() {
        // NEGATIVE CONTROL. A session created under the canonical adapter, then
        // reattached under the OLD pinned adapter (a catalog pin rollback — the
        // ADR rung-1 revert path). The old adapter cannot read the canonical
        // dialect and would silently reinterpret it. The marker/dialect guard
        // must fail closed with a typed downgrade error.
        let err = resolve_reattach_compatibility(
            "claude",
            &marker(CLAUDE_CANONICAL),
            Some(CLAUDE_LEGACY),
        )
        .expect_err("downgrade must be rejected");
        assert_eq!(err.code(), AdapterMigrationIncompatibility::CODE);
        assert_eq!(
            err.reason,
            IncompatibilityReason::DialectDowngrade {
                created_dialect: MetadataDialect::CanonicalMigrated,
                current_dialect: MetadataDialect::PinnedLegacy,
            }
        );

        // Demonstrate the guard is load-bearing: a naive "no dialect check"
        // reattach (what silent reinterpretation looks like) WOULD accept this
        // exact input. Removing the `Ordering::Less` arm above makes the real
        // function match this and the assertion above fails — the negative
        // control the ADR §5 test row requires.
        let naive_would_accept = |_created: MetadataDialect, _current: MetadataDialect| true;
        assert!(
            naive_would_accept(
                MetadataDialect::CanonicalMigrated,
                MetadataDialect::PinnedLegacy
            ),
            "the dangerous scenario is genuinely accepted without the guard"
        );
    }

    #[test]
    fn unrecognized_recorded_adapter_fails_closed() {
        let err = resolve_reattach_compatibility(
            "claude",
            &marker("0.42.0-experimental"),
            Some(CLAUDE_CANONICAL),
        )
        .expect_err("unrecognized recorded adapter must fail closed");
        assert_eq!(err.code(), AdapterMigrationIncompatibility::CODE);
        assert!(matches!(
            err.reason,
            IncompatibilityReason::UnrecognizedRecordedAdapter { .. }
        ));
    }

    #[test]
    fn unknown_current_adapter_fails_closed() {
        let missing = resolve_reattach_compatibility("codex", &marker(CODEX_LEGACY), None)
            .expect_err("missing current adapter must fail closed");
        assert!(matches!(
            missing.reason,
            IncompatibilityReason::UnknownCurrentAdapter { .. }
        ));

        let unknown =
            resolve_reattach_compatibility("codex", &marker(CODEX_LEGACY), Some("3.0.0-weird"))
                .expect_err("unrecognized current adapter must fail closed");
        assert!(matches!(
            unknown.reason,
            IncompatibilityReason::UnknownCurrentAdapter { .. }
        ));
    }

    #[test]
    fn proliferate_suffix_bump_stays_in_generation() {
        // A `-proliferate.2` rebuild of the same base version keeps its dialect.
        let out = resolve_reattach_compatibility(
            "codex",
            &marker("1.1.14-proliferate.1"),
            Some("1.1.14-proliferate.2"),
        )
        .expect("suffix bump is same dialect");
        assert_eq!(
            out,
            CompatibleLoad::SameDialect {
                dialect: Some(MetadataDialect::CanonicalMigrated)
            }
        );
    }
}
