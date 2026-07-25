//! Loops: recurring in-session prompts on a schedule (spec §2.7). Mirror of
//! native state where it exists (Claude session crons, `native: true`);
//! runtime-emulated where it does not (Codex, `native: false`). Multiple
//! loops per session are allowed — that is the native Claude shape.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LoopStatus {
    Active,
    Paused,
    Cleared,
}

impl LoopStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Cleared => "cleared",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LoopScheduleKind {
    /// `"5m"` sugar — a fixed re-fire interval.
    Interval,
    /// A crontab expression (native Claude `CronCreate` shape).
    Cron,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoopSchedule {
    pub kind: LoopScheduleKind,
    pub expr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Loop {
    pub id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub prompt: String,
    pub schedule: LoopSchedule,
    /// `false` for one-shot wakeups whose schedule encodes a single fire
    /// time; `true` for tasks that re-fire on every match.
    pub recurring: bool,
    pub status: LoopStatus,
    /// `true`: mirror of a native harness cron (claude). `false`: managed by
    /// the Proliferate runtime scheduler (codex emulation).
    pub native: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fired_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_fire_at: Option<String>,
    pub fire_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_fires: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_wall_secs: Option<i64>,
    /// Provenance: `user | workflow | agent`.
    pub source_kind: String,
    /// Typed reason when the guard cleared the loop (`max_fires_exhausted`,
    /// `max_wall_exceeded`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleared_reason: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Session events
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoopUpdatedEvent {
    #[serde(rename = "loop")]
    pub loop_: Loop,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoopFiredEvent {
    #[serde(rename = "loop")]
    pub loop_: Loop,
    pub fired_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoopClearedEvent {
    #[serde(rename = "loop")]
    pub loop_: Loop,
}

// ---------------------------------------------------------------------------
// HTTP request/response shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionLoopRequest {
    pub prompt: String,
    pub schedule: LoopSchedule,
    #[serde(default = "default_recurring")]
    pub recurring: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_fires: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_wall_secs: Option<i64>,
}

fn default_recurring() -> bool {
    true
}

/// Loop writes on native sessions are optimistic-pending (mirror transitions
/// when the tagged notification is ingested); emulated loops are
/// runtime-owned and `loop` is authoritative immediately.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionLoopResponse {
    pub accepted: bool,
    #[serde(rename = "loop", skip_serializing_if = "Option::is_none")]
    pub loop_: Option<Loop>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionLoopsResponse {
    pub loops: Vec<Loop>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClearSessionLoopsResponse {
    pub accepted: bool,
    /// Loops the runtime cleared synchronously (emulated); native clears
    /// mirror through the event stream.
    pub cleared: i64,
}
