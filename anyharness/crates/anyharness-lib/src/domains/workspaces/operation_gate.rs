use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use tokio::sync::{Mutex, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum WorkspaceOperationKind {
    MaterializationRead,
    FileWrite,
    GitWrite,
    ProcessRun,
    TerminalCommand,
    SessionStart,
    SessionFork,
    SessionPrompt,
    SessionResume,
    SetupCommand,
    HostingWrite,
    PlanWrite,
    ReviewWrite,
    CoworkWrite,
    SubagentWrite,
    MobilityWrite,
}

#[derive(Debug, Clone, Default)]
pub struct WorkspaceOperationSnapshot {
    pub holders: BTreeMap<WorkspaceOperationKind, usize>,
}

impl WorkspaceOperationSnapshot {
    pub fn count(&self, kind: WorkspaceOperationKind) -> usize {
        self.holders.get(&kind).copied().unwrap_or(0)
    }

    pub fn has_any(&self, kinds: &[WorkspaceOperationKind]) -> bool {
        kinds.iter().any(|kind| self.count(*kind) > 0)
    }
}

#[derive(Clone, Default)]
pub struct WorkspaceOperationGate {
    inner: Arc<Mutex<HashMap<String, Arc<WorkspaceOperationState>>>>,
}

struct WorkspaceOperationState {
    lock: Arc<RwLock<()>>,
    counts: StdMutex<BTreeMap<WorkspaceOperationKind, usize>>,
}

pub struct WorkspaceOperationLease {
    workspace_id: String,
    kind: WorkspaceOperationKind,
    state: Arc<WorkspaceOperationState>,
    _guard: OwnedRwLockReadGuard<()>,
}

pub struct WorkspaceExclusiveOperationLease {
    workspace_id: Option<String>,
    kind: Option<WorkspaceOperationKind>,
    state: Option<Arc<WorkspaceOperationState>>,
    _guard: OwnedRwLockWriteGuard<()>,
}

impl WorkspaceOperationGate {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn snapshot(&self, workspace_id: &str) -> WorkspaceOperationSnapshot {
        let Some(state) = self.get_existing_state(workspace_id).await else {
            return WorkspaceOperationSnapshot::default();
        };
        let holders = state
            .counts
            .lock()
            .expect("operation counts poisoned")
            .clone();
        WorkspaceOperationSnapshot { holders }
    }

    pub async fn acquire_shared(
        &self,
        workspace_id: &str,
        kind: WorkspaceOperationKind,
    ) -> WorkspaceOperationLease {
        let state = self.state_for(workspace_id).await;
        let guard = state.lock.clone().read_owned().await;
        {
            let mut counts = state.counts.lock().expect("operation counts poisoned");
            *counts.entry(kind).or_insert(0) += 1;
        }
        WorkspaceOperationLease {
            workspace_id: workspace_id.to_string(),
            kind,
            state,
            _guard: guard,
        }
    }

    pub async fn acquire_exclusive(&self, workspace_id: &str) -> WorkspaceExclusiveOperationLease {
        let state = self.state_for(workspace_id).await;
        WorkspaceExclusiveOperationLease {
            workspace_id: None,
            kind: None,
            state: None,
            _guard: state.lock.clone().write_owned().await,
        }
    }

    pub async fn acquire_exclusive_with_kind(
        &self,
        workspace_id: &str,
        kind: WorkspaceOperationKind,
    ) -> WorkspaceExclusiveOperationLease {
        let state = self.state_for(workspace_id).await;
        let guard = state.lock.clone().write_owned().await;
        {
            let mut counts = state.counts.lock().expect("operation counts poisoned");
            *counts.entry(kind).or_insert(0) += 1;
        }
        WorkspaceExclusiveOperationLease {
            workspace_id: Some(workspace_id.to_string()),
            kind: Some(kind),
            state: Some(state),
            _guard: guard,
        }
    }

    async fn get_existing_state(&self, workspace_id: &str) -> Option<Arc<WorkspaceOperationState>> {
        self.inner.lock().await.get(workspace_id).cloned()
    }

    async fn state_for(&self, workspace_id: &str) -> Arc<WorkspaceOperationState> {
        let mut states = self.inner.lock().await;
        states
            .entry(workspace_id.to_string())
            .or_insert_with(|| {
                Arc::new(WorkspaceOperationState {
                    lock: Arc::new(RwLock::new(())),
                    counts: StdMutex::new(BTreeMap::new()),
                })
            })
            .clone()
    }
}

impl Drop for WorkspaceOperationLease {
    fn drop(&mut self) {
        let mut counts = self.state.counts.lock().expect("operation counts poisoned");
        if let Some(count) = counts.get_mut(&self.kind) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                counts.remove(&self.kind);
            }
        }
        tracing::trace!(
            workspace_id = %self.workspace_id,
            kind = ?self.kind,
            "workspace operation lease released"
        );
    }
}

