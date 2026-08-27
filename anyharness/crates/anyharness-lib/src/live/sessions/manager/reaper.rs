//! Idle-session reaper.
//!
//! Every live agent session costs a fixed, measured amount of memory for as
//! long as its processes exist, and it never gives any of that memory back on
//! its own (see `specs/areas/live-runtime.md`). Retiring the actor is the
//! only reclaim mechanism this runtime has, so the reaper sweeps the live map
//! and non-terminally unloads any session that has been continuously
//! quiescent for the configured threshold.
//!
//! Retirement here is the existing graceful `Unload` path, which leaves the
//! durable session row, its transcript, and its `native_session_id` intact.
//! The next prompt resumes the session through the ordinary startup strategy
//! matrix; nothing about the reaper is terminal.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use anyharness_contract::v1::SessionExecutionPhase;
use tokio::time::{Instant, MissedTickBehavior};

use super::LiveSessionManager;
use crate::live::sessions::actor::command::{ConditionalUnloadOutcome, UnloadRetainedReason};
use crate::live::sessions::handle::{LiveSessionExecutionSnapshot, LiveSessionHandle};

#[cfg(test)]
mod tests;

/// Threshold override, in whole seconds. `0` disables the reaper entirely.
pub const IDLE_REAP_SECONDS_ENV: &str = "ANYHARNESS_IDLE_SESSION_REAP_SECONDS";

/// Founder ruling of 2026-08-21: reap after "a minute or 2". Measurement says
/// the post-turn memory curve is flat from t+15s to t+900s, so a longer wait
/// reclaims exactly nothing extra and the threshold is a pure user-experience
/// choice. 120s is the least disruptive point inside the ruled range and
/// costs no memory relative to 60s.
pub const DEFAULT_IDLE_REAP_THRESHOLD: Duration = Duration::from_secs(120);

/// Sweep cadence ceiling. The reaper's own observations are the idle clock, so
/// the cadence bounds how much later than the threshold a reap can happen.
const MAX_SWEEP_INTERVAL: Duration = Duration::from_secs(15);

/// How the reaper is configured for this process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdleReapPolicy {
    threshold: Option<Duration>,
}

impl IdleReapPolicy {
    pub fn disabled() -> Self {
        Self { threshold: None }
    }

    /// A zero threshold is the disable value, matching the env contract.
    pub fn with_threshold(threshold: Duration) -> Self {
        if threshold.is_zero() {
            return Self::disabled();
        }
        Self {
            threshold: Some(threshold),
        }
    }

    /// `ANYHARNESS_IDLE_SESSION_REAP_SECONDS` in whole seconds. Absent means
    /// the default; `0` disables; an unparseable value keeps the default
    /// rather than silently turning a memory-reclaim feature off.
    pub fn from_env() -> Self {
        Self::parse(std::env::var_os(IDLE_REAP_SECONDS_ENV).as_deref())
    }

    /// The whole documented env contract, as a pure function of the raw value
    /// so it is testable without mutating process env. `from_env` is the
    /// one-line read on top of it.
    fn parse(raw: Option<&std::ffi::OsStr>) -> Self {
        let Some(raw) = raw else {
            return Self::with_threshold(DEFAULT_IDLE_REAP_THRESHOLD);
        };
        let raw = raw.to_string_lossy().trim().to_string();
        match raw.parse::<u64>() {
            Ok(seconds) => Self::with_threshold(Duration::from_secs(seconds)),
            Err(_) => {
                tracing::warn!(
                    env = IDLE_REAP_SECONDS_ENV,
                    failure_code = "idle_reap_threshold_unparseable",
                    "idle session reap threshold override ignored; using the default"
                );
                Self::with_threshold(DEFAULT_IDLE_REAP_THRESHOLD)
            }
        }
    }

    pub fn threshold(&self) -> Option<Duration> {
        self.threshold
    }

    /// Sweep cadence: fine enough that the observed idle duration converges on
    /// the threshold, capped so a long threshold does not mean a coarse sweep.
    pub fn sweep_interval(&self) -> Option<Duration> {
        self.threshold.map(|threshold| {
            (threshold / 4)
                .min(MAX_SWEEP_INTERVAL)
                .max(Duration::from_millis(1))
        })
    }
}

