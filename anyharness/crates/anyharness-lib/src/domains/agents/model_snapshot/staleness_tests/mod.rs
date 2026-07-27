//! Shared fixtures for the staleness suite; the assertions live in the sibling
//! files.
//!
//! The staleness law, the C8 storm regression, TTL boundaries and jitter, the
//! fingerprint's stability/sensitivity, and the status projection — all pure, all
//! with an injected clock.

use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{TimeZone, Utc};
#[allow(unused_imports)]
use serde_json::json;

use super::document::{
    AttemptOutcome, InstallIdentity, ModelSnapshotDocument, SnapshotAttempt, SnapshotAttestation,
    SnapshotEntry, SnapshotMode, SnapshotModel,
};
use super::fingerprint::fingerprint;
use super::staleness::{
    compare_identity, evaluate, ttl_for_entry, ttl_for_entry_with, Freshness, IdentityComparison,
    StaleReason, DEFAULT_TTL_BASE, DEFAULT_TTL_JITTER_SPAN,
};
use super::status::{self, ContextStatusInputs, LiveState};
use super::ProbeEngineMode;
use crate::domains::agents::route_auth::probe_materialization::probe_auth_material_for_server;
use crate::domains::agents::route_auth::test_support::TempHome;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 7, 26, 12, 0, 0).unwrap()
}

fn identity(version: Option<&str>, sha: Option<&str>, source: &str) -> InstallIdentity {
    InstallIdentity {
        role: "agent_process".to_string(),
        version: version.map(str::to_string),
        sha256: sha.map(str::to_string),
        source: source.to_string(),
    }
}

fn entry(
    probed_ago: Duration,
    install_identity: Option<InstallIdentity>,
    fingerprint: &str,
) -> SnapshotEntry {
    let probed_at = now() - chrono::Duration::seconds(probed_ago.as_secs() as i64);
    SnapshotEntry {
        probed_at: probed_at.to_rfc3339(),
        mechanism: "acp".to_string(),
        attestation: Some(SnapshotAttestation {
            name: "claude".to_string(),
            // The ACP namespace, deliberately unrelated to the manifest's.
            version: "0.59.0-proliferate.1".to_string(),
            title: None,
        }),
        install_identity,
        auth_fingerprint: fingerprint.to_string(),
        models: vec![SnapshotModel {
            id: "m-1".to_string(),
            provider: None,
            name: "M1".to_string(),
            description: None,
            config_options: None,
        }],
        modes: vec![SnapshotMode {
            id: "build".to_string(),
            name: "Build".to_string(),
        }],
        observed_defaults: None,
        warnings: Vec::new(),
        last_attempt: SnapshotAttempt {
            at: probed_at.to_rfc3339(),
            outcome: AttemptOutcome::Ok,
            detail: None,
        },
    }
}

const HOUR: Duration = Duration::from_secs(3600);
const FP: &str = "sha256:aaaa";

mod fingerprint_tests;
mod gate_tests;
mod projection_tests;
