//! The polled status projection (pure).
//!
//! Shaped after `GET /v1/agents/reconcile` deliberately: probe status reaches
//! clients "the way install status already does — as polled state, not push
//! events" (model-catalog.md). A surface that already knows how to poll a
//! reconcile snapshot needs no new mechanism for this one.
//!
//! One harness, one observation: the projection carries `probedAt`, the
//! server-computed age, `lastAttempt`/`lastError`, the engine's live state and
//! ownership mode, the provenance fields (`attestation`, `installIdentity`,
//! `stateRevision` — for humans and the Worker's dedupe, never gates), and the
//! `models`/`modes` arrays off the same document read.
//!
//! There is no staleness field and no fingerprint: freshness is event-driven, and
//! provenance is not a gate. The projection types have no field for either, so
//! neither can leak by accident.

use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

use super::document::{
    InstallIdentity, ModelSnapshotDocument, SnapshotAttempt, SnapshotAttestation, SnapshotMode,
    SnapshotModel,
};
use super::ProbeEngineMode;

/// The engine's live view of one harness. In-memory only, so a restart reports
/// `Idle` — which is true: nothing is running.
///
/// `Queued` is distinct from `Running` on purpose: a probe admitted to its slot but
/// still waiting on the machine-wide semaphore is neither "nothing is happening"
/// (which is what `Idle` would tell a polling UI, wrongly) nor "a harness process
/// exists".
// The `rename_all` is what the GENERATED SCHEMA is built from, and it has to agree
// with `as_str` below. `ToSchema` reads serde's attributes, never the hand-written
// `Serialize`: without the rename the OpenAPI document — and the TypeScript generated
// from it — declared `"Idle" | "Queued" | …` while the server sent `"idle"`, so a
// client would have coded against a union no response ever matched. `snake_case` is
// the sibling convention (`ReconcileJobStatus`, `AgentInstallProgressPhase`), and for
// these single-word variants it is exactly the lowercase form `as_str` emits.
//
// A comment rather than a doc comment on purpose: utoipa copies doc comments into the
// public schema description, and this is a note to whoever edits the enum next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = ModelSnapshotLiveState, example = "idle")]
pub enum LiveState {
    Idle,
    Queued,
    Running,
    Backoff,
}

impl LiveState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Queued => "queued",
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

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelSnapshotStatus {
    pub agent: String,
    pub schema_version: u32,
    /// `owner` | `readonly` — visible rather than mysterious when a second
    /// runtime shares this home.
    #[schema(value_type = String, example = "owner")]
    pub probe_engine: ProbeEngineMode,
    pub state: LiveState,
    /// Last SUCCESSFUL observation. Never regresses on failure. Absent until the
    /// first observation lands.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probed_at: Option<String>,
    /// Server-computed so every surface renders the same age from one clock.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_age_seconds: Option<i64>,
    /// Provenance: the `state.json` revision the observation was probed under.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_revision: Option<i64>,
    /// Provenance: the binary that answered. Diagnostics only.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub attestation: Option<SnapshotAttestation>,
    /// Provenance: the install the observation was recorded on, as the document
    /// carries it. `null` when the document is absent or recorded none.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub install_identity: Option<InstallIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub last_attempt: Option<SnapshotAttempt>,
    /// `lastAttempt.detail` when the last attempt failed. Lifted to its own field
    /// so a surface can render an error without knowing the attempt shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// Set iff `state == backoff`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_attempt_at: Option<String>,
    pub model_count: usize,
    pub mode_count: usize,
    /// The full model list off the same document read as `modelCount`, so a
    /// machineless-surface uploader (the Worker's `model_snapshot_sync`) has
    /// something to read besides raw disk access to a document it should not
    /// know the layout of.
    #[serde(default)]
    #[schema(value_type = Vec<Object>)]
    pub models: Vec<SnapshotModel>,
    /// The full mode list, same rationale as `models` above.
    #[serde(default)]
    #[schema(value_type = Vec<Object>)]
    pub modes: Vec<SnapshotMode>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

pub struct StatusInputs {
    pub agent: String,
    pub schema_version: u32,
    pub probe_engine: ProbeEngineMode,
    pub document: Option<ModelSnapshotDocument>,
    pub now: DateTime<Utc>,
    pub live_state: LiveState,
    pub next_attempt_at: Option<DateTime<Utc>>,
}

pub fn project_status(inputs: StatusInputs) -> ModelSnapshotStatus {
    let StatusInputs {
        agent,
        schema_version,
        probe_engine,
        document,
        now,
        live_state,
        next_attempt_at,
    } = inputs;

    let probed_at = document.as_ref().map(|document| document.probed_at.clone());
    let snapshot_age_seconds = probed_at.as_deref().and_then(|probed_at| {
        DateTime::parse_from_rfc3339(probed_at).ok().map(|parsed| {
            now.signed_duration_since(parsed.with_timezone(&Utc))
                .num_seconds()
        })
    });
    let last_error = document.as_ref().and_then(|document| {
        matches!(
            document.last_attempt.outcome,
            super::document::AttemptOutcome::Failed
        )
        .then(|| document.last_attempt.detail.clone())
        .flatten()
    });

    ModelSnapshotStatus {
        agent,
        schema_version,
        probe_engine,
        state: live_state,
        probed_at,
        snapshot_age_seconds,
        state_revision: document.as_ref().map(|document| document.state_revision),
        attestation: document
            .as_ref()
            .and_then(|document| document.attestation.clone()),
        install_identity: document
            .as_ref()
            .and_then(|document| document.install_identity.clone()),
        last_attempt: document
            .as_ref()
            .map(|document| document.last_attempt.clone()),
        last_error,
        next_attempt_at: match live_state {
            LiveState::Backoff => next_attempt_at.map(|at| at.to_rfc3339()),
            _ => None,
        },
        model_count: document
            .as_ref()
            .map(|document| document.models.len())
            .unwrap_or(0),
        mode_count: document
            .as_ref()
            .map(|document| document.modes.len())
            .unwrap_or(0),
        models: document
            .as_ref()
            .map(|document| document.models.clone())
            .unwrap_or_default(),
        modes: document
            .as_ref()
            .map(|document| document.modes.clone())
            .unwrap_or_default(),
        warnings: document.map(|document| document.warnings).unwrap_or_default(),
    }
}
