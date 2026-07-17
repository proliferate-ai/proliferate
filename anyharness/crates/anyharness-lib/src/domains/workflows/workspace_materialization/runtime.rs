//! The sole async facade for Workflow workspace materialization. It accepts
//! before any effect, serializes same-run work on a narrow keyed gate so a
//! concurrent replay cannot race the first materializer into a second artifact,
//! resolves the immutable placement, drives the workspace-owned ensure/adopt
//! seam, and persists workspace correlation and terminal state. Every
//! synchronous service/store/workspace call runs on the blocking pool; no lock
//! survives an unrelated await.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};

use tokio::runtime::Handle;
use tokio::sync::Mutex as AsyncMutex;

use super::model::{
    MaterializationFailureCode, MaterializationRecord, MaterializationRequest,
    MaterializationStatus,
};
use super::service::{MaterializationValidationError, WorkflowWorkspaceService};
use super::store::StoreAcceptOutcome;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::workflow_placement::{
    WorkflowPlacementError, WorkflowPlacementRequest,
};

/// The successful PUT result: whether the row was newly created or replayed. The
/// carried record already reflects the terminal (`ready` or `failed`) status.
#[derive(Debug)]
pub enum WorkspacePutSuccess {
    Created(MaterializationRecord),
    Replay(MaterializationRecord),
}

/// The PUT failure arm.
#[derive(Debug)]
pub enum WorkspacePutError {
    Invalid(MaterializationValidationError),
    Conflict,
    RunAlreadyAccepted,
    Internal(anyhow::Error),
}

/// The GET failure arm.
#[derive(Debug)]
pub enum WorkspaceGetError {
    Invalid(MaterializationValidationError),
    Internal(anyhow::Error),
}

/// A narrow per-run async serialization gate. Slots are transient (weak): a key
/// with no live holder costs nothing durable and is self-pruned on every
/// lookup, mirroring the run-control gate (RUNTIME-01) so a stream of unique run
/// UUIDs cannot leak the map without bound.
#[derive(Default)]
struct KeyedGate {
    slots: Mutex<HashMap<String, Weak<AsyncMutex<()>>>>,
}

impl KeyedGate {
    fn slot(&self, run_id: &str) -> anyhow::Result<Arc<AsyncMutex<()>>> {
        let mut slots = self
            .slots
            .lock()
            .map_err(|error| anyhow::anyhow!("workflow workspace gate poisoned: {error}"))?;
        slots.retain(|_, gate| gate.strong_count() > 0);
        if let Some(gate) = slots.get(run_id).and_then(Weak::upgrade) {
            return Ok(gate);
        }
        let gate = Arc::new(AsyncMutex::new(()));
        slots.insert(run_id.to_string(), Arc::downgrade(&gate));
        Ok(gate)
    }

    #[cfg(test)]
    fn live_slot_count(&self) -> usize {
        let mut slots = self.slots.lock().expect("gate lock");
        slots.retain(|_, gate| gate.strong_count() > 0);
        slots.len()
    }
}

pub struct WorkflowWorkspaceRuntime {
    service: Arc<WorkflowWorkspaceService>,
    workspace_runtime: Arc<WorkspaceRuntime>,
    gates: Arc<KeyedGate>,
    main_handle: Handle,
}

impl WorkflowWorkspaceRuntime {
    pub fn new(
        service: Arc<WorkflowWorkspaceService>,
        workspace_runtime: Arc<WorkspaceRuntime>,
        main_handle: Handle,
    ) -> Self {
        Self {
            service,
            workspace_runtime,
            gates: Arc::new(KeyedGate::default()),
            main_handle,
        }
    }

    /// Accept a placement PUT and drive the materialization to a terminal
    /// status. Detached onto the main runtime so a dropped HTTP future cannot
    /// orphan the accept -> ensure/adopt -> terminalize handoff.
    #[tracing::instrument(skip_all, fields(run_id = %run_id))]
    pub async fn put(
        &self,
        run_id: String,
        placement: WorkflowPlacementRequest,
    ) -> Result<WorkspacePutSuccess, WorkspacePutError> {
        let request = self
            .service
            .validate_request(&run_id, placement)
            .map_err(WorkspacePutError::Invalid)?;

        let service = self.service.clone();
        let workspace_runtime = self.workspace_runtime.clone();
        let gates = self.gates.clone();

        let handoff = self.main_handle.spawn(async move {
            let gate = gates.slot(&run_id).map_err(WorkspacePutError::Internal)?;
            let _guard = gate.lock_owned().await;

            let accept_service = service.clone();
            let accept_request = request.clone();
            let outcome = blocking(move || accept_service.accept(&accept_request))
                .await
                .map_err(WorkspacePutError::Internal)?;

            match outcome {
                StoreAcceptOutcome::Conflict => Err(WorkspacePutError::Conflict),
                StoreAcceptOutcome::RunAlreadyAccepted => {
                    Err(WorkspacePutError::RunAlreadyAccepted)
                }
                StoreAcceptOutcome::Created(_) => {
                    let record = materialize(&service, &workspace_runtime, &request).await?;
                    Ok(WorkspacePutSuccess::Created(record))
                }
                StoreAcceptOutcome::ExactReplay(record) => {
                    if record.status.is_terminal() {
                        // Terminal `ready` replays the same workspaceId; terminal
                        // `failed` does not automatically retry.
                        Ok(WorkspacePutSuccess::Replay(record))
                    } else {
                        let record = materialize(&service, &workspace_runtime, &request).await?;
                        Ok(WorkspacePutSuccess::Replay(record))
                    }
                }
            }
        });

        handoff
            .await
            .map_err(|error| WorkspacePutError::Internal(error.into()))?
    }