/// Why one live session was, or was not, a reap candidate on this sweep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IdleReapVerdict {
    /// Every idle condition holds. Eligible once the clock also runs out.
    Quiescent,
    /// `Starting`, `Running`, `Errored`, or `Closed`.
    NotIdle,
    /// A permission or input request is parked on a human. Never reaped.
    AwaitingInteraction,
    /// The handle's prompt-concurrency flag is set.
    Busy,
    /// Durable background-work trackers are still pending for this session.
    BackgroundWork,
    /// The durable prompt queue holds work this session must still drain.
    QueuedPrompts,
    /// The session parents a link with a durable wake schedule whose delivery
    /// needs a live parent handle. Reaping would strand the wake.
    PendingWake,
    /// No cold start of this session would resolve to a launch strategy, so
    /// retirement would be permanent rather than non-terminal.
    NotRelaunchable,
    /// A durable read failed. Fail closed: never reap on missing evidence.
    Undetermined,
}

impl IdleReapVerdict {
    fn as_str(self) -> &'static str {
        match self {
            Self::Quiescent => "quiescent",
            Self::NotIdle => "not_idle",
            Self::AwaitingInteraction => "awaiting_interaction",
            Self::Busy => "busy",
            Self::BackgroundWork => "background_work",
            Self::QueuedPrompts => "queued_prompts",
            Self::PendingWake => "pending_wake",
            Self::NotRelaunchable => "not_relaunchable",
            Self::Undetermined => "undetermined",
        }
    }
}

/// One session's continuous-idleness record.
struct IdleObservation {
    /// First sweep at which this session was seen quiescent with this marker.
    idle_since: Instant,
    /// `LiveSessionExecutionSnapshot::updated_at`, which the handle bumps on
    /// every phase change and every inbound notification. A changed marker
    /// means activity happened between sweeps, so the clock restarts.
    activity_marker: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct IdleSweepOutcome {
    /// Sessions whose actors were retired on this sweep.
    pub(crate) reaped: Vec<String>,
    /// Sessions whose actor REFUSED the conditional unload on this sweep,
    /// because something arrived between the sweep's observation and the
    /// command reaching the actor's loop. Distinct from a failed reap: the
    /// actor answered, and its answer was no.
    pub(crate) retained: Vec<String>,
    /// Live sessions carrying an unanswered permission or input request on
    /// this sweep. It is a per-sweep GAUGE of the population that can never be
    /// reaped, not a count of sessions that were otherwise ready: the
    /// interaction check runs first, so an ordinary in-flight permission
    /// prompt on a session that is three seconds old is counted too, and the
    /// same session is re-counted every sweep. Emitted because a prompt nobody
    /// will ever answer is a permanent leak and the alternative is that it is
    /// invisible.
    pub(crate) awaiting_interaction_held: usize,
    /// Live sessions held back by a pending durable background-work row, on
    /// the same per-sweep gauge terms. `BackgroundWorkOptions::default()` sets
    /// `stale_after: None`, so `background_work/claude/watch.rs`'s expiry
    /// never fires in production and a tracker whose output file never yields
    /// leaves a `pending` row forever. That makes this the second permanent
    /// unreapable class, and until the default changes this counter is the
    /// only way to see it.
    pub(crate) background_work_held: usize,
}

pub(crate) struct IdleSessionReaper {
    manager: LiveSessionManager,
    threshold: Duration,
    observations: HashMap<String, IdleObservation>,
}

impl IdleSessionReaper {
    pub(crate) fn new(manager: LiveSessionManager, threshold: Duration) -> Self {
        Self {
            manager,
            threshold,
            observations: HashMap::new(),
        }
    }

