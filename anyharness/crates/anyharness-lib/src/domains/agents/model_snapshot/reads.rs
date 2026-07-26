//! The read half of `ModelSnapshotService`: the document, one entry, and the
//! polled status surface.
//!
//! A second `impl` block in its own file, because reads are available in READ-ONLY
//! mode too — serving is not probing — and keeping them beside the reconciler
//! invited the assumption that they share its ownership gate. They do not.

use chrono::{DateTime, Utc};

use super::document::{self, install_identity_of, read_document, ModelSnapshotDocument, SnapshotEntry};
use super::{fingerprint, staleness, status, ModelSnapshotService};
use crate::domains::agents::route_auth;

impl ModelSnapshotService {
// -----------------------------------------------------------------------
    // Reads. Available in read-only mode too — serving is not probing.
    // -----------------------------------------------------------------------

    pub fn document(&self, harness_kind: &str) -> Option<ModelSnapshotDocument> {
        read_document(&self.runtime_home, harness_kind)
    }

    pub fn entry(&self, harness_kind: &str, auth_context_id: &str) -> Option<SnapshotEntry> {
        self.document(harness_kind)?
            .entries
            .get(auth_context_id)
            .cloned()
    }

    /// The polled status surface for one harness (model-catalog.md, "Runtime
    /// routes"). `state` and the engine mode are live in-memory facts; everything
    /// else is read off the document, so a restart shows correct history with
    /// `state: "idle"`.
    pub fn status(&self, harness_kind: &str, now: DateTime<Utc>) -> status::ModelSnapshotStatus {
        let document = self.document(harness_kind);
        let identity = install_identity_of(&self.runtime_home, harness_kind);
        let active = self.targets.active_contexts(harness_kind);
        let catalog_contexts = self.targets.catalog_contexts(harness_kind);
        // Every context the user could care about: the active ones plus any the
        // document already carries (a context that just went inactive still has an
        // observation worth showing, with `active: false`).
        let mut context_ids: Vec<String> = active.clone();
        if let Some(document) = document.as_ref() {
            for id in document.entries.keys() {
                if !context_ids.contains(id) {
                    context_ids.push(id.clone());
                }
            }
        }

        let contexts = context_ids
            .into_iter()
            .map(|auth_context_id| {
                let entry = document
                    .as_ref()
                    .and_then(|document| document.entries.get(&auth_context_id).cloned());
                let live = self.live_state(harness_kind, &auth_context_id, now);
                let fingerprint = route_auth::probe_auth_material(
                    &self.runtime_home,
                    harness_kind,
                    &auth_context_id,
                    &catalog_contexts,
                )
                .ok()
                .map(|material| fingerprint::fingerprint(&material));
                status::context_status(status::ContextStatusInputs {
                    auth_context_id: auth_context_id.clone(),
                    active: active.contains(&auth_context_id),
                    entry,
                    current_identity: identity.clone(),
                    current_fingerprint: fingerprint,
                    now,
                    ttl: staleness::ttl_for_entry_with(
                        harness_kind,
                        &auth_context_id,
                        self.config.ttl_base,
                        self.config.ttl_jitter_span,
                    ),
                    live_state: live.0,
                    next_attempt_at: live.1,
                })
            })
            .collect();

        status::ModelSnapshotStatus {
            agent: harness_kind.to_string(),
            schema_version: document::MODEL_SNAPSHOT_SCHEMA_VERSION,
            probe_engine: self.mode(),
            install_identity: identity,
            contexts,
        }
    }

    /// A slot the engine has never touched reports idle, which is honest: nothing
    /// is running and nothing is scheduled.
    fn live_state(
        &self,
        harness_kind: &str,
        auth_context_id: &str,
        now: DateTime<Utc>,
    ) -> (status::LiveState, Option<DateTime<Utc>>) {
        let slots = self.slots.lock().expect("model snapshot slots poisoned");
        let Some(slot) = slots.get(&(harness_kind.to_string(), auth_context_id.to_string())) else {
            return (status::LiveState::Idle, None);
        };
        let state = slot.state.lock().expect("model snapshot slot poisoned");
        if state.running {
            return (status::LiveState::Running, None);
        }
        match state.next_attempt_at {
            Some(next) if next > now => (status::LiveState::Backoff, Some(next)),
            _ => (status::LiveState::Idle, None),
        }
    }
}