    /// The number of live gate slots. Test-only: proves spent per-run slots are
    /// self-pruned so a stream of unique run UUIDs does not leak the map
    /// (RUNTIME-01).
    #[cfg(test)]
    pub(crate) fn live_gate_slots(&self) -> usize {
        self.gates.live_slot_count()
    }

    /// GET the durable materialization record. A non-canonical `runId` is a
    /// typed 400; an unknown run is `None` (mapped to 404 at the boundary).
    #[tracing::instrument(skip_all, fields(run_id = %run_id))]
    pub async fn get(
        &self,
        run_id: String,
    ) -> Result<Option<MaterializationRecord>, WorkspaceGetError> {
        if let Err(error) = self.service.validate_run_id_only(&run_id) {
            return Err(WorkspaceGetError::Invalid(error));
        }
        let service = self.service.clone();
        blocking(move || service.get(&run_id))
            .await
            .map_err(WorkspaceGetError::Internal)
    }
}

/// Resolve (or reuse) the immutable placement, drive the workspace-owned
/// ensure/adopt seam, persist correlation, and terminalize. Any failure marks a
/// bounded coded terminal failure and returns the (retained) record.
async fn materialize(
    service: &Arc<WorkflowWorkspaceService>,
    workspace_runtime: &Arc<WorkspaceRuntime>,
    request: &MaterializationRequest,
) -> Result<MaterializationRecord, WorkspacePutError> {
    let run_id = request.run_id.clone();

    let record = {
        let service = service.clone();
        let run_id = run_id.clone();
        blocking(move || service.get(&run_id))
            .await
            .map_err(WorkspacePutError::Internal)?
            .ok_or_else(|| {
                WorkspacePutError::Internal(anyhow::anyhow!("materialization row vanished"))
            })?
    };

    // Resolve the immutable placement: reuse the persisted one verbatim (replay
    // never re-resolves), otherwise resolve the base OID now and persist it
    // before any effect. Each guarded transition's boolean is classified: a
    // false CAS is re-read and must prove the expected durable state, else fails
    // closed (RUNTIME-01).
    let resolved = match record.resolved_placement() {
        Some(resolved) => {
            {
                let service = service.clone();
                let run_id = run_id.clone();
                blocking(move || service.ensure_materializing(&run_id))
                    .await
                    .map_err(WorkspacePutError::Internal)?;
            }
            // A false here means the row was already past `accepted`
            // (materializing on replay) — acceptable. Any other state is a
            // durable inconsistency; require materializing-or-terminal.
            let current = read_record(service, &run_id).await?;
            match current.status {
                MaterializationStatus::Materializing | MaterializationStatus::Ready => {}
                MaterializationStatus::Failed => return Ok(current),
                MaterializationStatus::Accepted => {
                    return Err(internal(
                        "materialization stuck in accepted after ensure_materializing",
                    ))
                }
            }
            resolved
        }
        None => {
            let placement = request.placement.clone();
            let runtime = workspace_runtime.clone();
            let resolve_result =
                tokio::task::spawn_blocking(move || runtime.resolve_workflow_placement(&placement))
                    .await
                    .map_err(|error| {
                        WorkspacePutError::Internal(anyhow::anyhow!(
                            "workflow placement resolve task failed: {error}"
                        ))
                    })?;
            let resolved = match resolve_result {
                Ok(resolved) => resolved,
                Err(error) => return fail_and_read(service, &run_id, &error).await,
            };
            let json = serde_json::to_string(&resolved)
                .map_err(|error| WorkspacePutError::Internal(error.into()))?;
            let persisted = {
                let service = service.clone();
                let run_id = run_id.clone();
                let json = json.clone();
                blocking(move || service.persist_resolved_and_begin(&run_id, &json))
                    .await
                    .map_err(WorkspacePutError::Internal)?
            };
            if !persisted {
                // The row was not in `accepted`/unset when we wrote: re-read and
                // reuse the durable resolved placement (never the freshly
                // re-resolved one), or fail closed if it is absent.
                let current = read_record(service, &run_id).await?;
                match current.resolved_placement() {
                    Some(resolved) => resolved,
                    None => {
                        return Err(internal(
                            "resolved placement absent after persist_resolved_and_begin CAS miss",
                        ))
                    }
                }
            } else {
                resolved
            }
        }
    };

    // Workspace-owned exact ensure/adopt: create fresh or adopt an exact orphan.
    let ensure_result = {
        let runtime = workspace_runtime.clone();
        let resolved = resolved.clone();
        tokio::task::spawn_blocking(move || runtime.ensure_workflow_workspace(&resolved))
            .await
            .map_err(|error| {
                WorkspacePutError::Internal(anyhow::anyhow!(
                    "workflow ensure/adopt task failed: {error}"
                ))
            })?
    };
    let workspace = match ensure_result {
        Ok(workspace) => workspace,
        Err(error) => return fail_and_read(service, &run_id, &error).await,
    };

    // Persist the durable workspaceId immediately, then terminalize `ready`.
    // The bind CAS only writes while `workspace_id IS NULL`; a false result
    // means a workspace id is already durably bound. That is safe ONLY if it is
    // the same id we just ensured/adopted — otherwise GET would return a stale
    // durable id rather than the artifact we bound. Classify and fail closed on
    // a divergent binding (RUNTIME-01).
    let bound = {
        let service = service.clone();
        let run_id = run_id.clone();
        let workspace_id = workspace.id.clone();
        blocking(move || service.bind_workspace(&run_id, &workspace_id))
            .await
            .map_err(WorkspacePutError::Internal)?
    };
    if !bound {
        let current = read_record(service, &run_id).await?;
        match current.workspace_id.as_deref() {
            Some(existing) if existing == workspace.id => {}
            Some(_) => {
                // A different durable workspace id is already bound: the visible
                // row must have been removed and exact adoption produced a
                // different artifact. Fail closed rather than declare ready over
                // a stale binding.
                let (code, message) = MaterializationFailureCode::from_placement_error(
                    &WorkflowPlacementError::Mismatch(
                        "bound workspace id diverges from adopted artifact".into(),
                    ),
                );
                let mark_service = service.clone();
                let mark_run_id = run_id.clone();
                blocking(move || mark_service.mark_failed(&mark_run_id, code, &message))
                    .await
                    .map_err(WorkspacePutError::Internal)?;
                return read_record(service, &run_id).await;
            }
            None => {
                return Err(internal(
                    "workspace binding vanished after bind_workspace CAS miss",
                ))
            }
        }
    }
    {
        let service = service.clone();
        let run_id = run_id.clone();
        blocking(move || service.mark_ready(&run_id))
            .await
            .map_err(WorkspacePutError::Internal)?;
    }

    // Re-read the terminal record and prove readiness: a false mark_ready CAS
    // is only benign if a concurrent replay already terminalized ready. Any
    // non-ready terminal state here is a durable inconsistency.
    let terminal = read_record(service, &run_id).await?;
    match terminal.status {
        MaterializationStatus::Ready => Ok(terminal),
        MaterializationStatus::Failed => Ok(terminal),
        MaterializationStatus::Accepted | MaterializationStatus::Materializing => {
            Err(internal("materialization did not terminalize ready"))
        }
    }
}

