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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_used_seconds: Option<i64>,
    /// Claude evaluator reason; always absent for codex (terminal detail is
    /// in `native_status`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub met_reason: Option<String>,
    /// Claude only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iterations: Option<i64>,
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
            tokens_used: Some(1_200),
            time_used_seconds: Some(42),
            met_reason: None,
            iterations: Some(3),
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
                "tokensUsed": 1_200,
                "timeUsedSeconds": 42,
                "iterations": 3,
                "native": true,
                "revision": 2,
                "createdAt": "2026-07-02T00:00:00Z",
                "updatedAt": "2026-07-02T00:01:00Z"
            })
        );

        let round_tripped: Goal = serde_json::from_value(json).expect("deserialize goal");
        assert_eq!(round_tripped.status, GoalStatus::Active);
        assert_eq!(round_tripped.revision, 2);
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
        };

        let json = serde_json::to_value(&request).expect("serialize request");
        assert_eq!(json, serde_json::json!({ "status": "paused" }));
    }
}