    /// One sweep pass. `now` is supplied so the loop owns the clock and tests
    /// can advance it without sleeping.
    pub(crate) async fn sweep(&mut self, now: Instant) -> IdleSweepOutcome {
        let live: Vec<(String, Arc<LiveSessionHandle>)> = {
            let sessions = self.manager.live_sessions.read().await;
            sessions
                .iter()
                .map(|(session_id, handle)| (session_id.clone(), handle.clone()))
                .collect()
        };

        let mut outcome = IdleSweepOutcome::default();
        let mut seen: HashSet<String> = HashSet::with_capacity(live.len());

        for (session_id, handle) in live {
            seen.insert(session_id.clone());
            let snapshot = handle.execution_snapshot().await;
            let verdict = self
                .manager
                .idle_reap_verdict(&session_id, &handle, &snapshot);
            match verdict {
                IdleReapVerdict::AwaitingInteraction => outcome.awaiting_interaction_held += 1,
                IdleReapVerdict::BackgroundWork => outcome.background_work_held += 1,
                _ => {}
            }
            if verdict != IdleReapVerdict::Quiescent {
                if self.observations.remove(&session_id).is_some() {
                    tracing::debug!(
                        session_id = %session_id,
                        verdict = verdict.as_str(),
                        "idle session reap clock reset"
                    );
                }
                continue;
            }

            let idle_since = match self.observations.get(&session_id) {
                Some(observation) if observation.activity_marker == snapshot.updated_at => {
                    observation.idle_since
                }
                _ => {
                    self.observations.insert(
                        session_id.clone(),
                        IdleObservation {
                            idle_since: now,
                            activity_marker: snapshot.updated_at.clone(),
                        },
                    );
                    now
                }
            };

            let idle_for = now.saturating_duration_since(idle_since);
            if idle_for < self.threshold {
                continue;
            }

            match self.manager.unload_session_if_still_idle(&session_id).await {
                Ok(Some(reason)) => {
                    // The actor refused: something arrived between the
                    // snapshot above and the command reaching its loop. Start
                    // the clock over rather than retrying immediately.
                    self.observations.remove(&session_id);
                    tracing::debug!(
                        session_id = %session_id,
                        reason = reason.as_str(),
                        result_class = "reap_retained",
                        "idle session reap refused by the actor; the session is no longer idle"
                    );
                    outcome.retained.push(session_id);
                }
                Ok(None) => {
                    self.observations.remove(&session_id);
                    tracing::info!(
                        session_id = %session_id,
                        idle_seconds = idle_for.as_secs(),
                        threshold_seconds = self.threshold.as_secs(),
                        result_class = "reaped",
                        "idle session actor retired to reclaim its agent processes"
                    );
                    outcome.reaped.push(session_id);
                }
                Err(error) => {
                    tracing::warn!(
                        session_id = %session_id,
                        idle_seconds = idle_for.as_secs(),
                        result_class = "reap_failed",
                        failure_code = "nonterminal_unload_failed",
                        error = %error,
                        "idle session reap deferred"
                    );
                }
            }
        }

        self.observations
            .retain(|session_id, _| seen.contains(session_id));

        if outcome.awaiting_interaction_held > 0 {
            tracing::debug!(
                held = outcome.awaiting_interaction_held,
                result_class = "awaiting_interaction_held",
                "live sessions held out of the idle reaper by unanswered interactions"
            );
        }
        if outcome.background_work_held > 0 {
            tracing::debug!(
                held = outcome.background_work_held,
                result_class = "background_work_held",
                "live sessions held out of the idle reaper by pending background work"
            );
        }

        outcome
    }
}

impl LiveSessionManager {
    /// Start the background sweep. A disabled policy starts nothing.
    pub(crate) fn spawn_idle_reaper(&self, policy: IdleReapPolicy) {
        let (Some(threshold), Some(interval)) = (policy.threshold(), policy.sweep_interval())
        else {
            tracing::info!(
                result_class = "idle_reaper_disabled",
                env = IDLE_REAP_SECONDS_ENV,
                "idle session reaper disabled"
            );
            return;
        };

        tracing::info!(
            threshold_seconds = threshold.as_secs(),
            sweep_interval_seconds = interval.as_secs(),
            result_class = "idle_reaper_started",
            "idle session reaper started"
        );

        let mut reaper = IdleSessionReaper::new(self.clone(), threshold);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                reaper.sweep(Instant::now()).await;
            }
        });
    }

    /// The idle predicate. Every condition is evaluated against live state or
    /// durable rows; a failed durable read is `Undetermined`, never a reap.
    pub(crate) fn idle_reap_verdict(
        &self,
        session_id: &str,
        handle: &LiveSessionHandle,
        snapshot: &LiveSessionExecutionSnapshot,
    ) -> IdleReapVerdict {
        if !snapshot.pending_interactions.is_empty()
            || matches!(snapshot.phase, SessionExecutionPhase::AwaitingInteraction)
        {
            return IdleReapVerdict::AwaitingInteraction;
        }
        if !matches!(snapshot.phase, SessionExecutionPhase::Idle) {
            return IdleReapVerdict::NotIdle;
        }
        if handle.is_busy() {
            return IdleReapVerdict::Busy;
        }

        match self
            .caps
            .background
            .list_pending_background_work(session_id)
        {
            Ok(pending) if pending.is_empty() => {}
            Ok(_) => return IdleReapVerdict::BackgroundWork,
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    failure_code = "background_work_read_failed",
                    error = %error,
                    "idle reap candidacy undetermined"
                );
                return IdleReapVerdict::Undetermined;
            }
        }

        match self.caps.queue.list_pending_prompts(session_id) {
            Ok(pending) if pending.is_empty() => {}
            Ok(_) => return IdleReapVerdict::QueuedPrompts,
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    failure_code = "pending_prompt_read_failed",
                    error = %error,
                    "idle reap candidacy undetermined"
                );
                return IdleReapVerdict::Undetermined;
            }
        }

        // A wake this session is still expecting, whose delivery reaches for a
        // LIVE handle. `deliver_cowork_coding_completion` calls
        // `acp_manager.get_handle(...)` and skips the send when the parent is
        // gone, and nothing scans for stranded pending prompts, so reaping the
        // parent first would leave the wake sitting in `session_pending_prompts`
        // until a human next opens the session. Subagent links are exempt:
        // their completions go through `session_link_completion_deliveries`
        // and `CompletionDeliveryWorker` cold-starts the parent itself.
        match self
            .caps
            .idle_reap
            .has_live_delivery_wake_schedule(session_id)
        {
            Ok(false) => {}
            Ok(true) => return IdleReapVerdict::PendingWake,
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    failure_code = "wake_schedule_read_failed",
                    error = %error,
                    "idle reap candidacy undetermined"
                );
                return IdleReapVerdict::Undetermined;
            }
        }

        // Last, because it is the most expensive read and the one that only
        // matters if everything else already said yes: retirement is only
        // non-terminal for a session the startup matrix will take back. A
        // process-local (Claude) zero-turn fork child is quiescent from the
        // moment it is created and `choose_fork_child_strategy` refuses to
        // relaunch it, so reaping one would end it permanently.
        match self
            .caps
            .idle_reap
            .session_can_relaunch_from_cold(session_id)
        {
            Ok(true) => {}
            Ok(false) => return IdleReapVerdict::NotRelaunchable,
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    failure_code = "relaunch_probe_failed",
                    error = %error,
                    "idle reap candidacy undetermined"
                );
                return IdleReapVerdict::Undetermined;
            }
        }

        IdleReapVerdict::Quiescent
    }

    /// Retire one actor, but only if the ACTOR still agrees it is idle.
    ///
    /// The sweep's verdict is a snapshot plus a few durable reads, and it is
    /// stale the instant it is taken. An unconditional `Unload` sent on that
    /// evidence races every prompt, fork and queue mutation in flight, and it
    /// wins that race destructively: mid-turn it sends `CancelNotification`
    /// and resolves interactions `Cancelled`, and the idle loop's biased
    /// select puts commands ahead of the durable queue drain. So the reaper
    /// sends `UnloadIfIdle` instead and lets the actor evaluate the condition
    /// serially on its own loop.
    ///
    /// `Ok(None)` retired the actor, `Ok(Some(reason))` means the actor kept
    /// itself, `Err` is a real failure (a timeout waiting for the retirement).
    ///
    /// Access-gate note: this deliberately does not route through
    /// `SessionRuntime::unload_live_session_nonterminal` and its
    /// `assert_can_mutate_for_session`. That gate exists to stop USER-visible
    /// mutations of a workspace that is frozen for handoff, repair-blocked or
    /// archived; a reap changes no durable state at all (the row, transcript,
    /// configuration and `native_session_id` all survive) and holding actors
    /// alive in exactly those workspaces would leak the memory this exists to
    /// reclaim. The restart side stays gated: `assert_can_start_live_session`
    /// still refuses a cold start in a workspace that may not run one.
    pub(crate) async fn unload_session_if_still_idle(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<UnloadRetainedReason>> {
        let Some(handle) = self.get_handle(session_id).await else {
            return Ok(None);
        };
        match handle.unload_nonterminal_if_idle().await {
            Some(ConditionalUnloadOutcome::Retained(reason)) => return Ok(Some(reason)),
            // Delivered and accepted, or the actor is already gone. Either way
            // the wait below is what proves the actor left the live map.
            Some(ConditionalUnloadOutcome::Unloading) | None => {}
        }
        self.await_actor_retirement(session_id, &handle).await?;
        Ok(None)
    }
}
