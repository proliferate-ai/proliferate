use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::model::WorkspaceRecord;
use super::store::WorkspaceStore;

const BRANCH_REFRESH_THROTTLE: Duration = Duration::from_secs(30);
const MAX_CONCURRENT_BRANCH_PROBES: usize = 4;

#[derive(Clone)]
pub struct WorkspaceBranchRefreshCoordinator {
    state: Arc<Mutex<BranchRefreshState>>,
    throttle: Duration,
}

#[derive(Default)]
struct BranchRefreshState {
    last_started_at_by_workspace_id: HashMap<String, Instant>,
    in_flight_workspace_ids: HashSet<String>,
    scheduled_batch_count: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BranchRefreshScheduleStats {
    pub total_count: usize,
    pub scheduled_count: usize,
    pub skipped_inactive_count: usize,
    pub skipped_in_flight_count: usize,
    pub skipped_throttled_count: usize,
    pub batch_scheduled: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BranchRefreshBatchOutcome {
    pub schedule: BranchRefreshScheduleStats,
    pub updated_count: usize,
    pub unchanged_count: usize,
    pub failed_count: usize,
    pub skipped_missing_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BranchRefreshWorkerOutcome {
    Updated,
    Unchanged,
    Failed,
    SkippedMissing,
}

impl WorkspaceBranchRefreshCoordinator {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(BranchRefreshState::default())),
            throttle: BRANCH_REFRESH_THROTTLE,
        }
    }

    pub fn schedule_refresh(
        &self,
        store: WorkspaceStore,
        records: &[WorkspaceRecord],
    ) -> BranchRefreshScheduleStats {
        let (eligible, stats) = self.select_eligible(records);
        tracing::info!(
            workspace_count = stats.total_count,
            scheduled_count = stats.scheduled_count,
            skipped_inactive_count = stats.skipped_inactive_count,
            skipped_in_flight_count = stats.skipped_in_flight_count,
            skipped_throttled_count = stats.skipped_throttled_count,
            batch_scheduled = stats.batch_scheduled,
            "[anyharness-latency] workspace.branch_refresh.scheduled"
        );
        if eligible.is_empty() {
            return stats;
        }

        let state = self.state.clone();
        thread::spawn(move || {
            let _ = run_refresh_batch(state, store, eligible, stats);
        });
        stats
    }

    #[cfg(test)]
    pub fn run_refresh_for_test(
        &self,
        store: WorkspaceStore,
        records: &[WorkspaceRecord],
    ) -> BranchRefreshBatchOutcome {
        let (eligible, stats) = self.select_eligible(records);
        if eligible.is_empty() {
            return BranchRefreshBatchOutcome {
                schedule: stats,
                ..BranchRefreshBatchOutcome::default()
            };
        }
        run_refresh_batch(self.state.clone(), store, eligible, stats)
    }

    #[cfg(test)]
    pub fn scheduled_batch_count_for_test(&self) -> u64 {
        self.state
            .lock()
            .map(|state| state.scheduled_batch_count)
            .unwrap_or_default()
    }

    fn select_eligible(
        &self,
        records: &[WorkspaceRecord],
    ) -> (Vec<WorkspaceRecord>, BranchRefreshScheduleStats) {
        let now = Instant::now();
        let mut stats = BranchRefreshScheduleStats {
            total_count: records.len(),
            ..BranchRefreshScheduleStats::default()
        };
        let mut eligible = Vec::new();
        let Ok(mut state) = self.state.lock() else {
            stats.skipped_in_flight_count = records.len();
            return (eligible, stats);
        };

        for record in records {
            if record.lifecycle_state != "active" {
                stats.skipped_inactive_count = stats.skipped_inactive_count.saturating_add(1);
                continue;
            }
            if state.in_flight_workspace_ids.contains(&record.id) {
                stats.skipped_in_flight_count = stats.skipped_in_flight_count.saturating_add(1);
                continue;
            }
            if state
                .last_started_at_by_workspace_id
                .get(&record.id)
                .is_some_and(|last_started_at| now.duration_since(*last_started_at) < self.throttle)
            {
                stats.skipped_throttled_count = stats.skipped_throttled_count.saturating_add(1);
                continue;
            }

            state.in_flight_workspace_ids.insert(record.id.clone());
            state
                .last_started_at_by_workspace_id
                .insert(record.id.clone(), now);
            eligible.push(record.clone());
        }

        stats.scheduled_count = eligible.len();
        stats.batch_scheduled = !eligible.is_empty();
        if stats.batch_scheduled {
            state.scheduled_batch_count = state.scheduled_batch_count.saturating_add(1);
        }
        (eligible, stats)
    }
}

impl Default for WorkspaceBranchRefreshCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

fn run_refresh_batch(
    state: Arc<Mutex<BranchRefreshState>>,
    store: WorkspaceStore,
    records: Vec<WorkspaceRecord>,
    schedule: BranchRefreshScheduleStats,
) -> BranchRefreshBatchOutcome {
    let started = Instant::now();
    let mut outcome = BranchRefreshBatchOutcome {
        schedule,
        ..BranchRefreshBatchOutcome::default()
    };

    for chunk in records.chunks(MAX_CONCURRENT_BRANCH_PROBES) {
        let handles = chunk
            .iter()
            .cloned()
            .map(|record| {
                let store = store.clone();
                thread::spawn(move || refresh_workspace_branch(&store, record))
            })
            .collect::<Vec<_>>();
        for handle in handles {
            match handle.join() {
                Ok(BranchRefreshWorkerOutcome::Updated) => {
                    outcome.updated_count = outcome.updated_count.saturating_add(1);
                }
                Ok(BranchRefreshWorkerOutcome::Unchanged) => {
                    outcome.unchanged_count = outcome.unchanged_count.saturating_add(1);
                }
                Ok(BranchRefreshWorkerOutcome::Failed) | Err(_) => {
                    outcome.failed_count = outcome.failed_count.saturating_add(1);
                }
                Ok(BranchRefreshWorkerOutcome::SkippedMissing) => {
                    outcome.skipped_missing_count = outcome.skipped_missing_count.saturating_add(1);
                }
            }
        }
    }

    if let Ok(mut state) = state.lock() {
        for record in &records {
            state.in_flight_workspace_ids.remove(&record.id);
        }
    }

    tracing::info!(
        workspace_count = records.len(),
        updated_count = outcome.updated_count,
        unchanged_count = outcome.unchanged_count,
        failed_count = outcome.failed_count,
        skipped_missing_count = outcome.skipped_missing_count,
        elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] workspace.branch_refresh.completed"
    );

    outcome
}

fn refresh_workspace_branch(
    store: &WorkspaceStore,
    record: WorkspaceRecord,
) -> BranchRefreshWorkerOutcome {
    let current = match store.find_by_id(&record.id) {
        Ok(Some(current)) if current.lifecycle_state == "active" => current,
        Ok(_) => return BranchRefreshWorkerOutcome::SkippedMissing,
        Err(_) => return BranchRefreshWorkerOutcome::Failed,
    };
    let next_branch = match probe_current_branch_quiet(&current.path) {
        Ok(next_branch) => next_branch,
        Err(()) => return BranchRefreshWorkerOutcome::Failed,
    };
    if next_branch == current.current_branch {
        return BranchRefreshWorkerOutcome::Unchanged;
    }

    let now = chrono::Utc::now().to_rfc3339();
    match store.update_current_branch(&current.id, next_branch.as_deref(), &now) {
        Ok(()) => BranchRefreshWorkerOutcome::Updated,
        Err(_) => BranchRefreshWorkerOutcome::Failed,
    }
}

fn probe_current_branch_quiet(path: &str) -> Result<Option<String>, ()> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(path)
        .output()
        .map_err(|_| ())?;
    if !output.status.success() {
        return Err(());
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if branch.is_empty() {
        None
    } else {
        Some(branch)
    })
}
