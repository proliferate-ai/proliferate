//! Runtime-owned scheduler for **emulated** loops (`native = false`).
//!
//! Native Claude crons are driven by the harness itself; this scheduler exists
//! for harnesses with no native cron surface (Codex — a user-armed product
//! scheduler, per the session-activity-architecture "runtime-emulated on Codex"
//! rule). It is deliberately faithful, not synthetic: it enqueues the loop's
//! prompt as an ordinary user turn (tagged loop-fired provenance) exactly as a
//! human retyping the prompt would, and only ever while the session is **live
//! and idle** — it never interleaves a running turn.
//!
//! # Design
//!
//! The timing core is pure and testable: [`LoopScheduler::run_due_pass`] takes
//! an explicit `now_ms`, consults the injected [`LoopFireExecutor`] for
//! liveness, and fires only idle sessions. The background driver
//! ([`LoopScheduler::spawn`]) is a thin wrapper that calls it on a computed
//! sleep. Firing itself (prompt enqueue + fire accounting + `LoopFired`
//! emission under the sink lock) lives behind the executor so the scheduler
//! has no session dependencies.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{Mutex, Notify};

/// Whether a session can take an emulated loop fire right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopSessionLiveness {
    /// No live handle — the loop stays armed in sqlite and re-arms on attach,
    /// but the in-memory timer is dropped (nothing fires while dead).
    Dead,
    /// A turn is in flight — skip this pass and retry shortly (never interleave).
    Busy,
    /// Live and idle — fire.
    Idle,
}

/// Result of one executed emulated fire.
#[derive(Debug, Clone)]
pub struct LoopFireReport {
    /// Whether the loop remains armed (false once a non-recurring loop fires or
    /// a capped loop hits `max_fires`).
    pub still_armed: bool,
    /// The next fire instant when still armed.
    pub next_fire_at_ms: Option<i64>,
}

/// The session-facing half of the scheduler: liveness + the actual fire. Kept
/// as a trait so [`LoopScheduler`]'s timing logic is unit-testable with a fake.
#[async_trait]
pub trait LoopFireExecutor: Send + Sync {
    async fn liveness(&self, session_id: &str) -> LoopSessionLiveness;

    /// Enqueue the loop's prompt as a loop-fired user turn and record the fire.
    /// `None` = the loop record is gone/cleared and should be disarmed.
    async fn fire(&self, session_id: &str, loop_id: &str) -> Option<LoopFireReport>;
}

/// How long to wait before re-checking a due loop whose session was busy.
const BUSY_RETRY: Duration = Duration::from_secs(3);

/// The longest the driver sleeps between wakeups even with nothing due (bounds
/// clock drift on long-interval loops).
const MAX_SLEEP: Duration = Duration::from_secs(30);

type ArmKey = (String, String);

/// What one due loop did in a pass (surfaced for tests + tracing).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FireOutcome {
    Fired,
    SkippedBusy,
    DisarmedDead,
    DisarmedRetired,
    Gone,
}

pub struct LoopScheduler {
    executor: Arc<dyn LoopFireExecutor>,
    armed: Mutex<HashMap<ArmKey, i64>>,
    wake: Notify,
}

impl LoopScheduler {
    pub fn new(executor: Arc<dyn LoopFireExecutor>) -> Self {
        Self {
            executor,
            armed: Mutex::new(HashMap::new()),
            wake: Notify::new(),
        }
    }

    /// Arm (or re-arm) one emulated loop at its next fire instant.
    pub async fn arm(&self, session_id: &str, loop_id: &str, next_fire_at_ms: i64) {
        self.armed
            .lock()
            .await
            .insert((session_id.to_string(), loop_id.to_string()), next_fire_at_ms);
        self.wake.notify_one();
    }

    /// Drop one loop from the in-memory schedule (clear / cap / non-recurring).
    pub async fn disarm(&self, session_id: &str, loop_id: &str) {
        self.armed
            .lock()
            .await
            .remove(&(session_id.to_string(), loop_id.to_string()));
        self.wake.notify_one();
    }

    /// Nudge the driver to run an evaluation pass now (e.g. a turn just
    /// finished, so a loop skipped while busy can fire).
    pub fn notify(&self) {
        self.wake.notify_one();
    }

