//! LoopPort wire contract v1 (pinned 2026-07-02, tagged-chunk vocabulary per
//! `codex/session-activity-architecture.md`): the normalized shapes the
//! sidecars speak — `LoopWire` payloads on tagged notification chunks and
//! (once the loop runtime PR lands) `_anyharness/loop/*` ext-method
//! responses. Status/schedule vocabulary arrives already normalized by the
//! sidecar membranes.

use anyharness_contract::v1::{LoopScheduleKind, LoopStatus};
use serde::{Deserialize, Serialize};

pub const LOOP_UPSERTED_TRANSCRIPT_EVENT: &str = "loop_upserted";
pub const LOOP_REMOVED_TRANSCRIPT_EVENT: &str = "loop_removed";
pub const LOOP_FIRED_TRANSCRIPT_EVENT: &str = "loop_fired";

/// Wire method names for the native LoopPort ext methods (ACP 0.14 strips the
/// leading `_` before dispatch; the client sends the underscored form).
pub const LOOP_SET_EXT_METHOD: &str = "_anyharness/loop/set";
pub const LOOP_CLEAR_EXT_METHOD: &str = "_anyharness/loop/clear";
pub const LOOP_LIST_EXT_METHOD: &str = "_anyharness/loop/list";

/// `_anyharness/loop/set` result: `{ loop: LoopWire }`.
#[derive(Debug, Clone, Deserialize)]
pub struct LoopWireEnvelope {
    pub r#loop: LoopWire,
}

/// `_anyharness/loop/list` result: `{ loops: LoopWire[] }`.
#[derive(Debug, Clone, Deserialize)]
pub struct LoopListWireResult {
    #[serde(default)]
    pub loops: Vec<LoopWire>,
}

/// `_anyharness/loop/clear` result: `{ cleared: number }`.
#[derive(Debug, Clone, Deserialize)]
pub struct LoopClearedWireResult {
    #[serde(default)]
    pub cleared: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopWire {
    pub loop_id: String,
    pub prompt: String,
    pub schedule: LoopScheduleWire,
    pub recurring: bool,
    pub status: LoopWireStatus,
    #[serde(default = "default_native")]
    pub native: bool,
    #[serde(default)]
    pub last_fired_at_ms: Option<i64>,
    #[serde(default)]
    pub fire_count: i64,
    #[serde(default)]
    pub updated_at_ms: i64,
}

fn default_native() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopScheduleWire {
    pub kind: LoopScheduleKindWire,
    pub expr: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoopScheduleKindWire {
    Interval,
    Cron,
}

impl LoopScheduleKindWire {
    pub fn to_contract(self) -> LoopScheduleKind {
        match self {
            Self::Interval => LoopScheduleKind::Interval,
            Self::Cron => LoopScheduleKind::Cron,
        }
    }
}

/// The normalized status vocabulary on the wire — identical to the contract
/// [`LoopStatus`], kept as its own type so an unrecognized sidecar value
/// fails deserialization loudly instead of leaking into the mirror.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoopWireStatus {
    Active,
    Cleared,
}

impl LoopWireStatus {
    pub fn to_contract(self) -> LoopStatus {
        match self {
            Self::Active => LoopStatus::Active,
            Self::Cleared => LoopStatus::Cleared,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loop_wire_parses_pinned_contract_shape() {
        let wire: LoopWire = serde_json::from_value(serde_json::json!({
            "loopId": "cron-1",
            "prompt": "append ping + timestamp to PING.log",
            "schedule": { "kind": "cron", "expr": "*/1 * * * *" },
            "recurring": true,
            "status": "active",
            "native": true,
            "lastFiredAtMs": 1_780_000_000_000i64,
            "fireCount": 2,
            "updatedAtMs": 1_780_000_000_001i64
        }))
        .expect("parse loop wire");

        assert_eq!(wire.loop_id, "cron-1");
        assert_eq!(wire.status, LoopWireStatus::Active);
        assert_eq!(wire.schedule.kind, LoopScheduleKindWire::Cron);
        assert_eq!(wire.fire_count, 2);
    }

    #[test]
    fn loop_wire_rejects_unknown_status() {
        let error = serde_json::from_value::<LoopWire>(serde_json::json!({
            "loopId": "cron-1",
            "prompt": "x",
            "schedule": { "kind": "interval", "expr": "5m" },
            "recurring": true,
            "status": "paused"
        }))
        .expect_err("raw harness statuses outside active|cleared must not parse");
        assert!(error.to_string().contains("paused"));
    }
}
