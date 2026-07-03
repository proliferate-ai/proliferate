use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A recurring in-session prompt on a schedule: a strict mirror of native
/// harness state where it exists (Claude session crons) and a
/// runtime-emulated equivalent where it doesn't (Codex — `native: false`).
/// Unlike [`super::Goal`], **multiple loops per session are allowed**, keyed
/// by `loop_id` (LoopPort wire contract v1).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Loop {
    pub loop_id: String,
    pub prompt: String,
    pub schedule: LoopSchedule,
    pub recurring: bool,
    pub status: LoopStatus,
    pub native: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fired_at_ms: Option<i64>,
    pub fire_count: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoopSchedule {
    pub kind: LoopScheduleKind,
    /// `"5m"` sugar or a raw cron expression, per `kind`.
    pub expr: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LoopScheduleKind {
    Interval,
    Cron,
}

/// Normalized loop status across harnesses (LoopPort wire contract v1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LoopStatus {
    Active,
    Cleared,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loop_serializes_camel_case_and_round_trips() {
        let value = Loop {
            loop_id: "cron-1".to_string(),
            prompt: "append ping + timestamp to PING.log".to_string(),
            schedule: LoopSchedule {
                kind: LoopScheduleKind::Cron,
                expr: "*/1 * * * *".to_string(),
            },
            recurring: true,
            status: LoopStatus::Active,
            native: true,
            last_fired_at_ms: Some(1_780_000_000_000),
            fire_count: 2,
            updated_at_ms: 1_780_000_000_001,
        };

        let json = serde_json::to_value(&value).expect("serialize loop");
        assert_eq!(
            json,
            serde_json::json!({
                "loopId": "cron-1",
                "prompt": "append ping + timestamp to PING.log",
                "schedule": { "kind": "cron", "expr": "*/1 * * * *" },
                "recurring": true,
                "status": "active",
                "native": true,
                "lastFiredAtMs": 1_780_000_000_000i64,
                "fireCount": 2,
                "updatedAtMs": 1_780_000_000_001i64
            })
        );

        let round_tripped: Loop = serde_json::from_value(json).expect("deserialize loop");
        assert_eq!(round_tripped.loop_id, "cron-1");
        assert_eq!(round_tripped.status, LoopStatus::Active);
    }

    #[test]
    fn loop_omits_absent_last_fired_at() {
        let value = Loop {
            loop_id: "cron-2".to_string(),
            prompt: "check every 5m".to_string(),
            schedule: LoopSchedule {
                kind: LoopScheduleKind::Interval,
                expr: "5m".to_string(),
            },
            recurring: true,
            status: LoopStatus::Active,
            native: false,
            last_fired_at_ms: None,
            fire_count: 0,
            updated_at_ms: 1,
        };
        let json = serde_json::to_value(&value).expect("serialize loop");
        assert!(json.get("lastFiredAtMs").is_none());
    }
}