    /// Drop every loop for a session (called when a session detaches — the
    /// timers are mortal; the sqlite rows re-arm on the next attach).
    pub async fn disarm_session(&self, session_id: &str) {
        self.armed
            .lock()
            .await
            .retain(|(sid, _), _| sid != session_id);
        self.wake.notify_one();
    }

    #[cfg(test)]
    pub(crate) async fn armed_count(&self) -> usize {
        self.armed.lock().await.len()
    }

    #[cfg(test)]
    pub(crate) async fn is_armed(&self, session_id: &str, loop_id: &str) -> bool {
        self.armed
            .lock()
            .await
            .contains_key(&(session_id.to_string(), loop_id.to_string()))
    }

    /// One evaluation pass. Fires every due loop whose session is live+idle,
    /// skips busy ones, and disarms dead/retired ones. Pure over `now_ms` (no
    /// wall-clock reads) so idle-only firing is deterministically testable.
    pub async fn run_due_pass(&self, now_ms: i64) -> Vec<(ArmKey, FireOutcome)> {
        let due: Vec<ArmKey> = {
            let armed = self.armed.lock().await;
            armed
                .iter()
                .filter(|(_, next)| **next <= now_ms)
                .map(|(key, _)| key.clone())
                .collect()
        };

        let mut outcomes = Vec::with_capacity(due.len());
        for key in due {
            let (session_id, loop_id) = (&key.0, &key.1);
            let outcome = match self.executor.liveness(session_id).await {
                LoopSessionLiveness::Dead => {
                    self.armed.lock().await.remove(&key);
                    FireOutcome::DisarmedDead
                }
                // Leave it armed at the same (past) next_fire and retry after a
                // short backoff — the driver's sleep floor handles the cadence.
                LoopSessionLiveness::Busy => FireOutcome::SkippedBusy,
                LoopSessionLiveness::Idle => match self.executor.fire(session_id, loop_id).await {
                    None => {
                        self.armed.lock().await.remove(&key);
                        FireOutcome::Gone
                    }
                    Some(report) => match (report.still_armed, report.next_fire_at_ms) {
                        (true, Some(next)) => {
                            self.armed.lock().await.insert(key.clone(), next);
                            FireOutcome::Fired
                        }
                        _ => {
                            self.armed.lock().await.remove(&key);
                            FireOutcome::DisarmedRetired
                        }
                    },
                },
            };
            outcomes.push((key, outcome));
        }
        outcomes
    }

    /// Sleep duration until the next actionable moment: the earliest future
    /// fire, floored by [`BUSY_RETRY`] when a due loop was just skipped busy,
    /// capped by [`MAX_SLEEP`].
    async fn next_sleep(&self, now_ms: i64, skipped_busy: bool) -> Duration {
        let earliest_future = {
            let armed = self.armed.lock().await;
            armed.values().copied().filter(|next| *next > now_ms).min()
        };
        let mut sleep = earliest_future
            .map(|next| Duration::from_millis((next - now_ms).max(0) as u64))
            .unwrap_or(MAX_SLEEP);
        if skipped_busy {
            sleep = sleep.min(BUSY_RETRY);
        }
        sleep.min(MAX_SLEEP)
    }

