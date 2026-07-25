//! `GoalWire` — the normalized sidecar wire shape pinned in the GoalPort /
//! LoopPort wire contract v1. All sidecars emit this exact camelCase shape
//! in `_meta.anyharness.goal` (tagged notifications) and in ext-method
//! results; status arrives already normalized (codex `complete` → `met`,
//! `usageLimited|budgetLimited` → `failed`, …) with the raw harness string
//! preserved in `nativeStatus`.

use anyharness_contract::v1::GoalStatus;
use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalWire {
    #[serde(default)]
    pub objective: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
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
    #[serde(default)]
    pub native: Option<bool>,
    #[serde(default)]
    pub updated_at_ms: Option<i64>,
}

impl GoalWire {
    pub fn from_value(value: &serde_json::Value) -> Option<Self> {
        serde_json::from_value(value.clone()).ok()
    }

    pub fn parse_lenient(raw: &str) -> Option<Self> {
        if raw.trim().is_empty() {
            return None;
        }
        serde_json::from_str(raw).ok()
    }

    /// Normalized status per the wire contract; unknown strings degrade to
    /// `active` (the mirror stays observable rather than erroring).
    pub fn normalized_status(&self) -> GoalStatus {
        match self.status.as_deref() {
            Some("paused") => GoalStatus::Paused,
            Some("blocked") => GoalStatus::Blocked,
            Some("met") => GoalStatus::Met,
            Some("failed") => GoalStatus::Failed,
            Some("cleared") => GoalStatus::Cleared,
            Some("active") | None => GoalStatus::Active,
            Some(other) => {
                tracing::warn!(status = other, "unknown goal wire status; treating as active");
                GoalStatus::Active
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn goal_wire_parses_contract_example() {
        let wire = GoalWire::from_value(&json!({
            "objective": "make tests pass",
            "status": "active",
            "nativeStatus": "active",
            "tokenBudget": 50000,
            "tokensUsed": 12,
            "timeUsedSeconds": 3,
            "metReason": null,
            "iterations": 0,
            "native": true,
            "updatedAtMs": 1
        }))
        .expect("wire parses");
        assert_eq!(wire.objective.as_deref(), Some("make tests pass"));
        assert_eq!(wire.normalized_status(), GoalStatus::Active);
        assert_eq!(wire.token_budget, Some(50000));
        assert_eq!(wire.native, Some(true));
    }

    #[test]
    fn goal_wire_status_normalization_covers_contract_values() {
        for (status, expected) in [
            ("active", GoalStatus::Active),
            ("paused", GoalStatus::Paused),
            ("blocked", GoalStatus::Blocked),
            ("met", GoalStatus::Met),
            ("failed", GoalStatus::Failed),
            ("cleared", GoalStatus::Cleared),
        ] {
            let wire = GoalWire::from_value(&json!({ "status": status })).expect("parse");
            assert_eq!(wire.normalized_status(), expected, "status={status}");
        }
    }
}
