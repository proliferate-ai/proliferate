//! The polled status projection (pure).
//!
//! Shaped after `GET /v1/agents/reconcile` deliberately: probe status reaches
//! clients "the way install status already does — as polled state, not push
//! events" (model-catalog.md). A surface that already knows how to poll a
//! reconcile snapshot needs no new mechanism for this one.
//!
//! Two contract rules are enforced HERE rather than trusted at the call site:
//!
//! - **`authFingerprint` is never on the wire.** It is a credential-derived
//!   digest; the client contract is the boolean `stale` plus its reason. There is
//!   no field for it in these types, so it cannot leak by accident.
//! - **`identityComparable: false` means "claim no version binding".** An entry
//!   whose install identity cannot be compared (no manifest, a `path` dev install,
//!   a pre-field entry, an attestation-less harness) must not be rendered as if
//!   its version were verified. The flag exists so the UI does not have to invent
//!   an answer.

use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;

use super::document::{InstallIdentity, SnapshotAttempt, SnapshotEntry};
use super::staleness::{self, IdentityComparison};
use super::ProbeEngineMode;

/// The engine's live view of one context. In-memory only, so a restart reports
/// `Idle` — which is true: nothing is running.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiveState {
    Idle,
    Running,
    Backoff,
}

impl LiveState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Backoff => "backoff",
        }
    }
}

impl Serialize for LiveState {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl Serialize for ProbeEngineMode {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSnapshotStatus {
    pub agent: String,
    pub schema_version: u32,
    /// `owner` | `readonly` — visible rather than mysterious when a second
    /// runtime shares this home.
    pub probe_engine: ProbeEngineMode,
    /// The staleness baseline, manifest-derived. `null` when unobservable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_identity: Option<InstallIdentity>,
    pub contexts: Vec<ContextStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextStatus {
    pub auth_context_id: String,
    /// Whether the auth classifier currently counts this context as active. A
    /// just-deactivated context keeps its observation with `active: false`.
    pub active: bool,
    pub state: LiveState,
    /// Last SUCCESSFUL observation. Never regresses on failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probed_at: Option<String>,
    /// Server-computed so every surface renders the same age from one clock.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_age_seconds: Option<i64>,
    pub stale: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale_reason: Option<String>,
    /// `false` ⇒ the identity comparison was indeterminate; render no version
    /// claim.
    pub identity_comparable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_attempt: Option<SnapshotAttempt>,
    /// `lastAttempt.detail` when the last attempt failed. Lifted to its own field
    /// so a surface can render an error without knowing the attempt shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// Set iff `state == backoff`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_attempt_at: Option<String>,
    /// Diagnostics about the binary that answered — NOT the staleness input.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attestation: Option<super::document::SnapshotAttestation>,
    pub model_count: usize,
    pub mode_count: usize,
    #[serde(default)]
    pub warnings: Vec<String>,
}

pub struct ContextStatusInputs {
    pub auth_context_id: String,
    pub active: bool,
    pub entry: Option<SnapshotEntry>,
    pub current_identity: Option<InstallIdentity>,
    /// `None` when phase A could not resolve this context (an unsatisfiable
    /// selection). The entry then reads as stale, which is the honest answer: we
    /// cannot confirm it still matches the machine.
    pub current_fingerprint: Option<String>,
    pub now: DateTime<Utc>,
    pub ttl: Duration,
    pub live_state: LiveState,
    pub next_attempt_at: Option<DateTime<Utc>>,
}

pub fn context_status(inputs: ContextStatusInputs) -> ContextStatus {
    let ContextStatusInputs {
        auth_context_id,
        active,
        entry,
        current_identity,
        current_fingerprint,
        now,
        ttl,
        live_state,
        next_attempt_at,
    } = inputs;

    let freshness = staleness::evaluate(
        entry.as_ref(),
        current_identity.as_ref(),
        // An unresolvable context cannot match any recorded fingerprint, so this
        // sentinel makes it read `authMoved` rather than silently fresh.
        current_fingerprint.as_deref().unwrap_or("<unresolvable>"),
        now,
        ttl,
    );
    let identity_comparable = entry.as_ref().is_some_and(|entry| {
        staleness::compare_identity(entry.install_identity.as_ref(), current_identity.as_ref())
            != IdentityComparison::Indeterminate
    });
    let probed_at = entry.as_ref().map(|entry| entry.probed_at.clone());
    let snapshot_age_seconds = entry.as_ref().and_then(|entry| {
        DateTime::parse_from_rfc3339(&entry.probed_at)
            .ok()
            .map(|parsed| now.signed_duration_since(parsed.with_timezone(&Utc)).num_seconds())
    });
    let last_error = entry.as_ref().and_then(|entry| {
        matches!(
            entry.last_attempt.outcome,
            super::document::AttemptOutcome::Failed
        )
        .then(|| entry.last_attempt.detail.clone())
        .flatten()
    });

    ContextStatus {
        auth_context_id,
        active,
        state: live_state,
        probed_at,
        snapshot_age_seconds,
        stale: freshness.is_stale(),
        stale_reason: freshness.reason().map(|reason| reason.as_str().to_string()),
        identity_comparable,
        last_attempt: entry.as_ref().map(|entry| entry.last_attempt.clone()),
        last_error,
        next_attempt_at: match live_state {
            LiveState::Backoff => next_attempt_at.map(|at| at.to_rfc3339()),
            _ => None,
        },
        attestation: entry.as_ref().and_then(|entry| entry.attestation.clone()),
        model_count: entry.as_ref().map(|entry| entry.models.len()).unwrap_or(0),
        mode_count: entry.as_ref().map(|entry| entry.modes.len()).unwrap_or(0),
        warnings: entry.map(|entry| entry.warnings).unwrap_or_default(),
    }
}
