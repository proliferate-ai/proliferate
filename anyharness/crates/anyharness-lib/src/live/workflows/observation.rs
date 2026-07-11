//! Status snapshot / report plumbing owned by the executor: mirrors an
//! in-flight `agent.goal`'s progress into the RUNNING step's `output_json` so
//! the run timeline can render honest iteration/token counters. Moved verbatim
//! out of `executor.rs` (WS0B-R).

use anyharness_contract::v1::{Goal, GoalStatus};
use serde_json::{json, Value};

/// A throttleable snapshot of an in-flight goal's progress. Two snapshots are
/// "equal" when status, iterations, and tokens are all unchanged.
#[derive(Clone, PartialEq)]
pub(super) struct GoalSnapshot {
    objective: String,
    status: GoalStatus,
    iterations: Option<i64>,
    tokens_used: Option<i64>,
}

impl GoalSnapshot {
    pub(super) fn from_goal(goal: &Goal) -> Self {
        Self {
            objective: goal.objective.clone(),
            status: goal.status,
            iterations: goal.iterations,
            tokens_used: goal.tokens_used,
        }
    }

    /// The RUNNING step's output_json body: `{ goal: {...}, session_id }`.
    pub(super) fn to_output_json(&self, session_id: &str) -> Value {
        let status = serde_json::to_value(self.status)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "active".to_string());
        json!({
            "goal": {
                "objective": self.objective,
                "status": status,
                "iterations": self.iterations,
                "tokens_used": self.tokens_used,
            },
            "session_id": session_id,
        })
    }
}

/// Throttle rule: write only when status, iterations, or tokens changed from the
/// last written snapshot (the objective is stable within a step).
pub(super) fn goal_progress_changed(prev: Option<&GoalSnapshot>, next: &GoalSnapshot) -> bool {
    match prev {
        None => true,
        Some(prev) => {
            prev.status != next.status
                || prev.iterations != next.iterations
                || prev.tokens_used != next.tokens_used
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(status: GoalStatus, iterations: Option<i64>, tokens: Option<i64>) -> GoalSnapshot {
        GoalSnapshot {
            objective: "make CI green".to_string(),
            status,
            iterations,
            tokens_used: tokens,
        }
    }

    #[test]
    fn goal_progress_first_snapshot_always_writes() {
        assert!(goal_progress_changed(None, &snapshot(GoalStatus::Active, Some(1), Some(100))));
    }

    #[test]
    fn goal_progress_throttles_unchanged_values() {
        let prev = snapshot(GoalStatus::Active, Some(3), Some(64_000));
        // Identical snapshot → skip the write.
        assert!(!goal_progress_changed(Some(&prev), &snapshot(GoalStatus::Active, Some(3), Some(64_000))));
        // Any of status / iterations / tokens changing → write.
        assert!(goal_progress_changed(Some(&prev), &snapshot(GoalStatus::Active, Some(4), Some(64_000))));
        assert!(goal_progress_changed(Some(&prev), &snapshot(GoalStatus::Active, Some(3), Some(70_000))));
        assert!(goal_progress_changed(Some(&prev), &snapshot(GoalStatus::Blocked, Some(3), Some(64_000))));
    }

    #[test]
    fn goal_snapshot_output_uses_snake_case_status_and_token_key() {
        let out = snapshot(GoalStatus::Active, Some(3), Some(64_000)).to_output_json("sess_1");
        assert_eq!(out["goal"]["status"], "active");
        assert_eq!(out["goal"]["iterations"], 3);
        assert_eq!(out["goal"]["tokens_used"], 64_000);
        assert_eq!(out["session_id"], "sess_1");
    }
}
