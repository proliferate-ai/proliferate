use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Normalized goal status across harnesses (GoalPort wire contract v1).
/// Non-terminal: `active | paused | blocked`; terminal: `met | failed |
/// cleared`. Raw harness detail rides `native_status` verbatim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Active,
    Paused,
    Blocked,
    Met,
    Failed,
    Cleared,
}

impl GoalStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Met | Self::Failed | Self::Cleared)
    }
}

/// Provenance of a goal — who armed it. Defaults to `user`. `workflow` goals
/// carry the arming run in `Goal::source_run_id`; `agent` marks a goal the
/// harness set for itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum GoalSourceKind {
    #[default]
    User,
    Workflow,
    Agent,
}

/// A session goal: a strict mirror of the native harness goal (Codex
/// `ThreadGoal`, Claude `/goal`). Mutations flow only through native
/// mechanisms; this record transitions only after the native notification
/// round-trips.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub objective: String,
    pub status: GoalStatus,
    /// Raw harness status string, verbatim (e.g. codex `budgetLimited`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_budget: Option<i64>,
    /// Runtime-enforced cap: max turns the active goal may run before the
    /// anyharness goal-cap guard fails it. NEVER forwarded to the sidecar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    /// Runtime-enforced cap: max wall-clock seconds the active goal may run.
    /// NEVER forwarded to the sidecar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_wall_secs: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_used_seconds: Option<i64>,
    /// Claude evaluator reason; always absent for codex (terminal detail is
    /// in `native_status`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub met_reason: Option<String>,
    /// Typed reason a goal transitioned to `failed`. Cap breaches set
    /// `max_turns_exhausted` | `max_wall_secs_exhausted`; native failures leave
    /// this absent (detail rides `native_status`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_reason: Option<String>,
    /// Claude only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iterations: Option<i64>,
    /// Provenance: who armed this goal (defaults to `user`).
    pub source_kind: GoalSourceKind,
    /// The workflow run that armed the goal, when `source_kind = workflow`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_run_id: Option<String>,
    pub native: bool,
    /// Bumped on every mirrored edit.
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// The externally settable arm states (`_anyharness/goal/set` accepts only
/// these; the remaining statuses are native-origin transitions).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GoalArmState {
    Active,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionGoalRequest {
    /// Omitted = status/budget-only patch (codex semantics).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<GoalArmState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_budget: Option<i64>,
    /// Runtime-enforced cap (never forwarded to the sidecar).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    /// Runtime-enforced cap (never forwarded to the sidecar).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_wall_secs: Option<u64>,
    /// Provenance to stamp on the goal; omitted preserves the existing value
    /// (a fresh goal defaults to `user`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<GoalSourceKind>,
    /// The workflow run arming the goal; stamped alongside `source_kind`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionGoalResponse {
    pub goal: Goal,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClearSessionGoalResponse {
    pub cleared: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goal_serializes_camel_case_and_round_trips() {
        let goal = Goal {
            objective: "DONE.txt exists containing done".to_string(),
            status: GoalStatus::Active,
            native_status: Some("active".to_string()),
            token_budget: Some(50_000),
            max_turns: Some(20),
            max_wall_secs: Some(900),
            tokens_used: Some(1_200),
            time_used_seconds: Some(42),
            met_reason: None,
            failed_reason: None,
            iterations: Some(3),
            source_kind: GoalSourceKind::Workflow,
            source_run_id: Some("run-7".to_string()),
            native: true,
            revision: 2,
            created_at: "2026-07-02T00:00:00Z".to_string(),
            updated_at: "2026-07-02T00:01:00Z".to_string(),
        };

        let json = serde_json::to_value(&goal).expect("serialize goal");
        assert_eq!(
            json,
            serde_json::json!({
                "objective": "DONE.txt exists containing done",
                "status": "active",
                "nativeStatus": "active",
                "tokenBudget": 50_000,
                "maxTurns": 20,
                "maxWallSecs": 900,
                "tokensUsed": 1_200,
                "timeUsedSeconds": 42,
                "iterations": 3,
                "sourceKind": "workflow",
                "sourceRunId": "run-7",
                "native": true,
                "revision": 2,
                "createdAt": "2026-07-02T00:00:00Z",
                "updatedAt": "2026-07-02T00:01:00Z"
            })
        );

        let round_tripped: Goal = serde_json::from_value(json).expect("deserialize goal");
        assert_eq!(round_tripped.status, GoalStatus::Active);
        assert_eq!(round_tripped.revision, 2);
        assert_eq!(round_tripped.source_kind, GoalSourceKind::Workflow);
        assert_eq!(round_tripped.max_turns, Some(20));
        assert_eq!(round_tripped.max_wall_secs, Some(900));
    }

    #[test]
    fn goal_status_terminality() {
        assert!(!GoalStatus::Active.is_terminal());
        assert!(!GoalStatus::Paused.is_terminal());
        assert!(!GoalStatus::Blocked.is_terminal());
        assert!(GoalStatus::Met.is_terminal());
        assert!(GoalStatus::Failed.is_terminal());
        assert!(GoalStatus::Cleared.is_terminal());
    }

    #[test]
    fn set_goal_request_omits_absent_fields() {
        let request = SetSessionGoalRequest {
            objective: None,
            status: Some(GoalArmState::Paused),
            token_budget: None,
            max_turns: None,
            max_wall_secs: None,
            source_kind: None,
            source_run_id: None,
        };

        let json = serde_json::to_value(&request).expect("serialize request");
        assert_eq!(json, serde_json::json!({ "status": "paused" }));
    }

    #[test]
    fn set_goal_request_round_trips_caps_and_provenance() {
        let request = SetSessionGoalRequest {
            objective: Some("ship it".to_string()),
            status: Some(GoalArmState::Active),
            token_budget: None,
            max_turns: Some(12),
            max_wall_secs: Some(600),
            source_kind: Some(GoalSourceKind::Workflow),
            source_run_id: Some("run-42".to_string()),
        };

        let json = serde_json::to_value(&request).expect("serialize request");
        assert_eq!(
            json,
            serde_json::json!({
                "objective": "ship it",
                "status": "active",
                "maxTurns": 12,
                "maxWallSecs": 600,
                "sourceKind": "workflow",
                "sourceRunId": "run-42"
            })
        );

        let round_tripped: SetSessionGoalRequest =
            serde_json::from_value(json).expect("deserialize request");
        assert_eq!(round_tripped.max_turns, Some(12));
        assert_eq!(round_tripped.max_wall_secs, Some(600));
        assert_eq!(round_tripped.source_kind, Some(GoalSourceKind::Workflow));
        assert_eq!(round_tripped.source_run_id.as_deref(), Some("run-42"));
    }
}