    /// Spawn the background driver. Idempotent to run once at app wiring.
    pub fn spawn(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                let now = now_ms();
                let outcomes = self.run_due_pass(now).await;
                let skipped_busy = outcomes
                    .iter()
                    .any(|(_, outcome)| *outcome == FireOutcome::SkippedBusy);
                let sleep = self.next_sleep(now, skipped_busy).await;
                tokio::select! {
                    _ = tokio::time::sleep(sleep) => {}
                    _ = self.wake.notified() => {}
                }
            }
        });
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A fake executor with a fixed liveness and a fire counter.
    struct FakeExecutor {
        liveness: LoopSessionLiveness,
        fires: AtomicUsize,
        report: LoopFireReport,
    }

    impl FakeExecutor {
        fn new(liveness: LoopSessionLiveness, report: LoopFireReport) -> Arc<Self> {
            Arc::new(Self {
                liveness,
                fires: AtomicUsize::new(0),
                report,
            })
        }
    }

    #[async_trait]
    impl LoopFireExecutor for FakeExecutor {
        async fn liveness(&self, _session_id: &str) -> LoopSessionLiveness {
            self.liveness
        }
        async fn fire(&self, _session_id: &str, _loop_id: &str) -> Option<LoopFireReport> {
            self.fires.fetch_add(1, Ordering::SeqCst);
            Some(self.report.clone())
        }
    }

    #[tokio::test]
    async fn fires_only_when_idle_never_when_busy() {
        let busy = FakeExecutor::new(
            LoopSessionLiveness::Busy,
            LoopFireReport {
                still_armed: true,
                next_fire_at_ms: Some(2_000),
            },
        );
        let scheduler = LoopScheduler::new(busy.clone());
        scheduler.arm("s1", "l1", 1_000).await;

        // Due (now >= next_fire) but busy -> must NOT fire, stays armed.
        let outcomes = scheduler.run_due_pass(1_500).await;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].1, FireOutcome::SkippedBusy);
        assert_eq!(busy.fires.load(Ordering::SeqCst), 0);
        assert!(scheduler.is_armed("s1", "l1").await);
    }

    #[tokio::test]
    async fn fires_when_idle_and_reschedules() {
        let idle = FakeExecutor::new(
            LoopSessionLiveness::Idle,
            LoopFireReport {
                still_armed: true,
                next_fire_at_ms: Some(5_000),
            },
        );
        let scheduler = LoopScheduler::new(idle.clone());
        scheduler.arm("s1", "l1", 1_000).await;

        let outcomes = scheduler.run_due_pass(1_500).await;
        assert_eq!(outcomes[0].1, FireOutcome::Fired);
        assert_eq!(idle.fires.load(Ordering::SeqCst), 1);
        // Rescheduled to the reported next fire.
        assert_eq!(
            *scheduler.armed.lock().await.get(&("s1".into(), "l1".into())).unwrap(),
            5_000
        );
    }

    #[tokio::test]
    async fn not_due_loops_do_not_fire() {
        let idle = FakeExecutor::new(
            LoopSessionLiveness::Idle,
            LoopFireReport {
                still_armed: true,
                next_fire_at_ms: Some(5_000),
            },
        );
        let scheduler = LoopScheduler::new(idle.clone());
        scheduler.arm("s1", "l1", 10_000).await;

        let outcomes = scheduler.run_due_pass(1_500).await;
        assert!(outcomes.is_empty());
        assert_eq!(idle.fires.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn dead_session_disarms() {
        let dead = FakeExecutor::new(
            LoopSessionLiveness::Dead,
            LoopFireReport {
                still_armed: true,
                next_fire_at_ms: Some(5_000),
            },
        );
        let scheduler = LoopScheduler::new(dead);
        scheduler.arm("s1", "l1", 1_000).await;

        let outcomes = scheduler.run_due_pass(1_500).await;
        assert_eq!(outcomes[0].1, FireOutcome::DisarmedDead);
        assert!(!scheduler.is_armed("s1", "l1").await);
    }

    #[tokio::test]
    async fn retired_loop_disarms_after_firing() {
        let idle = FakeExecutor::new(
            LoopSessionLiveness::Idle,
            LoopFireReport {
                still_armed: false,
                next_fire_at_ms: None,
            },
        );
        let scheduler = LoopScheduler::new(idle);
        scheduler.arm("s1", "l1", 1_000).await;

        let outcomes = scheduler.run_due_pass(1_500).await;
        assert_eq!(outcomes[0].1, FireOutcome::DisarmedRetired);
        assert!(!scheduler.is_armed("s1", "l1").await);
    }

    #[tokio::test]
    async fn next_sleep_floors_on_busy_and_caps() {
        let idle = FakeExecutor::new(
            LoopSessionLiveness::Idle,
            LoopFireReport {
                still_armed: true,
                next_fire_at_ms: Some(0),
            },
        );
        let scheduler = LoopScheduler::new(idle);
        // Far-future fire -> capped to MAX_SLEEP.
        scheduler.arm("s1", "l1", 10_000_000).await;
        assert_eq!(scheduler.next_sleep(0, false).await, MAX_SLEEP);
        // Busy skip -> floored to BUSY_RETRY.
        assert_eq!(scheduler.next_sleep(0, true).await, BUSY_RETRY);
    }
}
