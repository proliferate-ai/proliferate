//! Synchronous durable rules for Workflow workspace materialization. The
//! service owns canonical-UUID validation, canonical request JSON,
//! acceptance/replay, guarded transitions, and the narrow schema-v2
//! run-acceptance guard. It uses domain models and typed outcomes only (wire
//! decode/encode lives in the API contract mapper); it never spawns, awaits,
//! calls the workspace/Git seams, or holds live state.

use super::model::{
    canonical_request_json, MaterializationFailureCode, MaterializationFailureDetail,
    MaterializationRecord, MaterializationRequest, MaterializationStatus,
    MATERIALIZATION_SCHEMA_VERSION,
};
use super::store::{MaterializationStore, StoreAcceptOutcome};
use crate::domains::workspaces::workflow_placement::WorkflowPlacementRequest;

/// Validation failures (all map to a coded 400).
#[derive(Debug, thiserror::Error)]
pub enum MaterializationValidationError {
    #[error("workflow run id is not a canonical UUID")]
    InvalidRunId,
}

/// The schema-v2 run-acceptance guard outcome (spec §"Binding to later run
/// acceptance").
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunAcceptanceGuard {
    /// No materialization row for the run: preserve manual existing-workspace
    /// behavior.
    NoMaterialization,
    /// A materialization exists but is not ready: 409 not ready, no run effect.
    NotReady,
    /// A ready materialization's workspace differs from the request: 409
    /// mismatch, no run effect.
    Mismatch,
    /// A ready materialization whose workspace matches the request: continue.
    Ready,
}

#[derive(Clone)]
pub struct WorkflowWorkspaceService {
    store: MaterializationStore,
}

impl WorkflowWorkspaceService {
    pub fn new(store: MaterializationStore) -> Self {
        Self { store }
    }

    /// Validate the canonical run UUID and derive the canonical domain request.
    /// `request_json` (the domain-owned canonical serialization) is the sole
    /// replay authority: wire whitespace and key order do not matter because
    /// the API mapper's strict decode already normalized into typed placement.
    pub fn validate_request(
        &self,
        run_id: &str,
        placement: WorkflowPlacementRequest,
    ) -> Result<MaterializationRequest, MaterializationValidationError> {
        validate_canonical_uuid(run_id)?;
        let request_json = canonical_request_json(&placement);
        Ok(MaterializationRequest {
            run_id: run_id.to_string(),
            placement,
            request_json,
        })
    }

    /// Insert the `accepted` row, exactly replay, or conflict.
    pub fn accept(&self, request: &MaterializationRequest) -> anyhow::Result<StoreAcceptOutcome> {
        let now = chrono::Utc::now().to_rfc3339();
        let record = MaterializationRecord {
            run_id: request.run_id.clone(),
            schema_version: MATERIALIZATION_SCHEMA_VERSION,
            request_json: request.request_json.clone(),
            resolved_placement_json: None,
            status: MaterializationStatus::Accepted,
            workspace_id: None,
            failure_code: None,
            failure_message: None,
            created_at: now.clone(),
            updated_at: now,
            finished_at: None,
        };
        self.store.accept(&record)
    }

    /// Validate only the canonical UUID (for GET, which has no body).
    pub fn validate_run_id_only(&self, run_id: &str) -> Result<(), MaterializationValidationError> {
        validate_canonical_uuid(run_id)
    }

    pub fn get(&self, run_id: &str) -> anyhow::Result<Option<MaterializationRecord>> {
        self.store.get(run_id)
    }

    pub fn persist_resolved_and_begin(
        &self,
        run_id: &str,
        resolved_placement_json: &str,
    ) -> anyhow::Result<bool> {
        self.store
            .persist_resolved_and_begin(run_id, resolved_placement_json)
    }

    pub fn ensure_materializing(&self, run_id: &str) -> anyhow::Result<bool> {
        self.store.ensure_materializing(run_id)
    }

    pub fn bind_workspace(&self, run_id: &str, workspace_id: &str) -> anyhow::Result<bool> {
        self.store.bind_workspace(run_id, workspace_id)
    }

    pub fn mark_ready(&self, run_id: &str) -> anyhow::Result<bool> {
        self.store.mark_ready(run_id)
    }

    pub fn mark_failed(
        &self,
        run_id: &str,
        failure_code: MaterializationFailureCode,
        failure_detail: &MaterializationFailureDetail,
    ) -> anyhow::Result<bool> {
        self.store.mark_failed(run_id, failure_code, failure_detail)
    }

    /// The schema-v2 run-acceptance guard: classify a run PUT against any
    /// same-ID materialization. Creates zero rows and no effect.
    pub fn guard_run_acceptance(
        &self,
        run_id: &str,
        requested_workspace_id: &str,
    ) -> anyhow::Result<RunAcceptanceGuard> {
        let Some(record) = self.store.get(run_id)? else {
            return Ok(RunAcceptanceGuard::NoMaterialization);
        };
        if record.status != MaterializationStatus::Ready {
            return Ok(RunAcceptanceGuard::NotReady);
        }
        match record.workspace_id.as_deref() {
            Some(workspace_id) if workspace_id == requested_workspace_id => {
                Ok(RunAcceptanceGuard::Ready)
            }
            _ => Ok(RunAcceptanceGuard::Mismatch),
        }
    }
}

fn validate_canonical_uuid(run_id: &str) -> Result<(), MaterializationValidationError> {
    let parsed =
        uuid::Uuid::parse_str(run_id).map_err(|_| MaterializationValidationError::InvalidRunId)?;
    if parsed.hyphenated().to_string() != run_id {
        return Err(MaterializationValidationError::InvalidRunId);
    }
    Ok(())
}
