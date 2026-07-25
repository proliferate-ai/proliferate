//! Goals: the normalized mirror of a native harness goal (Codex
//! `ThreadGoal`, Claude Code `/goal`). See
//! `specs/tbd/goals-and-workflows-v1.md` §2 — the mirror is never a source
//! of truth; writes round-trip through the sidecar GoalPort and the mirror
//! transitions when the tagged native notification is ingested.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Normalized goal status (spec §2.1). Codex `complete` → `met`;
/// `usageLimited|budgetLimited` → `failed` (native detail preserved in
/// `native_status`); `blocked` stays distinct — it is the "agent needs a
/// human" signal.
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

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Blocked => "blocked",
            Self::Met => "met",
            Self::Failed => "failed",
            Self::Cleared => "cleared",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub objective: String,
    pub status: GoalStatus,
    /// Raw harness status string, verbatim (e.g. codex `budgetLimited`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_status: Option<String>,
    /// Provenance: `user | workflow | agent`.
    pub source_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_budget: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_wall_secs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_used_secs: Option<i64>,
    /// Turns finished while this goal was non-terminal (guard-tracked).
    pub turns_used: i64,
    /// Evaluator's reason (claude) / terminal detail (codex) / guard reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub met_reason: Option<String>,
    /// Whether the goal is a mirror of native harness state (v1: always
    /// true; phase-C emulated goals set false).
    pub native: bool,
    /// Bumped on every edit (cf. plans `decision_version`).
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub met_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Session events
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GoalUpdatedEvent {
    pub goal: Goal,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GoalMetEvent {
    pub goal: Goal,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GoalClearedEvent {
    pub goal: Goal,
}

// ---------------------------------------------------------------------------
// HTTP request/response shapes
// ---------------------------------------------------------------------------

/// Requested arm state for a goal write. `paused` avoids the codex
/// auto-continuation turn; arming is always explicit.
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_wall_secs: Option<i64>,
}

/// Goal writes are optimistic-pending: `accepted` reports the sidecar
/// round-trip outcome; `goal` is the current mirror row, which transitions
/// only when the native notification is ingested (watch the session event
/// stream for `goal_updated`).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionGoalResponse {
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<Goal>,
}