fn internal(message: &'static str) -> WorkspacePutError {
    WorkspacePutError::Internal(anyhow::anyhow!(message))
}

async fn fail_and_read(
    service: &Arc<WorkflowWorkspaceService>,
    run_id: &str,
    error: &WorkflowPlacementError,
) -> Result<MaterializationRecord, WorkspacePutError> {
    let (code, message) = MaterializationFailureCode::from_placement_error(error);
    let mark_service = service.clone();
    let mark_run_id = run_id.to_string();
    blocking(move || mark_service.mark_failed(&mark_run_id, code, &message))
        .await
        .map_err(WorkspacePutError::Internal)?;
    read_record(service, run_id).await
}

async fn read_record(
    service: &Arc<WorkflowWorkspaceService>,
    run_id: &str,
) -> Result<MaterializationRecord, WorkspacePutError> {
    let service = service.clone();
    let run_id = run_id.to_string();
    blocking(move || service.get(&run_id))
        .await
        .map_err(WorkspacePutError::Internal)?
        .ok_or_else(|| WorkspacePutError::Internal(anyhow::anyhow!("materialization row vanished")))
}

/// Offload a synchronous store/workspace call to the blocking pool and collapse
/// join + inner errors into one `anyhow::Error`.
async fn blocking<F, T>(f: F) -> anyhow::Result<T>
where
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|error| anyhow::anyhow!("workflow workspace blocking task failed: {error}"))?
}
