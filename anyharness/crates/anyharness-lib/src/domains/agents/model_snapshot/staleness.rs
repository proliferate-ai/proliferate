//! The staleness gate: a pure decision, mirroring `installer/install_policy.rs`.
//!
//! model-catalog.md, "Staleness" names three reasons and nothing else: the
//! harness moved, the auth moved, or the entry's time budget ran out. This module
//! is the whole of that law, as a function of its inputs — no clock, no
//! filesystem, no `&self` — so every boundary is unit-assertable with an injected
//! `now`.
//!
//! Two design decisions are load-bearing enough to restate here:
//!
//! **Identity is manifest-vs-manifest, never manifest-vs-attestation.** The ACP
//! `agent_info.version` and the install manifest's `agent_process` version are
//! different namespaces: claude's manifest records the registry's pinned git sha
//! while its attestation reports a semantic version, and cursor and grok report no
//! `agent_info` at all. Comparing across them marks three of five harnesses
//! permanently stale — a probe storm on every startup, launch and auth apply that
//! backoff cannot damp, because those probes SUCCEED. So the entry records the
//! manifest identity at probe time and the gate compares that against the manifest
//! read now.
//!
//! **Indeterminate is not stale.** An absent manifest, an absent version (the
//! `source: "path"` dev-install case), or an entry written before the field
//! existed all yield [`IdentityComparison::Indeterminate`]. Treating "I cannot
//! tell" as "it moved" is exactly the storm above.

use std::time::Duration;

use chrono::{DateTime, Utc};

use super::document::{InstallIdentity, SnapshotEntry};

/// Base TTL before per-entry jitter.
pub const DEFAULT_TTL_BASE: Duration = Duration::from_secs(24 * 60 * 60);
/// Width of the deterministic per-entry jitter window.
pub const DEFAULT_TTL_JITTER_SPAN: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freshness {
    Fresh,
    Stale(StaleReason),
}

impl Freshness {
    pub fn is_stale(self) -> bool {
        matches!(self, Self::Stale(_))
    }

    pub fn reason(self) -> Option<StaleReason> {
        match self {
            Self::Stale(reason) => Some(reason),
            Self::Fresh => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StaleReason {
    Missing,
    HarnessMoved,
    AuthMoved,
    TtlExpired,
}

impl StaleReason {
    /// The wire spelling the status surface uses.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::HarnessMoved => "harnessMoved",
            Self::AuthMoved => "authMoved",
            Self::TtlExpired => "ttlExpired",
        }
    }
}

/// The three-way answer of an install-identity comparison. `Indeterminate` is a
/// first-class outcome, not an error: it is what an unobservable install looks
/// like, and it must never stale an entry on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityComparison {
    Same,
    Different,
    Indeterminate,
}

/// Compare a recorded identity against the current one.
///
/// Equal iff `sha256` matches when BOTH sides have one, else iff `version`
/// matches when both sides have one. `sha256` wins because it hashes the bytes
/// actually installed. When neither pair is comparable the answer is
/// `Indeterminate` — including the case where both sides exist but share no
/// populated field, which is a manifest we cannot reason about rather than proof
/// of a move.
pub fn compare_identity(
    recorded: Option<&InstallIdentity>,
    current: Option<&InstallIdentity>,
) -> IdentityComparison {
    let (Some(recorded), Some(current)) = (recorded, current) else {
        return IdentityComparison::Indeterminate;
    };
    if let (Some(recorded_sha), Some(current_sha)) = (&recorded.sha256, &current.sha256) {
        return if recorded_sha == current_sha {
            IdentityComparison::Same
        } else {
            IdentityComparison::Different
        };
    }
    if let (Some(recorded_version), Some(current_version)) = (&recorded.version, &current.version) {
        return if recorded_version == current_version {
            IdentityComparison::Same
        } else {
            IdentityComparison::Different
        };
    }
    IdentityComparison::Indeterminate
}

/// The gate. Precedence is identity reasons before TTL, so a surface names the
/// real cause rather than "it got old".
///
/// `ttl_for_entry` arrives already jittered (see [`ttl_for_entry`]) so this stays
/// a pure function of its inputs.
pub fn evaluate(
    entry: Option<&SnapshotEntry>,
    current_identity: Option<&InstallIdentity>,
    current_fingerprint: &str,
    now: DateTime<Utc>,
    ttl_for_entry: Duration,
) -> Freshness {
    let Some(entry) = entry else {
        return Freshness::Stale(StaleReason::Missing);
    };
    if compare_identity(entry.install_identity.as_ref(), current_identity)
        == IdentityComparison::Different
    {
        return Freshness::Stale(StaleReason::HarnessMoved);
    }
    if entry.auth_fingerprint != current_fingerprint {
        return Freshness::Stale(StaleReason::AuthMoved);
    }
    match parse_probed_at(&entry.probed_at) {
        Some(probed_at) => {
            let age = now.signed_duration_since(probed_at);
            // A negative age (clock moved backwards, or a document copied from a
            // machine ahead of this one) is not an expiry: expiring on it would
            // re-probe every entry after any clock correction.
            if age.num_seconds() > ttl_for_entry.as_secs() as i64 {
                return Freshness::Stale(StaleReason::TtlExpired);
            }
            Freshness::Fresh
        }
        // An unparseable timestamp is an entry we cannot age. Treat it as
        // expired: unlike an unobservable identity, this IS a defect in the
        // entry, and one re-probe repairs it permanently.
        None => Freshness::Stale(StaleReason::TtlExpired),
    }
}

fn parse_probed_at(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc))
}

/// This entry's TTL: the base plus a deterministic per-(harness, context) offset
/// inside the jitter span.
///
/// Why per-entry and not a flat TTL: a startup pass writes every entry within one
/// pass, so a flat TTL makes all of a machine's entries co-expire to the same
/// instant — and then every boot ≥24h later re-probes all of them, 17 real harness
/// spawns serialized to minutes by a semaphore of 1. The design created the
/// thundering herd itself. Seventeen contexts spread over 6h land ~21 minutes
/// apart, so a startup pass never queues more than one probe.
///
/// Deterministic (a hash of the key, not `rand`) so the gate stays a pure
/// function and the boundaries stay unit-testable.
pub fn ttl_for_entry(harness_kind: &str, auth_context_id: &str) -> Duration {
    ttl_for_entry_with(
        harness_kind,
        auth_context_id,
        DEFAULT_TTL_BASE,
        DEFAULT_TTL_JITTER_SPAN,
    )
}

pub fn ttl_for_entry_with(
    harness_kind: &str,
    auth_context_id: &str,
    base: Duration,
    jitter_span: Duration,
) -> Duration {
    if jitter_span.is_zero() {
        return base;
    }
    let offset = stable_hash(harness_kind, auth_context_id) % jitter_span.as_secs();
    base + Duration::from_secs(offset)
}

/// FNV-1a over `harness:context`. Chosen over `DefaultHasher` deliberately:
/// `std`'s hasher is explicitly not guaranteed stable across releases, and this
/// value must be the same on every build or a toolchain bump silently re-schedules
/// every machine's probes at once.
fn stable_hash(harness_kind: &str, auth_context_id: &str) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    let mut hash = OFFSET_BASIS;
    for byte in harness_kind
        .as_bytes()
        .iter()
        .chain(b":")
        .chain(auth_context_id.as_bytes())
    {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}
