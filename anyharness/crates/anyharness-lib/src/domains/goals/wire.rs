//! GoalPort wire contract v1 (pinned 2026-07-02): the normalized shapes the
//! sidecars speak — `GoalWire` payloads on tagged notification chunks and in
//! `_anyharness/goal/*` ext-method responses. Status values arrive already
//! normalized by the sidecar membranes; raw harness detail rides
//! `nativeStatus` verbatim.

use anyharness_contract::v1::GoalStatus;
use serde::{Deserialize, Serialize};

pub const GOAL_SET_EXT_METHOD: &str = "_anyharness/goal/set";
pub const GOAL_GET_EXT_METHOD: &str = "_anyharness/goal/get";
pub const GOAL_CLEAR_EXT_METHOD: &str = "_anyharness/goal/clear";

pub const GOAL_UPDATED_TRANSCRIPT_EVENT: &str = "goal_updated";
pub const GOAL_MET_TRANSCRIPT_EVENT: &str = "goal_met";
pub const GOAL_CLEARED_TRANSCRIPT_EVENT: &str = "goal_cleared";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalWire {
    pub objective: String,
    pub status: GoalWireStatus,
    #[serde(default)]
    pub native_status: Option<String>,
    #[serde(default)]
    pub token_budget: Option<i64>,
    #[serde(default)]
    pub tokens_used: Option<i64>,
    #[serde(default)]
    pub time_used_seconds: Option<i64>,
    #[serde(default)]
    pub met_reason: Option<String>,
    #[serde(default)]
    pub iterations: Option<i64>,
    #[serde(default = "default_native")]
    pub native: bool,
    #[serde(default)]
    pub updated_at_ms: Option<i64>,
}

fn default_native() -> bool {
    true
}

/// The normalized status vocabulary on the wire — identical to the contract
/// [`GoalStatus`], kept as its own type so an unrecognized sidecar value
/// fails deserialization loudly instead of leaking into the mirror.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalWireStatus {
    Active,
    Paused,
    Blocked,
    Met,
    Failed,
    Cleared,
}

impl GoalWireStatus {
    pub fn to_contract(self) -> GoalStatus {
        match self {
            Self::Active => GoalStatus::Active,
            Self::Paused => GoalStatus::Paused,
            Self::Blocked => GoalStatus::Blocked,
            Self::Met => GoalStatus::Met,
            Self::Failed => GoalStatus::Failed,
            Self::Cleared => GoalStatus::Cleared,
        }
    }
}

/// Result shape of `_anyharness/goal/set` and `_anyharness/goal/get`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalWireEnvelope {
    #[serde(default)]
    pub goal: Option<GoalWire>,
}

/// Result shape of `_anyharness/goal/clear`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalClearedWireResult {
    #[serde(default)]
    pub cleared: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goal_wire_parses_pinned_contract_shape_with_nulls() {
        let wire: GoalWire = serde_json::from_value(serde_json::json!({
            "objective": "make the tests pass",
            "status": "failed",
            "nativeStatus": "budgetLimited",
            "tokenBudget": 50_000,
            "tokensUsed": 50_001,
            "timeUsedSeconds": 120,
            "metReason": null,
            "iterations": null,
            "native": true,
            "updatedAtMs": 1_780_000_000_000_i64
        }))
        .expect("parse goal wire");

        assert_eq!(wire.status, GoalWireStatus::Failed);
        assert_eq!(wire.native_status.as_deref(), Some("budgetLimited"));
        assert_eq!(wire.met_reason, None);
        assert!(wire.native);
    }

    #[test]
    fn goal_wire_rejects_unknown_status() {
        let error = serde_json::from_value::<GoalWire>(serde_json::json!({
            "objective": "x",
            "status": "usageLimited"
        }))
        .expect_err("raw harness statuses must not parse");
        assert!(error.to_string().contains("usageLimited"));
    }
}
