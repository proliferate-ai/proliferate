use anyharness_contract::v1::{Loop, LoopSchedule, LoopScheduleKind, LoopStatus};

/// The persisted loop mirror: one row per `(session_id, loop_id)`. Unlike
/// [`crate::domains::goals::model::GoalRecord`], **multiple loops per
/// session are allowed** (the native Claude `CronList` shape) — there is no
/// single-head-row lifecycle here, just keyed upserts. Records transition
/// only through observer-ingested native notifications
/// ([`super::session_observer::LoopSessionObserver`]); the write path
/// (`_anyharness/loop/set|clear`) lands with the loop runtime PR.
#[derive(Debug, Clone)]
pub struct LoopRecord {
    pub session_id: String,
    pub workspace_id: String,
    pub loop_id: String,
    pub prompt: String,
    pub schedule_kind: LoopScheduleKind,
    pub schedule_expr: String,
    pub recurring: bool,
    pub status: LoopStatus,
    pub native: bool,
    pub last_fired_at_ms: Option<i64>,
    pub fire_count: i64,
    pub native_state_json: Option<String>,
    pub created_at: String,
    pub updated_at_ms: i64,
}

impl LoopRecord {
    pub fn to_contract(&self) -> Loop {
        Loop {
            loop_id: self.loop_id.clone(),
            prompt: self.prompt.clone(),
            schedule: LoopSchedule {
                kind: self.schedule_kind,
                expr: self.schedule_expr.clone(),
            },
            recurring: self.recurring,
            status: self.status,
            native: self.native,
            last_fired_at_ms: self.last_fired_at_ms,
            fire_count: self.fire_count,
            updated_at_ms: self.updated_at_ms,
        }
    }
}