impl Drop for WorkspaceExclusiveOperationLease {
    fn drop(&mut self) {
        let Some(state) = &self.state else {
            return;
        };
        let Some(kind) = self.kind else {
            return;
        };
        let mut counts = state.counts.lock().expect("operation counts poisoned");
        if let Some(count) = counts.get_mut(&kind) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                counts.remove(&kind);
            }
        }
        tracing::trace!(
            workspace_id = self.workspace_id.as_deref().unwrap_or("<unknown>"),
            kind = ?kind,
            "workspace exclusive operation lease released"
        );
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::time::timeout;

    use super::{WorkspaceOperationGate, WorkspaceOperationKind};

    #[tokio::test]
    async fn snapshot_tracks_active_shared_holders() {
        let gate = WorkspaceOperationGate::new();
        let process = gate
            .acquire_shared("workspace-1", WorkspaceOperationKind::ProcessRun)
            .await;
        let terminal = gate
            .acquire_shared("workspace-1", WorkspaceOperationKind::TerminalCommand)
            .await;

        let snapshot = gate.snapshot("workspace-1").await;
        assert_eq!(snapshot.count(WorkspaceOperationKind::ProcessRun), 1);
        assert_eq!(snapshot.count(WorkspaceOperationKind::TerminalCommand), 1);
        assert!(snapshot.has_any(&[
            WorkspaceOperationKind::ProcessRun,
            WorkspaceOperationKind::SetupCommand,
        ]));

        drop(process);
        let snapshot = gate.snapshot("workspace-1").await;
        assert_eq!(snapshot.count(WorkspaceOperationKind::ProcessRun), 0);
        assert_eq!(snapshot.count(WorkspaceOperationKind::TerminalCommand), 1);

        drop(terminal);
        assert!(gate.snapshot("workspace-1").await.holders.is_empty());
    }

    #[tokio::test]
    async fn exclusive_lease_waits_for_shared_holders() {
        let gate = WorkspaceOperationGate::new();
        let shared = gate
            .acquire_shared("workspace-1", WorkspaceOperationKind::FileWrite)
            .await;
        let exclusive_gate = gate.clone();
        let exclusive =
            tokio::spawn(async move { exclusive_gate.acquire_exclusive("workspace-1").await });

        assert!(timeout(Duration::from_millis(20), async {
            while !exclusive.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .is_err());
        assert_eq!(
            gate.snapshot("workspace-1")
                .await
                .count(WorkspaceOperationKind::FileWrite),
            1
        );

        drop(shared);
        let _exclusive = timeout(Duration::from_secs(1), exclusive)
            .await
            .expect("exclusive lease should unblock")
            .expect("exclusive task should complete");
        assert!(gate.snapshot("workspace-1").await.holders.is_empty());
    }

    #[tokio::test]
    async fn exclusive_lease_with_kind_tracks_active_holder() {
        let gate = WorkspaceOperationGate::new();
        let lease = gate
            .acquire_exclusive_with_kind("workspace-1", WorkspaceOperationKind::SessionFork)
            .await;

        let snapshot = gate.snapshot("workspace-1").await;
        assert_eq!(snapshot.count(WorkspaceOperationKind::SessionFork), 1);

        drop(lease);
        assert!(gate.snapshot("workspace-1").await.holders.is_empty());
    }

    #[tokio::test]
    async fn queued_shared_operation_is_not_counted_as_active_holder() {
        let gate = WorkspaceOperationGate::new();
        let exclusive = gate.acquire_exclusive("workspace-1").await;
        let shared_gate = gate.clone();
        let shared = tokio::spawn(async move {
            shared_gate
                .acquire_shared("workspace-1", WorkspaceOperationKind::ProcessRun)
                .await
        });

        tokio::task::yield_now().await;
        assert_eq!(
            gate.snapshot("workspace-1")
                .await
                .count(WorkspaceOperationKind::ProcessRun),
            0
        );

        shared.abort();
        drop(exclusive);
        let _ = shared.await;
        assert!(gate.snapshot("workspace-1").await.holders.is_empty());
    }
}
