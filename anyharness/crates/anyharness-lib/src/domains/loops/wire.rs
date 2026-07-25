//! `LoopWire` — the normalized sidecar wire shape pinned in the GoalPort /
//! LoopPort wire contract v1 (`_meta.anyharness.loop` on tagged
//! notifications and LoopPort ext-method results).

use anyharness_contract::v1::{LoopScheduleKind, LoopStatus};
use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopWire {
    #[serde(default)]
    pub loop_id: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub schedule: Option<LoopWireSchedule>,
    #[serde(default)]
    pub recurring: Option<bool>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub native: Option<bool>,
    #[serde(default)]
    pub last_fired_at_ms: Option<i64>,
    #[serde(default)]
    pub fire_count: Option<i64>,
    #[serde(default)]
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopWireSchedule {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub expr: Option<String>,
}

impl LoopWire {
    pub fn from_value(value: &serde_json::Value) -> Option<Self> {
        serde_json::from_value(value.clone()).ok()
    }

    pub fn normalized_status(&self) -> LoopStatus {
        match self.status.as_deref() {
            Some("cleared") => LoopStatus::Cleared,
            Some("paused") => LoopStatus::Paused,
            Some("active") | None => LoopStatus::Active,
            Some(other) => {
                tracing::warn!(status = other, "unknown loop wire status; treating as active");
                LoopStatus::Active
            }
        }
    }

    pub fn schedule_kind(&self) -> LoopScheduleKind {
        match self
            .schedule
            .as_ref()
            .and_then(|schedule| schedule.kind.as_deref())
        {
            Some("interval") => LoopScheduleKind::Interval,
            _ => LoopScheduleKind::Cron,
        }
    }

    pub fn schedule_expr(&self) -> Option<&str> {
        self.schedule
            .as_ref()
            .and_then(|schedule| schedule.expr.as_deref())
            .map(str::trim)
            .filter(|expr| !expr.is_empty())
    }

    pub fn last_fired_at_rfc3339(&self) -> Option<String> {
        let millis = self.last_fired_at_ms?;
        chrono::DateTime::from_timestamp_millis(millis).map(|value| value.to_rfc3339())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn loop_wire_parses_contract_example() {
        let wire = LoopWire::from_value(&json!({
            "loopId": "cron-1",
            "prompt": "check the build",
            "schedule": { "kind": "cron", "expr": "*/5 * * * *" },
            "recurring": true,
            "status": "active",
            "native": true,
            "lastFiredAtMs": null,
            "fireCount": 0,
            "updatedAtMs": 1
        }))
        .expect("wire parses");
        assert_eq!(wire.loop_id.as_deref(), Some("cron-1"));
        assert_eq!(wire.schedule_expr(), Some("*/5 * * * *"));
        assert_eq!(
            wire.schedule_kind(),
            anyharness_contract::v1::LoopScheduleKind::Cron
        );
        assert_eq!(
            wire.normalized_status(),
            anyharness_contract::v1::LoopStatus::Active
        );
    }
}
