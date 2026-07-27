//! Projecting a raw `ProbeSnapshot` into the wire document (pure).
//!
//! Split out of `mod.rs`: this is a translation, not reconciliation, and keeping it
//! separate is what stops the reconciler from growing a second job.

use chrono::{DateTime, Utc};

use super::document::{
    AttemptOutcome, InstallIdentity, ModelSnapshotDocument, SnapshotAttempt, SnapshotAttestation,
    SnapshotMode, SnapshotModel, SnapshotObservedDefaults, MODEL_SNAPSHOT_SCHEMA_VERSION,
};
use crate::domains::agents::catalog::gateway_plan::SEED_FALLBACK_WARNING;

/// Project a raw `ProbeSnapshot` into the schemaVersion-2 document.
///
/// `probedAt` is the engine's own `now` rather than the snapshot's string: one
/// clock for the document and the status age, so an age can never come out
/// negative because two clocks disagreed.
pub(super) fn document_from_snapshot(
    snapshot: crate::live::sessions::probe::ProbeSnapshot,
    harness_kind: &str,
    install_identity: Option<InstallIdentity>,
    state_revision: i64,
    used_seed_floor: bool,
    now: DateTime<Utc>,
) -> ModelSnapshotDocument {
    let at = now.to_rfc3339();
    // The honest signal that this particular observation is not a discovery. A
    // gateway probe rendered over the seed floor watches the harness read back the
    // very ids the floor just wrote into its config, so the document must say so
    // rather than present a tautology as the gateway's model set.
    let mut warnings = snapshot.warnings;
    if used_seed_floor && !warnings.iter().any(|warning| warning == SEED_FALLBACK_WARNING) {
        warnings.push(SEED_FALLBACK_WARNING.to_string());
    }
    ModelSnapshotDocument {
        schema_version: MODEL_SNAPSHOT_SCHEMA_VERSION,
        agent: harness_kind.to_string(),
        probed_at: at.clone(),
        attestation: snapshot.attestation.map(|attestation| SnapshotAttestation {
            name: attestation.name,
            version: attestation.version,
            title: attestation.title,
        }),
        install_identity,
        state_revision,
        models: snapshot
            .models
            .into_iter()
            .map(|model| SnapshotModel {
                // Preserved verbatim when the harness namespaces its ids
                // (opencode's `provider/model`); absent otherwise rather than
                // guessed — the frontend must never infer origin from a name.
                provider: model
                    .model_id
                    .split_once('/')
                    .map(|(provider, _)| provider.to_string()),
                id: model.model_id,
                name: model.name,
                description: model.description,
                config_options: model.config_options,
            })
            .collect(),
        modes: modes_from_value(&snapshot.modes),
        observed_defaults: Some(SnapshotObservedDefaults {
            model_id: snapshot.current_model_id,
            mode_id: snapshot.current_mode_id,
        }),
        warnings,
        last_attempt: SnapshotAttempt {
            at,
            outcome: AttemptOutcome::Ok,
            detail: None,
        },
    }
}

/// `ProbeSnapshot.modes` is the raw ACP `modes` block. Pull the `(id, name)` pairs
/// out tolerantly: a harness that reports an unexpected shape yields no modes
/// rather than failing the whole observation.
fn modes_from_value(modes: &serde_json::Value) -> Vec<SnapshotMode> {
    let Some(available) = modes.get("availableModes").and_then(|value| value.as_array()) else {
        return Vec::new();
    };
    available
        .iter()
        .filter_map(|mode| {
            let id = mode.get("id").and_then(|value| value.as_str())?;
            let name = mode
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or(id);
            Some(SnapshotMode {
                id: id.to_string(),
                name: name.to_string(),
            })
        })
        .collect()
}
